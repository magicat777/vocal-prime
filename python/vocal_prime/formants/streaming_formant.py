"""
Streaming Formant Detector using Parselmouth (Praat bindings)

Real-time formant extraction using LPC (Burg algorithm) for accurate
vocal tract resonance estimation. Designed for musical vocal analysis.
"""

import numpy as np
from typing import Dict, Optional, Tuple
from collections import deque
import sys

# Lazy import parselmouth to avoid startup delay
_parselmouth = None


def get_parselmouth():
    """Lazy load parselmouth module."""
    global _parselmouth
    if _parselmouth is None:
        import parselmouth
        _parselmouth = parselmouth
    return _parselmouth


class StreamingFormantDetector:
    """
    Real-time formant detection using Parselmouth's Burg LPC algorithm.

    Buffers incoming audio and processes in overlapping windows for
    smooth, continuous formant tracking suitable for live visualization.
    """

    def __init__(
        self,
        sample_rate: int = 48000,
        max_formants: int = 4,
        window_length: float = 0.025,  # 25ms window (standard for speech)
        hop_size: float = 0.010,       # 10ms hop for smooth updates
        max_formant_hz: float = 5500,  # Maximum formant frequency
        pre_emphasis_from: float = 50.0,
        use_separated_vocals: bool = True
    ):
        """
        Initialize streaming formant detector.

        Args:
            sample_rate: Audio sample rate in Hz
            max_formants: Number of formants to extract (typically 4-5)
            window_length: Analysis window in seconds
            hop_size: Time between analyses in seconds
            max_formant_hz: Maximum formant frequency (5500 for male, 5500 for female)
            pre_emphasis_from: Pre-emphasis frequency in Hz
            use_separated_vocals: Whether to expect separated vocal input
        """
        self.sample_rate = sample_rate
        self.max_formants = max_formants
        self.window_length = window_length
        self.hop_size = hop_size
        self.max_formant_hz = max_formant_hz
        self.pre_emphasis_from = pre_emphasis_from
        self.use_separated_vocals = use_separated_vocals

        # Calculate buffer sizes
        self.window_samples = int(window_length * sample_rate)
        self.hop_samples = int(hop_size * sample_rate)

        # Audio buffer - accumulates samples until we have enough for analysis
        # Need at least window_samples for one analysis
        self.buffer_size = self.window_samples * 3  # 3 windows worth
        self.audio_buffer = np.zeros(self.buffer_size, dtype=np.float32)
        self.buffer_pos = 0
        self.samples_since_analysis = 0

        # Smoothing for stable output
        self.smoothing = 0.7  # Exponential smoothing factor
        self.smoothed_formants = {
            'F1': 0.0, 'F2': 0.0, 'F3': 0.0, 'F4': 0.0
        }
        self.smoothed_bandwidths = {
            'B1': 0.0, 'B2': 0.0, 'B3': 0.0, 'B4': 0.0
        }

        # Voice activity detection - lowered for system audio capture
        # System audio from Spotify/etc typically has lower levels than direct mic
        self.energy_threshold = 0.0001  # RMS threshold for voice detection (very sensitive)
        self.voiced_history = deque(maxlen=3)  # Shorter history for faster response

        # Pre-initialize parselmouth
        print(f"[Formant] Initializing Parselmouth formant detector...", file=sys.stderr)
        print(f"[Formant] Window: {window_length*1000:.0f}ms, Hop: {hop_size*1000:.0f}ms", file=sys.stderr)
        print(f"[Formant] Max formant: {max_formant_hz}Hz, Pre-emphasis from: {pre_emphasis_from}Hz", file=sys.stderr)

        # Warm up parselmouth with a test analysis
        try:
            pm = get_parselmouth()
            test_sound = pm.Sound(np.zeros(self.window_samples), self.sample_rate)
            _ = test_sound.to_formant_burg(
                time_step=hop_size,
                max_number_of_formants=max_formants,
                maximum_formant=max_formant_hz,
                window_length=window_length,
                pre_emphasis_from=pre_emphasis_from
            )
            print(f"[Formant] Parselmouth initialized successfully", file=sys.stderr)
        except Exception as e:
            print(f"[Formant] Warning: Parselmouth init failed: {e}", file=sys.stderr)

    def process_chunk(self, audio: np.ndarray) -> Optional[Dict]:
        """
        Process an audio chunk and return formant data if available.

        Args:
            audio: Mono audio samples (float32, -1 to 1)

        Returns:
            Dict with formant frequencies and bandwidths, or None if buffering
        """
        # Add samples to buffer
        n_samples = len(audio)

        if n_samples >= self.buffer_size:
            # Chunk larger than buffer - just use the end
            self.audio_buffer = audio[-self.buffer_size:].copy()
            self.buffer_pos = self.buffer_size
        else:
            # Shift buffer and append new samples
            if self.buffer_pos + n_samples > self.buffer_size:
                # Need to shift
                shift = self.buffer_pos + n_samples - self.buffer_size
                self.audio_buffer[:-shift] = self.audio_buffer[shift:]
                self.buffer_pos -= shift

            self.audio_buffer[self.buffer_pos:self.buffer_pos + n_samples] = audio
            self.buffer_pos += n_samples

        self.samples_since_analysis += n_samples

        # Check if we have enough samples and it's time for analysis
        if self.buffer_pos < self.window_samples:
            return None  # Still buffering

        if self.samples_since_analysis < self.hop_samples:
            return None  # Not time yet

        # Time to analyze
        self.samples_since_analysis = 0

        # Extract analysis window from end of buffer
        window = self.audio_buffer[self.buffer_pos - self.window_samples:self.buffer_pos].copy()

        # Voice activity detection
        rms = np.sqrt(np.mean(window ** 2))
        is_voiced = rms > self.energy_threshold
        self.voiced_history.append(is_voiced)

        # Require at least 1 recent frame to be voiced (more responsive)
        voice_detected = sum(self.voiced_history) >= 1

        if not voice_detected:
            # Decay smoothed values when no voice
            for key in self.smoothed_formants:
                self.smoothed_formants[key] *= 0.9
            for key in self.smoothed_bandwidths:
                self.smoothed_bandwidths[key] *= 0.9

            return {
                'F1': self.smoothed_formants['F1'],
                'F2': self.smoothed_formants['F2'],
                'F3': self.smoothed_formants['F3'],
                'F4': self.smoothed_formants['F4'],
                'B1': self.smoothed_bandwidths['B1'],
                'B2': self.smoothed_bandwidths['B2'],
                'B3': self.smoothed_bandwidths['B3'],
                'B4': self.smoothed_bandwidths['B4'],
                'detected': False,
                'rms': float(rms)
            }

        # Run Parselmouth formant analysis
        try:
            pm = get_parselmouth()

            # Create Praat Sound object
            sound = pm.Sound(window, self.sample_rate)

            # Extract formants using Burg algorithm (LPC-based)
            formant_obj = sound.to_formant_burg(
                time_step=self.hop_size,
                max_number_of_formants=self.max_formants,
                maximum_formant=self.max_formant_hz,
                window_length=self.window_length,
                pre_emphasis_from=self.pre_emphasis_from
            )

            # Get formants at the center of the window
            t = self.window_length / 2

            raw_formants = {}
            raw_bandwidths = {}

            for i in range(1, self.max_formants + 1):
                f = formant_obj.get_value_at_time(i, t)
                b = formant_obj.get_bandwidth_at_time(i, t)

                key_f = f'F{i}'
                key_b = f'B{i}'

                if not np.isnan(f) and f > 0:
                    raw_formants[key_f] = f
                    raw_bandwidths[key_b] = b if not np.isnan(b) else 0
                else:
                    raw_formants[key_f] = 0
                    raw_bandwidths[key_b] = 0

            # Validate formant ordering (F1 < F2 < F3 < F4)
            formant_valid = self._validate_formants(raw_formants)

            if formant_valid:
                # Apply smoothing
                for key in self.smoothed_formants:
                    if raw_formants.get(key, 0) > 0:
                        self.smoothed_formants[key] = (
                            self.smoothing * self.smoothed_formants[key] +
                            (1 - self.smoothing) * raw_formants[key]
                        )

                for key in self.smoothed_bandwidths:
                    if raw_bandwidths.get(key, 0) > 0:
                        self.smoothed_bandwidths[key] = (
                            self.smoothing * self.smoothed_bandwidths[key] +
                            (1 - self.smoothing) * raw_bandwidths[key]
                        )

            return {
                'F1': self.smoothed_formants['F1'],
                'F2': self.smoothed_formants['F2'],
                'F3': self.smoothed_formants['F3'],
                'F4': self.smoothed_formants['F4'],
                'B1': self.smoothed_bandwidths['B1'],
                'B2': self.smoothed_bandwidths['B2'],
                'B3': self.smoothed_bandwidths['B3'],
                'B4': self.smoothed_bandwidths['B4'],
                'detected': formant_valid and self.smoothed_formants['F1'] > 0,
                'rms': float(rms)
            }

        except Exception as e:
            print(f"[Formant] Analysis error: {e}", file=sys.stderr)
            return {
                'F1': self.smoothed_formants['F1'],
                'F2': self.smoothed_formants['F2'],
                'F3': self.smoothed_formants['F3'],
                'F4': self.smoothed_formants['F4'],
                'B1': 0, 'B2': 0, 'B3': 0, 'B4': 0,
                'detected': False,
                'rms': float(rms)
            }

    def _validate_formants(self, formants: Dict[str, float]) -> bool:
        """
        Validate that formants are in proper order and within expected ranges.

        Typical ranges (adult voice):
        - F1: 200-900 Hz (vowel height)
        - F2: 700-2500 Hz (vowel frontness)
        - F3: 1800-3500 Hz (speaker identity)
        - F4: 3000-5000 Hz (voice quality)
        """
        f1 = formants.get('F1', 0)
        f2 = formants.get('F2', 0)
        f3 = formants.get('F3', 0)
        f4 = formants.get('F4', 0)

        # Basic ordering check
        if not (0 < f1 < f2 < f3):
            return False

        # Range checks (generous for singing voices)
        if not (100 < f1 < 1200):  # Extended for low male voices
            return False
        if not (500 < f2 < 3000):  # Extended for high female voices
            return False
        if not (1500 < f3 < 4500):
            return False

        # F4 is optional
        if f4 > 0 and not (2500 < f4 < 5500):
            return False

        return True

    def reset(self):
        """Reset detector state."""
        self.audio_buffer.fill(0)
        self.buffer_pos = 0
        self.samples_since_analysis = 0
        self.voiced_history.clear()
        for key in self.smoothed_formants:
            self.smoothed_formants[key] = 0.0
        for key in self.smoothed_bandwidths:
            self.smoothed_bandwidths[key] = 0.0

    def get_latency_ms(self) -> float:
        """Return estimated processing latency in milliseconds."""
        # Latency = window length + buffering delay
        return (self.window_length + self.hop_size) * 1000


class AdaptiveFormantDetector(StreamingFormantDetector):
    """
    Adaptive formant detector that adjusts parameters based on detected pitch.

    Uses pitch information to set appropriate maximum formant frequency:
    - Male voices (F0 < 165 Hz): max_formant = 5000 Hz
    - Female voices (F0 > 165 Hz): max_formant = 5500 Hz
    - Child voices (F0 > 250 Hz): max_formant = 6000 Hz
    """

    def __init__(self, sample_rate: int = 48000, **kwargs):
        # Start with default settings
        super().__init__(sample_rate=sample_rate, **kwargs)

        self.current_pitch = 0.0
        self.pitch_history = deque(maxlen=20)

        # Adaptive max formant settings
        self.male_max_formant = 5000
        self.female_max_formant = 5500
        self.child_max_formant = 6000

    def set_pitch(self, pitch_hz: float):
        """
        Update with current pitch estimate for adaptive processing.

        Args:
            pitch_hz: Current fundamental frequency in Hz
        """
        if pitch_hz > 0:
            self.pitch_history.append(pitch_hz)
            self.current_pitch = np.median(list(self.pitch_history))

            # Adapt max formant based on pitch
            if self.current_pitch > 250:
                self.max_formant_hz = self.child_max_formant
            elif self.current_pitch > 165:
                self.max_formant_hz = self.female_max_formant
            else:
                self.max_formant_hz = self.male_max_formant
