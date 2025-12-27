/**
 * VocalEngine - Central audio coordination for VOCAL_PRIME
 * Handles audio data flow, FFT processing, and analysis coordination
 *
 * Musical vocal metrics for singers and artists:
 * - Presence: Vocal cut-through (1-5kHz energy ratio)
 * - Vibrato: Rate and extent of pitch modulation
 * - Dynamics: Expressive loudness variation
 * - Pitch Accuracy: Cents deviation from chromatic notes
 * - Intensity: Overall vocal power
 */

import { writable, get } from 'svelte/store';
import type { Writable } from 'svelte/store';
import FFT from 'fft.js';

// Import types from global declarations
type StreamVocalsData = {
  taskId: string;
  vocals: string;  // base64 encoded float32 samples
  samples: number;
  latencyMs: number;
};

// ============================================================================
// Types
// ============================================================================
export type SourceType = 'live' | 'file' | null;
export type AnalysisState = 'idle' | 'capturing' | 'analyzing' | 'complete';
export type StreamMode = 'off' | 'full' | 'light';
export type PitchMode = 'off' | 'auto' | 'crepe' | 'melodia';

// Streaming pitch data from Python
type StreamingPitchData = {
  taskId: string;
  frequency: number;
  confidence: number;
  voiced: boolean;
  algorithm: string;
  latencyMs: number;
};

export interface VocalState {
  sourceType: SourceType;
  analysisState: AnalysisState;
  sampleRate: number;
  isCapturing: boolean;
  deviceId: string | null;
  fileName: string | null;
  streamMode: StreamMode;
  streamLatencyMs: number;
  pitchMode: PitchMode;
  pitchAlgorithm: string;  // Currently active algorithm
}

export interface SpectrumData {
  bars: Float32Array;      // 512 normalized spectrum bars (0-1)
  peak: number;            // Current peak level
  rms: number;             // Current RMS level
  gain: number;            // Display gain in dB
}

export interface PitchData {
  frequency: number;       // Current F0 in Hz (0 if unvoiced)
  confidence: number;      // 0-1 confidence (autocorrelation peak strength)
  voiced: boolean;         // Is currently voiced
  history: Float32Array;   // Recent pitch history for contour
  period: number;          // Current pitch period in samples
}

export interface FormantData {
  F1: number;              // First formant Hz
  F2: number;              // Second formant Hz
  F3: number;              // Third formant Hz
  F4: number;              // Fourth formant Hz
  detected: boolean;       // Are formants reliably detected
}

export interface QualityData {
  // Music-relevant vocal metrics (not clinical)
  presence: number;        // Vocal cut-through (0-100%) - energy in 1-5kHz vs total
  vibrato: {
    rate: number;          // Vibrato rate in Hz (0 if none, typically 4-7Hz)
    extent: number;        // Vibrato depth in semitones
    detected: boolean;     // Is vibrato present
  };
  dynamics: number;        // Expressive variation (0-100%) - short-term loudness variance
  clarity: number;         // Harmonic clarity (0-100%) - musical HNR scaled for music
  intensity: number;       // Overall vocal power (0-100%)
  voicePresent: boolean;   // Is voice detected
}

export interface WaveformData {
  left: Float32Array;      // Left channel samples
  right: Float32Array;     // Right channel samples
  mono: Float32Array;      // Mono mix for analysis
}

// ============================================================================
// Constants
// ============================================================================
const FFT_SIZE = 4096;
const SPECTRUM_BARS = 512;
const SAMPLE_RATE = 48000;
const WAVEFORM_SAMPLES = 2048;
const PITCH_HISTORY_SIZE = 128;  // Power of 2 for vibrato FFT

// Frequency mapping for logarithmic spectrum display
const MIN_FREQ = 20;
const MAX_FREQ = 20000;

// Voice analysis parameters
const MIN_PITCH_HZ = 75;    // Minimum F0 (male bass range)
const MAX_PITCH_HZ = 600;   // Maximum F0 (female soprano range)
const VOICING_THRESHOLD = 0.45;  // Autocorrelation threshold for voicing
const ANALYSIS_WINDOW_MS = 50;   // Analysis window in milliseconds

// Pitch analysis rate (determines vibrato FFT frequency resolution)
const PITCH_ANALYSIS_RATE = 50;  // ~50 Hz (20ms between analyses)

// Quality metric smoothing (exponential moving average)
const QUALITY_SMOOTHING = 0.85;  // Higher = smoother, slower response

// ============================================================================
// VocalEngine Class
// ============================================================================
class VocalEngineClass {
  // State stores
  public state: Writable<VocalState>;

  // Audio data stores
  public waveform: Writable<WaveformData>;
  public spectrum: Writable<SpectrumData>;
  public pitch: Writable<PitchData>;
  public formants: Writable<FormantData>;
  public quality: Writable<QualityData>;

  // Stereo samples for visualization
  public stereoSamples: Writable<Float32Array>;

  // Spectrum gain control
  private spectrumGain: number = 0; // dB

  // FFT processor
  private fft: FFT;
  private fftInput: Float32Array;
  private fftOutput: Float32Array;

  // Audio buffers (ring buffers)
  private audioBuffer: Float32Array;
  private audioBufferPos: number = 0;

  // Analysis buffer for voice quality (longer window needed)
  private analysisBuffer: Float32Array;
  private analysisBufferPos: number = 0;
  private readonly analysisBufferSize: number;

  // Spectrum processing
  private spectrumBars: Float32Array;
  private spectrumSmoothed: Float32Array;
  private hannWindow: Float32Array;
  private barFrequencies: Float32Array;

  // Pitch tracking
  private pitchHistory: Float32Array;
  private pitchHistoryPos: number = 0;

  // Vibrato detection (FFT-based) - INDEPENDENT of Melodia
  private vibratoFFT: FFT;
  private vibratoInput: Float32Array;
  private vibratoOutput: Float32Array;
  private vibratoWindow: Float32Array;  // Hann window for vibrato FFT
  private smoothedVibratoRate: number = 0;
  private smoothedVibratoExtent: number = 0;

  // Separate pitch history for vibrato (from LOCAL autocorrelation, not Melodia)
  private vibratoPitchHistory: Float32Array;
  private vibratoPitchHistoryPos: number = 0;

  // Musical vocal metrics
  private rmsHistory: Float32Array;          // Short-term RMS for dynamics calculation
  private rmsHistoryPos: number = 0;
  private readonly rmsHistorySize = 25;      // ~500ms at 50Hz analysis rate

  // Smoothed musical values
  private smoothedPresence: number = 0;
  private smoothedDynamics: number = 0;
  private smoothedIntensity: number = 0;

  // Streaming separation state
  private streamMode: StreamMode = 'off';
  private vocalBuffer: Float32Array;           // Separated vocals buffer
  private vocalBufferPos: number = 0;
  private readonly vocalBufferSize = 48000;    // 1 second of vocals at 48kHz
  private hasVocalData: boolean = false;       // True when we have separated vocals

  // Streaming pitch detection state (Python backend)
  private pitchMode: PitchMode = 'off';
  private pitchStreamingActive: boolean = false;

  // Pitch update rate tracking (for accurate vibrato frequency calculation)
  private pitchUpdateCount: number = 0;
  private pitchUpdateStartTime: number = 0;
  private measuredPitchRate: number = PITCH_ANALYSIS_RATE;  // Default to expected rate
  private newPitchDataAvailable: boolean = false;  // Flag for vibrato calculation

  // IPC cleanup functions
  private cleanupFunctions: (() => void)[] = [];

  // Processing state
  private samplesSinceLastFFT: number = 0;
  private readonly hopSize = 512;

  constructor() {
    // Calculate analysis buffer size (need at least 3 pitch periods at minimum F0)
    this.analysisBufferSize = Math.ceil(SAMPLE_RATE * ANALYSIS_WINDOW_MS / 1000);

    // Initialize state
    this.state = writable<VocalState>({
      sourceType: null,
      analysisState: 'idle',
      sampleRate: SAMPLE_RATE,
      isCapturing: false,
      deviceId: null,
      fileName: null,
      streamMode: 'off',
      streamLatencyMs: 0,
      pitchMode: 'off',
      pitchAlgorithm: 'local',
    });

    // Initialize data stores with defaults
    this.waveform = writable<WaveformData>({
      left: new Float32Array(WAVEFORM_SAMPLES),
      right: new Float32Array(WAVEFORM_SAMPLES),
      mono: new Float32Array(WAVEFORM_SAMPLES),
    });

    this.spectrum = writable<SpectrumData>({
      bars: new Float32Array(SPECTRUM_BARS),
      peak: 0,
      rms: 0,
      gain: 0,
    });

    this.pitch = writable<PitchData>({
      frequency: 0,
      confidence: 0,
      voiced: false,
      history: new Float32Array(PITCH_HISTORY_SIZE),
      period: 0,
    });

    this.formants = writable<FormantData>({
      F1: 0,
      F2: 0,
      F3: 0,
      F4: 0,
      detected: false,
    });

    this.quality = writable<QualityData>({
      presence: 0,
      vibrato: { rate: 0, extent: 0, detected: false },
      dynamics: 0,
      clarity: 0,
      intensity: 0,
      voicePresent: false,
    });

    this.stereoSamples = writable(new Float32Array(2048));

    // Initialize FFT
    this.fft = new FFT(FFT_SIZE);
    this.fftInput = new Float32Array(FFT_SIZE);
    this.fftOutput = new Float32Array(FFT_SIZE * 2);

    // Initialize buffers
    this.audioBuffer = new Float32Array(FFT_SIZE * 2);
    this.analysisBuffer = new Float32Array(this.analysisBufferSize);

    // Initialize spectrum arrays
    this.spectrumBars = new Float32Array(SPECTRUM_BARS);
    this.spectrumSmoothed = new Float32Array(SPECTRUM_BARS);

    // Create Hann window
    this.hannWindow = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }

    // Create logarithmic frequency mapping
    this.barFrequencies = new Float32Array(SPECTRUM_BARS);
    for (let i = 0; i < SPECTRUM_BARS; i++) {
      const ratio = i / (SPECTRUM_BARS - 1);
      this.barFrequencies[i] = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, ratio);
    }

    // Initialize pitch history
    this.pitchHistory = new Float32Array(PITCH_HISTORY_SIZE);

    // Initialize SEPARATE pitch history for vibrato (uses local autocorrelation)
    this.vibratoPitchHistory = new Float32Array(PITCH_HISTORY_SIZE);

    // Initialize vibrato FFT (128-point for pitch contour analysis)
    this.vibratoFFT = new FFT(PITCH_HISTORY_SIZE);
    this.vibratoInput = new Float32Array(PITCH_HISTORY_SIZE);
    this.vibratoOutput = new Float32Array(PITCH_HISTORY_SIZE * 2);
    this.vibratoWindow = new Float32Array(PITCH_HISTORY_SIZE);
    for (let i = 0; i < PITCH_HISTORY_SIZE; i++) {
      this.vibratoWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (PITCH_HISTORY_SIZE - 1)));
    }

    // Initialize RMS history for dynamics calculation
    this.rmsHistory = new Float32Array(this.rmsHistorySize);

    // Initialize vocal buffer for separated audio
    this.vocalBuffer = new Float32Array(this.vocalBufferSize);
  }

  /**
   * Set spectrum display gain
   */
  setSpectrumGain(gainDb: number): void {
    this.spectrumGain = Math.max(-20, Math.min(20, gainDb));
    this.spectrum.update(s => ({ ...s, gain: this.spectrumGain }));
  }

  /**
   * Initialize and register IPC listeners
   */
  init(): void {
    // Register audio data listener (mixed audio from system)
    const unsubAudio = window.electronAPI.audio.onData((samples: number[]) => {
      this.processAudioData(new Float32Array(samples));
    });
    this.cleanupFunctions.push(unsubAudio);

    // Register streaming vocals listener (separated audio from Python)
    const unsubVocals = window.electronAPI.stream.onVocals((data) => {
      this.processVocalData(data);
    });
    this.cleanupFunctions.push(unsubVocals);

    // Register streaming pitch data listener (Python GPU pitch detection)
    const unsubPitch = window.electronAPI.pitch.onData((data) => {
      this.processPythonPitchData(data as StreamingPitchData);
    });
    this.cleanupFunctions.push(unsubPitch);
  }

  /**
   * Start real-time source separation streaming
   * @param mode 'full' for Demucs (higher quality, ~2s latency) or 'light' for bandpass (~50ms latency)
   */
  async startStreaming(mode: 'full' | 'light' = 'light'): Promise<boolean> {
    try {
      const result = await window.electronAPI.stream.start(mode);
      this.streamMode = mode;
      this.hasVocalData = false;

      this.state.update(s => ({
        ...s,
        streamMode: mode,
        streamLatencyMs: mode === 'full' ? 2000 : 50,
      }));

      console.log(`Streaming started in ${mode} mode, task: ${result.taskId}`);
      return true;
    } catch (err) {
      console.error('Failed to start streaming:', err);
      return false;
    }
  }

  /**
   * Stop real-time source separation streaming
   */
  async stopStreaming(): Promise<void> {
    if (this.streamMode === 'off') return;

    try {
      await window.electronAPI.stream.stop();
    } catch (err) {
      console.error('Failed to stop streaming:', err);
    }

    this.streamMode = 'off';
    this.hasVocalData = false;
    this.vocalBufferPos = 0;

    this.state.update(s => ({
      ...s,
      streamMode: 'off',
      streamLatencyMs: 0,
    }));
  }

  // ===========================================================================
  // Streaming Pitch Detection (Python GPU backend)
  // ===========================================================================

  /**
   * Start GPU-accelerated pitch detection streaming
   * @param mode 'auto' (switches based on confidence), 'crepe' (GPU), or 'melodia' (polyphonic)
   */
  async startPitchStreaming(mode: 'auto' | 'crepe' | 'melodia' = 'melodia'): Promise<boolean> {
    try {
      const result = await window.electronAPI.pitch.startStreaming(mode);
      this.pitchMode = mode;
      this.pitchStreamingActive = true;

      // Reset pitch rate tracking for new streaming session
      this.pitchUpdateCount = 0;
      this.pitchUpdateStartTime = 0;
      this.measuredPitchRate = PITCH_ANALYSIS_RATE;  // Start with default, will adjust

      this.state.update(s => ({
        ...s,
        pitchMode: mode,
        pitchAlgorithm: mode,
      }));

      console.log(`Pitch streaming started in ${mode} mode, task: ${result.taskId}`);
      return true;
    } catch (err) {
      console.error('Failed to start pitch streaming:', err);
      return false;
    }
  }

  /**
   * Stop GPU pitch detection streaming
   */
  async stopPitchStreaming(): Promise<void> {
    if (this.pitchMode === 'off') return;

    try {
      await window.electronAPI.pitch.stopStreaming();
    } catch (err) {
      console.error('Failed to stop pitch streaming:', err);
    }

    this.pitchMode = 'off';
    this.pitchStreamingActive = false;

    this.state.update(s => ({
      ...s,
      pitchMode: 'off',
      pitchAlgorithm: 'local',
    }));
  }

  /**
   * Set pitch detection mode on the fly
   */
  async setPitchMode(mode: 'auto' | 'crepe' | 'melodia'): Promise<void> {
    if (this.pitchStreamingActive) {
      await window.electronAPI.pitch.setMode(mode);
      this.pitchMode = mode;
      this.state.update(s => ({ ...s, pitchMode: mode }));
    }
  }

  /**
   * Process pitch data from Python backend
   */
  private processPythonPitchData(data: StreamingPitchData): void {
    if (!this.pitchStreamingActive) return;

    // Track pitch update rate for accurate vibrato frequency calculation
    const now = performance.now();
    this.pitchUpdateCount++;

    if (this.pitchUpdateStartTime === 0) {
      this.pitchUpdateStartTime = now;
    } else {
      const elapsed = (now - this.pitchUpdateStartTime) / 1000; // seconds
      if (elapsed > 0.5) {
        // Calculate actual pitch update rate
        this.measuredPitchRate = this.pitchUpdateCount / elapsed;
        // Reset for next measurement window
        this.pitchUpdateCount = 0;
        this.pitchUpdateStartTime = now;

        // Debug: log measured rate occasionally
        if (Math.random() < 0.1) {
          console.log(`[Pitch] Measured update rate: ${this.measuredPitchRate.toFixed(1)} Hz`);
        }
      }
    }

    // Update pitch history
    const frequency = data.voiced ? data.frequency : 0;
    this.pitchHistory[this.pitchHistoryPos] = frequency;
    this.pitchHistoryPos = (this.pitchHistoryPos + 1) % PITCH_HISTORY_SIZE;
    this.newPitchDataAvailable = true;  // Signal that new data is available for vibrato

    // Create ordered history for display
    const history = new Float32Array(PITCH_HISTORY_SIZE);
    for (let i = 0; i < PITCH_HISTORY_SIZE; i++) {
      const idx = (this.pitchHistoryPos + i) % PITCH_HISTORY_SIZE;
      history[i] = this.pitchHistory[idx];
    }

    // Update pitch store with Python data
    this.pitch.set({
      frequency: data.voiced ? data.frequency : 0,
      confidence: data.confidence,
      voiced: data.voiced,
      history,
      period: 0,  // Not used for Python pitch
    });

    // Update state with algorithm info
    this.state.update(s => ({
      ...s,
      pitchAlgorithm: data.algorithm,
    }));
  }

  /**
   * Process separated vocal data from Python backend
   */
  private processVocalData(data: StreamVocalsData): void {
    // Decode base64 float32 samples using proper binary handling
    const binaryStr = atob(data.vocals);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i) & 0xff;  // Mask to byte range
    }
    // Create Float32Array with proper byte alignment
    const vocals = new Float32Array(bytes.buffer.slice(0));

    console.log(`[VocalEngine] Received ${vocals.length} vocal samples, ` +
                `range: [${Math.min(...vocals).toFixed(4)}, ${Math.max(...vocals).toFixed(4)}]`);

    // Store in vocal buffer
    for (let i = 0; i < vocals.length; i++) {
      this.vocalBuffer[this.vocalBufferPos] = vocals[i];
      this.vocalBufferPos = (this.vocalBufferPos + 1) % this.vocalBufferSize;
    }

    this.hasVocalData = true;

    // Update state with current latency
    this.state.update(s => ({
      ...s,
      streamLatencyMs: data.latencyMs,
    }));
  }

  /**
   * Start audio capture from device
   */
  async startCapture(deviceId: string): Promise<boolean> {
    const success = await window.electronAPI.audio.start(deviceId);

    if (success) {
      this.state.update(s => ({
        ...s,
        sourceType: 'live',
        analysisState: 'capturing',
        isCapturing: true,
        deviceId,
      }));
    }

    return success;
  }

  /**
   * Stop audio capture (also stops streaming if active)
   */
  async stopCapture(): Promise<void> {
    // Stop streaming first if active
    if (this.streamMode !== 'off') {
      await this.stopStreaming();
    }

    await window.electronAPI.audio.stop();

    this.state.update(s => ({
      ...s,
      analysisState: 'idle',
      isCapturing: false,
    }));
  }

  /**
   * Process incoming audio data from IPC
   */
  private processAudioData(samples: Float32Array): void {
    const numSamples = samples.length / 2; // Stereo pairs

    // Update waveform buffers (ring buffer style)
    const waveformData = get(this.waveform);
    const copyLen = Math.min(numSamples, WAVEFORM_SAMPLES);

    // Shift existing samples
    waveformData.left.copyWithin(0, copyLen);
    waveformData.right.copyWithin(0, copyLen);
    waveformData.mono.copyWithin(0, copyLen);

    // Copy new samples
    for (let i = 0; i < copyLen; i++) {
      const srcIdx = (numSamples - copyLen + i) * 2;
      const dstIdx = WAVEFORM_SAMPLES - copyLen + i;
      waveformData.left[dstIdx] = samples[srcIdx];
      waveformData.right[dstIdx] = samples[srcIdx + 1];
      waveformData.mono[dstIdx] = (samples[srcIdx] + samples[srcIdx + 1]) * 0.5;
    }
    this.waveform.set(waveformData);

    // Update stereo samples for visualizers
    this.stereoSamples.set(samples.slice(0, Math.min(samples.length, 2048)));

    // Accumulate samples for FFT and analysis
    for (let i = 0; i < numSamples; i++) {
      const mono = (samples[i * 2] + samples[i * 2 + 1]) * 0.5;

      // FFT buffer
      this.audioBuffer[this.audioBufferPos] = mono;
      this.audioBufferPos = (this.audioBufferPos + 1) % this.audioBuffer.length;

      // Analysis buffer (for voice quality)
      this.analysisBuffer[this.analysisBufferPos] = mono;
      this.analysisBufferPos = (this.analysisBufferPos + 1) % this.analysisBufferSize;

      this.samplesSinceLastFFT++;
    }

    // Process FFT when we have enough new samples
    if (this.samplesSinceLastFFT >= this.hopSize) {
      this.processFFT();
      this.samplesSinceLastFFT = 0;
    }

    // Calculate peak and RMS
    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
      sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / samples.length);

    // Update spectrum with levels
    this.spectrum.update(s => ({
      ...s,
      peak,
      rms,
    }));
  }

  /**
   * Process FFT and update spectrum
   */
  private processFFT(): void {
    // Copy samples from ring buffer with Hann window
    const startPos = (this.audioBufferPos - FFT_SIZE + this.audioBuffer.length) % this.audioBuffer.length;

    for (let i = 0; i < FFT_SIZE; i++) {
      const bufIdx = (startPos + i) % this.audioBuffer.length;
      this.fftInput[i] = this.audioBuffer[bufIdx] * this.hannWindow[i];
    }

    // Perform FFT
    this.fft.realTransform(this.fftOutput, this.fftInput);

    // Apply gain and convert to magnitude spectrum with logarithmic frequency mapping
    const binWidth = SAMPLE_RATE / FFT_SIZE;
    const gainLinear = Math.pow(10, this.spectrumGain / 20);

    // Reference level: normalize by FFT size and apply 2/N scaling for real FFT
    // This ensures 0dBFS input produces ~0dB output
    const fftScale = 2.0 / FFT_SIZE;

    // Dynamic range: 96dB (16-bit) with headroom
    const DB_FLOOR = -96;  // Bottom of display
    const DB_CEILING = 0;  // Top of display (0 dBFS)
    const DB_RANGE = DB_CEILING - DB_FLOOR;

    for (let bar = 0; bar < SPECTRUM_BARS; bar++) {
      const freq = this.barFrequencies[bar];
      const bin = Math.floor(freq / binWidth);

      if (bin < FFT_SIZE / 2) {
        const real = this.fftOutput[bin * 2];
        const imag = this.fftOutput[bin * 2 + 1];

        // Properly scaled magnitude
        const magnitude = Math.sqrt(real * real + imag * imag) * fftScale * gainLinear;

        // Convert to dBFS (dB relative to full scale)
        // Add small epsilon to avoid log(0)
        const db = 20 * Math.log10(Math.max(magnitude, 1e-10));

        // Normalize to 0-1 range based on our dB range
        const normalized = Math.max(0, Math.min(1, (db - DB_FLOOR) / DB_RANGE));

        // Smooth with previous value
        this.spectrumSmoothed[bar] = this.spectrumSmoothed[bar] * 0.7 + normalized * 0.3;
        this.spectrumBars[bar] = this.spectrumSmoothed[bar];
      }
    }

    // Update spectrum store
    this.spectrum.update(s => ({
      ...s,
      bars: new Float32Array(this.spectrumBars),
    }));

    // Run voice analysis
    this.analyzeVoice();
  }

  /**
   * Musical voice analysis using autocorrelation for pitch detection
   * Calculates presence, vibrato, dynamics, clarity, and intensity
   * Uses separated vocals when streaming is active, otherwise falls back to mixed audio
   */
  private analyzeVoice(): void {
    // Get analysis window - use separated vocals if available, otherwise mixed audio
    const windowSize = Math.min(this.analysisBufferSize, Math.floor(SAMPLE_RATE * 0.04)); // 40ms window
    const analysisWindow = new Float32Array(windowSize);

    if (this.hasVocalData && this.streamMode !== 'off') {
      // Use separated vocals for accurate voice quality metrics
      const startPos = (this.vocalBufferPos - windowSize + this.vocalBufferSize) % this.vocalBufferSize;
      for (let i = 0; i < windowSize; i++) {
        analysisWindow[i] = this.vocalBuffer[(startPos + i) % this.vocalBufferSize];
      }
      // Debug: check if we have actual vocal data (not silence)
      const rms = Math.sqrt(analysisWindow.reduce((s, v) => s + v * v, 0) / windowSize);
      if (rms > 0.001) {
        console.log(`[VocalEngine] Using separated vocals for analysis, RMS: ${rms.toFixed(4)}`);
      }
    } else {
      // Fall back to mixed audio (less accurate for voice quality)
      const startPos = (this.analysisBufferPos - windowSize + this.analysisBufferSize) % this.analysisBufferSize;
      for (let i = 0; i < windowSize; i++) {
        analysisWindow[i] = this.analysisBuffer[(startPos + i) % this.analysisBufferSize];
      }
    }

    // ALWAYS compute local autocorrelation for vibrato detection
    // This is INDEPENDENT of Melodia - vibrato needs fine pitch modulation, not melody tracking
    const localPitchResult = this.computeAutocorrelationPitch(analysisWindow);
    const localFrequency = localPitchResult.frequency;
    const localConfidence = localPitchResult.confidence;
    const localPeriod = localPitchResult.period;
    const localVoiced = localConfidence > VOICING_THRESHOLD &&
                        localFrequency >= MIN_PITCH_HZ && localFrequency <= MAX_PITCH_HZ;

    // Update VIBRATO pitch history (always from local autocorrelation)
    this.vibratoPitchHistory[this.vibratoPitchHistoryPos] = localVoiced ? localFrequency : 0;
    this.vibratoPitchHistoryPos = (this.vibratoPitchHistoryPos + 1) % PITCH_HISTORY_SIZE;

    // Variables for display and other metrics
    let frequency = 0;
    let confidence = 0;
    let period = 0;
    let voiced = false;

    if (!this.pitchStreamingActive) {
      // Use local pitch for display when Python streaming is OFF
      frequency = localFrequency;
      confidence = localConfidence;
      period = localPeriod;
      voiced = localVoiced;

      // Update display pitch history
      this.pitchHistory[this.pitchHistoryPos] = voiced ? frequency : 0;
      this.pitchHistoryPos = (this.pitchHistoryPos + 1) % PITCH_HISTORY_SIZE;

      // Create ordered history for display
      const history = new Float32Array(PITCH_HISTORY_SIZE);
      for (let i = 0; i < PITCH_HISTORY_SIZE; i++) {
        const idx = (this.pitchHistoryPos + i) % PITCH_HISTORY_SIZE;
        history[i] = this.pitchHistory[idx];
      }

      this.pitch.set({
        frequency: voiced ? frequency : 0,
        confidence,
        voiced,
        history,
        period: voiced ? period : 0,
      });
    } else {
      // When Python streaming is active, use Melodia for display
      const pitchData = get(this.pitch);
      frequency = pitchData.frequency;
      confidence = pitchData.confidence;
      voiced = pitchData.voiced;
      // Use LOCAL period for clarity calculation (more accurate than Melodia's jumpy values)
      period = localVoiced ? localPeriod : (frequency > 0 ? SAMPLE_RATE / frequency : 0);
    }

    // Estimate formants from spectrum
    this.estimateFormants();

    // Calculate musical vocal metrics
    // These are always calculated, voice detection determines voicePresent flag

    // Calculate current RMS and store in history
    const rms = Math.sqrt(analysisWindow.reduce((s, v) => s + v * v, 0) / analysisWindow.length);
    this.rmsHistory[this.rmsHistoryPos] = rms;
    this.rmsHistoryPos = (this.rmsHistoryPos + 1) % this.rmsHistorySize;

    // Calculate presence (1-5kHz energy ratio) using existing FFT data
    const presence = this.calculatePresence();

    // Calculate dynamics (short-term RMS variance)
    const dynamics = this.calculateDynamics();

    // Calculate intensity (overall vocal power)
    const intensity = this.calculateIntensity(rms);

    // Detect voice presence using RMS (independent of pitch detection)
    // This provides more reliable voice detection than relying solely on pitch
    const rmsVoiceThreshold = 0.01;  // -40dBFS threshold
    const hasVoiceEnergy = rms > rmsVoiceThreshold;

    // Calculate vibrato from LOCAL pitch history (INDEPENDENT of Melodia)
    // Uses vibratoPitchHistory which is ALWAYS updated from local autocorrelation
    let vibrato = { rate: 0, extent: 0, detected: false };
    if (localVoiced || hasVoiceEnergy) {
      vibrato = this.calculateVibrato();
    }

    // Calculate clarity (harmonic-to-noise ratio scaled for music, 0-100%)
    // Use period derived from frequency when Python pitch is active
    const clarity = (voiced || hasVoiceEnergy) && period > 0 ? this.calculateClarity(analysisWindow, period) : 0;

    // Apply exponential smoothing
    this.smoothedPresence = this.smoothedPresence * QUALITY_SMOOTHING + presence * (1 - QUALITY_SMOOTHING);
    this.smoothedDynamics = this.smoothedDynamics * QUALITY_SMOOTHING + dynamics * (1 - QUALITY_SMOOTHING);
    this.smoothedIntensity = this.smoothedIntensity * QUALITY_SMOOTHING + intensity * (1 - QUALITY_SMOOTHING);

    this.quality.set({
      presence: this.smoothedPresence,
      vibrato,
      dynamics: this.smoothedDynamics,
      clarity,
      intensity: this.smoothedIntensity,
      // Use RMS-based voice detection when Python pitch streaming is active
      // This provides more responsive voice presence than pitch-based detection
      voicePresent: this.pitchStreamingActive ? hasVoiceEnergy : voiced,
    });
  }

  /**
   * Autocorrelation-based pitch detection
   * Based on Boersma, P. (1993). "Accurate short-term analysis of the fundamental frequency
   * and the harmonics-to-noise ratio of a sampled sound."
   */
  private computeAutocorrelationPitch(samples: Float32Array): { frequency: number; confidence: number; period: number } {
    const n = samples.length;

    // Lag range for pitch detection
    const minLag = Math.floor(SAMPLE_RATE / MAX_PITCH_HZ);  // Maximum frequency
    const maxLag = Math.floor(SAMPLE_RATE / MIN_PITCH_HZ);  // Minimum frequency

    // Compute normalized autocorrelation
    // r(τ) = Σ x(t) * x(t+τ) / sqrt(Σ x(t)² * Σ x(t+τ)²)

    let maxCorr = 0;
    let bestLag = 0;

    // Compute energy of original signal
    let energy0 = 0;
    for (let i = 0; i < n; i++) {
      energy0 += samples[i] * samples[i];
    }

    if (energy0 < 1e-10) {
      return { frequency: 0, confidence: 0, period: 0 };
    }

    for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
      let sum = 0;
      let energyLag = 0;

      for (let i = 0; i < n - lag; i++) {
        sum += samples[i] * samples[i + lag];
        energyLag += samples[i + lag] * samples[i + lag];
      }

      // Normalized autocorrelation
      const denom = Math.sqrt(energy0 * energyLag);
      const corr = denom > 0 ? sum / denom : 0;

      if (corr > maxCorr) {
        maxCorr = corr;
        bestLag = lag;
      }
    }

    // Parabolic interpolation for sub-sample accuracy
    if (bestLag > minLag && bestLag < maxLag - 1) {
      const y0 = this.getAutocorrAt(samples, bestLag - 1, energy0);
      const y1 = maxCorr;
      const y2 = this.getAutocorrAt(samples, bestLag + 1, energy0);

      const delta = (y0 - y2) / (2 * (y0 - 2 * y1 + y2));
      if (Math.abs(delta) < 1) {
        bestLag += delta;
      }
    }

    const frequency = bestLag > 0 ? SAMPLE_RATE / bestLag : 0;

    return {
      frequency,
      confidence: maxCorr,
      period: bestLag,
    };
  }

  /**
   * Helper to compute autocorrelation at specific lag
   */
  private getAutocorrAt(samples: Float32Array, lag: number, energy0: number): number {
    const n = samples.length;
    const lagInt = Math.floor(lag);

    if (lagInt <= 0 || lagInt >= n) return 0;

    let sum = 0;
    let energyLag = 0;

    for (let i = 0; i < n - lagInt; i++) {
      sum += samples[i] * samples[i + lagInt];
      energyLag += samples[i + lagInt] * samples[i + lagInt];
    }

    const denom = Math.sqrt(energy0 * energyLag);
    return denom > 0 ? sum / denom : 0;
  }

  /**
   * Calculate vocal presence (1-5kHz energy ratio)
   * Measures how well the voice cuts through a mix
   * Higher presence = voice is more audible/forward
   */
  private calculatePresence(): number {
    const binWidth = SAMPLE_RATE / FFT_SIZE;
    const presenceLow = 1000;   // 1kHz - start of presence range
    const presenceHigh = 5000;  // 5kHz - end of presence range
    const lowBin = Math.floor(presenceLow / binWidth);
    const highBin = Math.floor(presenceHigh / binWidth);

    let presenceEnergy = 0;
    let totalEnergy = 0;

    for (let bin = 1; bin < FFT_SIZE / 2; bin++) {
      const real = this.fftOutput[bin * 2];
      const imag = this.fftOutput[bin * 2 + 1];
      const energy = real * real + imag * imag;

      totalEnergy += energy;
      if (bin >= lowBin && bin <= highBin) {
        presenceEnergy += energy;
      }
    }

    if (totalEnergy < 1e-10) return 0;

    // Presence ratio scaled to 0-100%
    // Typical vocal presence in mix: 20-50%
    const ratio = presenceEnergy / totalEnergy;
    return Math.min(100, ratio * 200); // Scale up for display
  }

  /**
   * Calculate dynamics (short-term loudness variation)
   * Measures expressive delivery - more variation = more dynamic
   */
  private calculateDynamics(): number {
    // Need at least 5 samples for meaningful variance
    let validCount = 0;
    let sum = 0;
    let sumSq = 0;

    for (let i = 0; i < this.rmsHistorySize; i++) {
      const rms = this.rmsHistory[i];
      if (rms > 0.001) { // Only count non-silent frames
        validCount++;
        sum += rms;
        sumSq += rms * rms;
      }
    }

    if (validCount < 5) return 0;

    const mean = sum / validCount;
    const variance = (sumSq / validCount) - (mean * mean);
    const stdDev = Math.sqrt(Math.max(0, variance));

    // Coefficient of variation (relative standard deviation)
    // Higher CV = more dynamic performance
    const cv = mean > 0 ? stdDev / mean : 0;

    // Scale to 0-100% (typical CV for vocals: 0.1-0.5)
    return Math.min(100, cv * 200);
  }

  /**
   * Calculate intensity (overall vocal power)
   * Combines loudness with spectral fullness
   */
  private calculateIntensity(currentRms: number): number {
    // RMS to dB, with typical vocal range -60 to 0 dBFS
    const rmsDb = currentRms > 0 ? 20 * Math.log10(currentRms) : -96;

    // Normalize to 0-100% (-60dB = 0%, -6dB = 100%)
    const normalizedLevel = Math.max(0, Math.min(100, (rmsDb + 60) / 54 * 100));

    return normalizedLevel;
  }

  /**
   * Calculate vibrato from LOCAL pitch history using FFT-based detection
   * Uses vibratoPitchHistory (from autocorrelation) - INDEPENDENT of Melodia
   *
   * Detects periodic pitch modulation in the 4-8Hz range (typical singing vibrato)
   */
  private calculateVibrato(): { rate: number; extent: number; detected: boolean } {
    // Count valid (voiced) pitch values from LOCAL autocorrelation history
    let validCount = 0;
    for (let i = 0; i < PITCH_HISTORY_SIZE; i++) {
      if (this.vibratoPitchHistory[i] > 0) validCount++;
    }

    // Debug: log valid count periodically (shows in browser DevTools)
    if (Math.random() < 0.03) {
      console.log(`[Vibrato] localVoiced=${validCount}/${PITCH_HISTORY_SIZE} (${(validCount/PITCH_HISTORY_SIZE*100).toFixed(0)}%)`);
    }

    // Need at least 25% voiced samples for vibrato detection
    if (validCount < PITCH_HISTORY_SIZE * 0.25) {
      this.smoothedVibratoRate *= 0.9;
      this.smoothedVibratoExtent *= 0.9;
      return {
        rate: this.smoothedVibratoRate,
        extent: this.smoothedVibratoExtent,
        detected: this.smoothedVibratoRate > 4 && this.smoothedVibratoExtent > 0.1
      };
    }

    // Build ordered pitch contour from LOCAL autocorrelation
    // FILTER OUT large jumps - these are tracking errors on mixed audio, not vibrato
    const MAX_JUMP_CENTS = 50;  // 0.5 semitone max jump (vibrato is smooth)
    const contour = new Float32Array(PITCH_HISTORY_SIZE);
    let lastGoodPitch = 0;
    let stableCount = 0;

    for (let i = 0; i < PITCH_HISTORY_SIZE; i++) {
      const idx = (this.vibratoPitchHistoryPos + i) % PITCH_HISTORY_SIZE;
      const pitch = this.vibratoPitchHistory[idx];

      if (pitch > 0) {
        if (lastGoodPitch > 0) {
          const centsDiff = Math.abs(1200 * Math.log2(pitch / lastGoodPitch));
          if (centsDiff <= MAX_JUMP_CENTS) {
            // Smooth transition - this is real vibrato motion
            contour[i] = pitch;
            lastGoodPitch = pitch;
            stableCount++;
          } else {
            // Large jump - tracking error, skip this sample
            contour[i] = 0;
          }
        } else {
          // First valid pitch
          contour[i] = pitch;
          lastGoodPitch = pitch;
          stableCount++;
        }
      } else {
        contour[i] = 0;
      }
    }

    // Need enough STABLE samples (no big jumps) for vibrato
    if (stableCount < PITCH_HISTORY_SIZE * 0.2) {
      this.smoothedVibratoRate *= 0.9;
      this.smoothedVibratoExtent *= 0.9;
      return {
        rate: this.smoothedVibratoRate,
        extent: this.smoothedVibratoExtent,
        detected: this.smoothedVibratoRate > 4 && this.smoothedVibratoExtent > 0.1
      };
    }

    // HIGH-PASS FILTER the pitch contour to remove melody drift, keeping only vibrato oscillation
    // Use a short sliding window (16 samples ~320ms at 50Hz) to compute local mean
    // Then subtract to get the high-frequency (vibrato) component
    const LOCAL_WINDOW = 16;
    const highPassContour = new Float32Array(PITCH_HISTORY_SIZE);

    for (let i = 0; i < PITCH_HISTORY_SIZE; i++) {
      if (contour[i] <= 0) {
        highPassContour[i] = 0;
        continue;
      }

      // Calculate local mean in window centered on this sample
      let localSum = 0;
      let localCount = 0;
      const halfWindow = Math.floor(LOCAL_WINDOW / 2);

      for (let j = -halfWindow; j <= halfWindow; j++) {
        const idx = i + j;
        if (idx >= 0 && idx < PITCH_HISTORY_SIZE && contour[idx] > 0) {
          localSum += contour[idx];
          localCount++;
        }
      }

      if (localCount > 0) {
        const localMean = localSum / localCount;
        // Store deviation from LOCAL mean in cents
        highPassContour[i] = 1200 * Math.log2(contour[i] / localMean);
      }
    }

    // Calculate extent from HIGH-PASS filtered contour (removes drift, keeps vibrato)
    let centsSumSq = 0;
    let validCount2 = 0;
    for (let i = 0; i < PITCH_HISTORY_SIZE; i++) {
      if (contour[i] > 0) {
        const cents = highPassContour[i];
        this.vibratoInput[i] = cents * this.vibratoWindow[i];
        centsSumSq += cents * cents;
        validCount2++;
      } else {
        this.vibratoInput[i] = 0;
      }
    }

    // Check for valid cents data
    if (validCount2 === 0 || centsSumSq === 0) {
      return { rate: 0, extent: 0, detected: false };
    }

    // Calculate RMS extent in semitones (use actual valid count, not full array size)
    const centsRms = Math.sqrt(centsSumSq / validCount2);
    const rawExtent = centsRms * 2.83 / 100; // RMS to peak-to-peak in semitones

    // Perform FFT on the pitch contour
    this.vibratoFFT.realTransform(this.vibratoOutput, this.vibratoInput);

    // Use LOCAL analysis rate (always ~93Hz from FFT hop rate)
    // This is consistent since vibrato uses local autocorrelation, not Python streaming
    const analysisRate = PITCH_ANALYSIS_RATE;  // ~50Hz
    const freqResolution = analysisRate / PITCH_HISTORY_SIZE;

    // Find peak in vibrato range (4-8 Hz) - typical singing vibrato
    const nyquistBin = Math.floor(PITCH_HISTORY_SIZE / 2);
    const nyquistFreq = analysisRate / 2;  // 25Hz Nyquist

    const minVibratoHz = 4;
    const maxVibratoHz = Math.min(8, nyquistFreq - 0.5);

    const minVibratoBin = Math.max(1, Math.floor(minVibratoHz / freqResolution));
    const maxVibratoBin = Math.min(nyquistBin - 1, Math.ceil(maxVibratoHz / freqResolution));

    let maxMag = 0;
    let peakBin = 0;
    let totalMag = 0;

    for (let bin = minVibratoBin; bin <= maxVibratoBin && bin < PITCH_HISTORY_SIZE / 2; bin++) {
      const real = this.vibratoOutput[bin * 2];
      const imag = this.vibratoOutput[bin * 2 + 1];
      const mag = Math.sqrt(real * real + imag * imag);
      totalMag += mag;

      if (mag > maxMag) {
        maxMag = mag;
        peakBin = bin;
      }
    }

    // Calculate vibrato rate with parabolic interpolation for sub-bin accuracy
    let rawRate = peakBin * freqResolution;

    if (peakBin > minVibratoBin && peakBin < maxVibratoBin - 1) {
      const y0 = Math.sqrt(
        this.vibratoOutput[(peakBin - 1) * 2] ** 2 +
        this.vibratoOutput[(peakBin - 1) * 2 + 1] ** 2
      );
      const y1 = maxMag;
      const y2 = Math.sqrt(
        this.vibratoOutput[(peakBin + 1) * 2] ** 2 +
        this.vibratoOutput[(peakBin + 1) * 2 + 1] ** 2
      );
      const delta = (y0 - y2) / (2 * (y0 - 2 * y1 + y2));
      if (Math.abs(delta) < 1) {
        rawRate = (peakBin + delta) * freqResolution;
      }
    }

    // Calculate spectral flatness (peakiness) in vibrato band
    // Higher ratio = more prominent vibrato peak
    const avgMag = totalMag / (maxVibratoBin - minVibratoBin + 1);
    const peakRatio = avgMag > 0 ? maxMag / avgMag : 0;

    // Detection criteria (relaxed for real-time detection):
    // - Rate in 3-10 Hz range (typical singing vibrato)
    // - Extent > 0.1 semitones (lowered from 0.15 - subtle vibrato is still vibrato)
    // - Peak ratio > 1.2 (lowered from 1.5 - more tolerant of noisy pitch)
    const isVibrato = rawRate >= 3 && rawRate <= 10 &&
                      rawExtent >= 0.1 && rawExtent <= 4 &&
                      peakRatio >= 1.2;

    // Debug logging - show high-pass filtered extent
    if (Math.random() < 0.03) {
      console.log(`Vibrato: rate=${rawRate.toFixed(1)}Hz, extent=${rawExtent.toFixed(2)}st (hp-filtered), ratio=${peakRatio.toFixed(2)}, stable=${stableCount}/${PITCH_HISTORY_SIZE}, detected=${isVibrato}`);
    }

    // Apply exponential smoothing for stable display
    const smoothing = isVibrato ? 0.6 : 0.92; // Faster attack, moderate decay
    this.smoothedVibratoRate = this.smoothedVibratoRate * smoothing +
                               (isVibrato ? rawRate : 0) * (1 - smoothing);
    this.smoothedVibratoExtent = this.smoothedVibratoExtent * smoothing +
                                 (isVibrato ? rawExtent : 0) * (1 - smoothing);

    // Only report as detected if smoothed values are meaningful
    const detected = this.smoothedVibratoRate >= 3 && this.smoothedVibratoExtent >= 0.1;

    return {
      rate: detected ? this.smoothedVibratoRate : 0,
      extent: detected ? this.smoothedVibratoExtent : 0,
      detected,
    };
  }

  /**
   * Calculate clarity (harmonic-to-noise ratio scaled for music)
   * Uses autocorrelation method, output scaled to 0-100%
   */
  private calculateClarity(samples: Float32Array, period: number): number {
    if (period <= 0) return 0;

    const n = samples.length;
    const lag = Math.floor(period);

    if (lag >= n) return 0;

    // Compute normalized autocorrelation at pitch period
    let sum = 0;
    let energy0 = 0;
    let energyLag = 0;

    for (let i = 0; i < n - lag; i++) {
      sum += samples[i] * samples[i + lag];
      energy0 += samples[i] * samples[i];
      energyLag += samples[i + lag] * samples[i + lag];
    }

    const denom = Math.sqrt(energy0 * energyLag);
    const r = denom > 0 ? sum / denom : 0;

    // Scale autocorrelation (0-1) directly to percentage
    // Higher autocorrelation = cleaner, more harmonic sound
    return Math.max(0, Math.min(100, r * 100));
  }

  /**
   * Estimate formants from spectrum peaks
   * Uses LPC-like peak picking in expected formant regions
   */
  private estimateFormants(): void {
    const binWidth = SAMPLE_RATE / FFT_SIZE;

    // Find peaks in formant regions
    const findPeakInRange = (minHz: number, maxHz: number): number => {
      const minBin = Math.floor(minHz / binWidth);
      const maxBin = Math.floor(maxHz / binWidth);

      let maxMag = 0;
      let peakBin = 0;

      for (let bin = minBin; bin < maxBin && bin < FFT_SIZE / 2; bin++) {
        const real = this.fftOutput[bin * 2];
        const imag = this.fftOutput[bin * 2 + 1];
        const mag = Math.sqrt(real * real + imag * imag);

        if (mag > maxMag) {
          maxMag = mag;
          peakBin = bin;
        }
      }

      return peakBin * binWidth;
    };

    // Typical formant ranges (adult voice)
    const F1 = findPeakInRange(200, 900);    // First formant
    const F2 = findPeakInRange(900, 2500);   // Second formant
    const F3 = findPeakInRange(2500, 3500);  // Third formant
    const F4 = findPeakInRange(3500, 5000);  // Fourth formant

    // Check if formants are reasonable (F2 > F1, etc.)
    const detected = F1 > 0 && F2 > F1 && F3 > F2;

    this.formants.set({
      F1,
      F2,
      F3,
      F4,
      detected,
    });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.cleanupFunctions.forEach(fn => fn());
    this.cleanupFunctions = [];
  }
}

// Export singleton instance
export const vocalEngine = new VocalEngineClass();
