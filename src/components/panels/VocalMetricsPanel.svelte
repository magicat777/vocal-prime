<script lang="ts">
  import { onDestroy } from 'svelte';
  import { vocalEngine } from '../../core/VocalEngine';
  import type { QualityData } from '../../core/VocalEngine';

  // Subscribe to quality data
  let qualityData: QualityData = {
    presence: 0,
    vibrato: { rate: 0, extent: 0, detected: false },
    dynamics: 0,
    clarity: 0,
    intensity: 0,
    voicePresent: false,
  };

  // Vibrato hold mechanism - keep values visible for 3 seconds after detection stops
  const VIBRATO_HOLD_MS = 3000;
  let heldVibratoRate = 0;
  let heldVibratoExtent = 0;
  let vibratoHoldActive = false;
  let vibratoHoldTimeout: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = vocalEngine.quality.subscribe(data => {
    qualityData = data;

    // Update vibrato hold state
    if (data.vibrato.detected) {
      // Vibrato currently detected - update held values and clear any pending timeout
      heldVibratoRate = data.vibrato.rate;
      heldVibratoExtent = data.vibrato.extent;
      vibratoHoldActive = true;

      if (vibratoHoldTimeout) {
        clearTimeout(vibratoHoldTimeout);
        vibratoHoldTimeout = null;
      }
    } else if (vibratoHoldActive && !vibratoHoldTimeout) {
      // Vibrato just stopped - start the hold countdown
      vibratoHoldTimeout = setTimeout(() => {
        vibratoHoldActive = false;
        vibratoHoldTimeout = null;
      }, VIBRATO_HOLD_MS);
    }
  });

  onDestroy(() => {
    unsubscribe();
    if (vibratoHoldTimeout) {
      clearTimeout(vibratoHoldTimeout);
    }
  });

  // Format value for display
  function formatPercent(value: number): string {
    return `${Math.round(value)}%`;
  }

  // Get bar color based on value
  function getBarColor(value: number): string {
    if (value < 30) return 'var(--color-low)';
    if (value < 70) return 'var(--color-mid)';
    return 'var(--color-high)';
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">VOCAL METRICS</span>
    <span class="voice-indicator" class:active={qualityData.voicePresent}>
      {qualityData.voicePresent ? 'VOICE' : 'NO VOICE'}
    </span>
  </div>

  <div class="metrics-container">
    <!-- Presence Meter -->
    <div class="metric-row">
      <span class="metric-label">PRESENCE</span>
      <div class="meter-track">
        <div
          class="meter-fill"
          style="width: {qualityData.presence}%; background: {getBarColor(qualityData.presence)};"
        ></div>
      </div>
      <span class="metric-value">{formatPercent(qualityData.presence)}</span>
    </div>

    <!-- Dynamics Meter -->
    <div class="metric-row">
      <span class="metric-label">DYNAMICS</span>
      <div class="meter-track">
        <div
          class="meter-fill"
          style="width: {qualityData.dynamics}%; background: {getBarColor(qualityData.dynamics)};"
        ></div>
      </div>
      <span class="metric-value">{formatPercent(qualityData.dynamics)}</span>
    </div>

    <!-- Intensity Meter -->
    <div class="metric-row">
      <span class="metric-label">INTENSITY</span>
      <div class="meter-track">
        <div
          class="meter-fill"
          style="width: {qualityData.intensity}%; background: {getBarColor(qualityData.intensity)};"
        ></div>
      </div>
      <span class="metric-value">{formatPercent(qualityData.intensity)}</span>
    </div>

    <!-- Clarity Meter -->
    <div class="metric-row">
      <span class="metric-label">CLARITY</span>
      <div class="meter-track">
        <div
          class="meter-fill"
          style="width: {qualityData.clarity}%; background: {getBarColor(qualityData.clarity)};"
        ></div>
      </div>
      <span class="metric-value">{formatPercent(qualityData.clarity)}</span>
    </div>

    <!-- Vibrato Section -->
    <div class="vibrato-section">
      <div class="vibrato-header">
        <span class="metric-label">VIBRATO</span>
        <span
          class="vibrato-indicator"
          class:detected={qualityData.vibrato.detected}
          class:held={vibratoHoldActive && !qualityData.vibrato.detected}
        >
          {#if qualityData.vibrato.detected}
            DETECTED
          {:else if vibratoHoldActive}
            HOLD
          {:else}
            NONE
          {/if}
        </span>
      </div>
      {#if vibratoHoldActive}
        <div class="vibrato-details" class:fading={!qualityData.vibrato.detected}>
          <div class="vibrato-stat">
            <span class="stat-label">Rate</span>
            <span class="stat-value">{heldVibratoRate.toFixed(1)} Hz</span>
          </div>
          <div class="vibrato-stat">
            <span class="stat-label">Extent</span>
            <span class="stat-value">{heldVibratoExtent.toFixed(2)} st</span>
          </div>
        </div>
      {/if}
    </div>
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

  .voice-indicator {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    padding: 0.125rem 0.375rem;
    border-radius: 2px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    transition: all 0.15s ease;
  }

  .voice-indicator.active {
    background: rgba(34, 197, 94, 0.2);
    color: #22c55e;
  }

  .metrics-container {
    flex: 1;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    overflow-y: auto;
  }

  .metric-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .metric-label {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    width: 70px;
    flex-shrink: 0;
  }

  .meter-track {
    flex: 1;
    height: 10px;
    background: var(--bg-tertiary);
    border-radius: 2px;
    overflow: hidden;
    position: relative;
  }

  .meter-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.1s ease-out;
    min-width: 0;
  }

  .metric-value {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-primary);
    width: 36px;
    text-align: right;
    flex-shrink: 0;
  }

  .vibrato-section {
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-color);
  }

  .vibrato-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.375rem;
  }

  .vibrato-indicator {
    font-family: var(--font-mono);
    font-size: 0.5625rem;
    padding: 0.0625rem 0.25rem;
    border-radius: 2px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .vibrato-indicator.detected {
    background: rgba(249, 115, 22, 0.2);
    color: #f97316;
  }

  .vibrato-indicator.held {
    background: rgba(249, 115, 22, 0.1);
    color: #fb923c;
    opacity: 0.7;
  }

  .vibrato-details {
    display: flex;
    gap: 1rem;
    padding-left: 70px;
    transition: opacity 0.3s ease;
  }

  .vibrato-details.fading {
    opacity: 0.6;
  }

  .vibrato-stat {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .stat-label {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 600;
    color: #f97316;
  }

  /* Custom color variables for meters */
  :root {
    --color-low: #ef4444;
    --color-mid: #eab308;
    --color-high: #22c55e;
  }
</style>
