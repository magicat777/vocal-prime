<script lang="ts">
  import { onDestroy } from 'svelte';
  import { vocalEngine } from '../../core/VocalEngine';

  interface BandInfo {
    name: string;
    label: string;
    peak: number;
    avg: number;
    peakHold: number;
    peakHoldTime: number;
  }

  // Display mode
  type DisplayMode = 'names' | 'frequencies';
  let displayMode: DisplayMode = 'names';

  function toggleDisplayMode() {
    displayMode = displayMode === 'names' ? 'frequencies' : 'names';
  }

  let bands: BandInfo[] = [];
  let dominantFreq = 0;
  let signalPresent = false;

  // Peak hold settings
  const PEAK_HOLD_TIME_MS = 1500;
  const PEAK_DECAY_RATE = 0.15;

  // Spectrum configuration
  const TOTAL_BARS = 512;
  const SPECTRUM_MIN_FREQ = 20;
  const SPECTRUM_MAX_FREQ = 20000;

  // Band definitions (7 bands)
  const BAND_RANGES = [
    { name: 'Sub-Bass', label: '20', min: 20, max: 60 },
    { name: 'Bass', label: '60', min: 60, max: 250 },
    { name: 'Low-Mid', label: '250', min: 250, max: 500 },
    { name: 'Mid', label: '500', min: 500, max: 2000 },
    { name: 'Upper-Mid', label: '2k', min: 2000, max: 4000 },
    { name: 'Presence', label: '4k', min: 4000, max: 6000 },
    { name: 'Brilliance', label: '6k', min: 6000, max: 20000 },
  ];

  // Pre-allocate bands
  let bandsData: BandInfo[] = BAND_RANGES.map(b => ({
    name: b.name, label: b.label,
    peak: 0, avg: 0, peakHold: 0, peakHoldTime: 0
  }));

  // Peak hold state
  let peakHolds: number[] = new Array(7).fill(0);
  let peakHoldTimes: number[] = new Array(7).fill(0);

  // Convert frequency to bar index
  function freqToBar(freq: number): number {
    const t = Math.log(freq / SPECTRUM_MIN_FREQ) / Math.log(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ);
    return Math.floor(t * (TOTAL_BARS - 1));
  }

  function barToFreq(bar: number): number {
    const t = bar / (TOTAL_BARS - 1);
    return SPECTRUM_MIN_FREQ * Math.pow(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ, t);
  }

  // Pre-calculate bar indices
  const barIndices = BAND_RANGES.map(b => ({
    start: freqToBar(b.min),
    end: Math.min(freqToBar(b.max), TOTAL_BARS - 1)
  }));

  function analyzeBands(spec: Float32Array, now: number): BandInfo[] {
    for (let idx = 0; idx < BAND_RANGES.length; idx++) {
      const { start: startBar, end: endBar } = barIndices[idx];
      const band = bandsData[idx];

      let peak = 0;
      let sum = 0;
      let count = 0;

      for (let i = startBar; i <= endBar; i++) {
        const val = spec[i] || 0;
        if (val > peak) peak = val;
        sum += val;
        count++;
      }

      const avgPercent = count > 0 ? (sum / count) * 100 : 0;

      // Update peak hold
      if (avgPercent > peakHolds[idx]) {
        peakHolds[idx] = avgPercent;
        peakHoldTimes[idx] = now;
      } else if (now - peakHoldTimes[idx] > PEAK_HOLD_TIME_MS) {
        peakHolds[idx] = Math.max(avgPercent, peakHolds[idx] - PEAK_DECAY_RATE * peakHolds[idx]);
      }

      band.peak = peak * 100;
      band.avg = avgPercent;
      band.peakHold = peakHolds[idx];
      band.peakHoldTime = peakHoldTimes[idx];
    }

    return bandsData;
  }

  function findDominantFreq(spec: Float32Array): number {
    let maxVal = 0;
    let maxBar = 0;

    for (let i = 1; i < spec.length; i += 4) {
      if (spec[i] > maxVal) {
        maxVal = spec[i];
        maxBar = i;
      }
    }

    return barToFreq(maxBar);
  }

  // Subscribe to spectrum data
  const unsubSpectrum = vocalEngine.spectrum.subscribe((data) => {
    const now = performance.now();
    bands = analyzeBands(data.bars, now);
    dominantFreq = findDominantFreq(data.bars);
    signalPresent = data.bars[50] > 0.05 || data.bars[150] > 0.05 || data.bars[300] > 0.05;
  });

  onDestroy(() => {
    unsubSpectrum();
  });
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">FREQUENCY BANDS</span>
    <div class="header-right">
      <span class="dominant-freq">
        {signalPresent ? `${dominantFreq.toFixed(0)} Hz` : '--- Hz'}
      </span>
      <button class="mode-toggle" on:click={toggleDisplayMode}>
        {displayMode === 'names' ? 'NAME' : 'FREQ'}
      </button>
    </div>
  </div>

  <div class="bands-container">
    {#each bands as band}
      <div class="band-row">
        <span class="band-name">{displayMode === 'names' ? band.name : band.label}</span>
        <div class="band-meter">
          <div class="band-fill" style="width: {Math.max(0, Math.min(100, band.avg))}%"></div>
          <div class="band-peak-hold" style="left: {Math.min(100, band.peakHold)}%"></div>
        </div>
        <span class="band-value">{band.peakHold.toFixed(0)}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--text-primary);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dominant-freq {
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--accent-primary);
    font-weight: 500;
  }

  .mode-toggle {
    padding: 0.2rem 0.4rem;
    font-size: 0.6rem;
    font-family: var(--font-mono);
    font-weight: 600;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .mode-toggle:hover {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }

  .bands-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.75rem;
    justify-content: space-around;
  }

  .band-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .band-name {
    width: 70px;
    font-size: 0.65rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .band-meter {
    flex: 1;
    height: 10px;
    position: relative;
    background: var(--bg-secondary);
    border-radius: 2px;
    overflow: visible;
  }

  .band-fill {
    height: 100%;
    max-width: 100%;
    background: linear-gradient(90deg, #22c55e 0%, #eab308 60%, #ef4444 100%);
    transition: width 50ms ease-out;
    border-radius: 2px;
  }

  .band-peak-hold {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    background: #fff;
    transform: translateX(-1px);
    transition: left 50ms ease-out;
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.6);
  }

  .band-value {
    width: 28px;
    text-align: right;
    font-size: 0.65rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }
</style>
