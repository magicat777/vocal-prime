<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { vocalEngine } from '../../core/VocalEngine';

  // Display mode
  type DisplayMode = 'horizontal' | 'vertical';
  let displayMode: DisplayMode = 'horizontal';

  function toggleDisplayMode() {
    displayMode = displayMode === 'horizontal' ? 'vertical' : 'horizontal';
  }

  // Display levels (with VU ballistics applied)
  let leftLevel = -100;
  let rightLevel = -100;
  let peakLevel = -100;

  // Raw input levels (before ballistics)
  let rawLeftLevel = -100;
  let rawRightLevel = -100;

  // VU meter ballistics (PPM-style response)
  const VU_ATTACK_MS = 10;
  const VU_RELEASE_MS = 300;

  // Peak hold values
  let peakHoldL = -100;
  let peakHoldR = -100;
  let peakHoldTime = 0;
  const PEAK_HOLD_MS = 1500;
  const PEAK_DECAY_RATE = 0.05;

  // Animation
  let animationId: number;
  let lastTime = performance.now();

  // Crest factor tracking
  let crestFactorL = 0;
  let crestFactorR = 0;

  function updateMeters() {
    const levels = get(vocalEngine.levels);
    rawLeftLevel = levels.left;
    rawRightLevel = levels.right;
    peakLevel = levels.peak;

    const now = performance.now();
    const deltaTime = Math.min(now - lastTime, 100);
    lastTime = now;

    // Apply VU ballistics
    if (rawLeftLevel > leftLevel) {
      const attackCoeff = 1 - Math.exp(-deltaTime / VU_ATTACK_MS);
      leftLevel = leftLevel + (rawLeftLevel - leftLevel) * attackCoeff;
    } else {
      const releaseCoeff = 1 - Math.exp(-deltaTime / VU_RELEASE_MS);
      leftLevel = leftLevel + (rawLeftLevel - leftLevel) * releaseCoeff;
    }

    if (rawRightLevel > rightLevel) {
      const attackCoeff = 1 - Math.exp(-deltaTime / VU_ATTACK_MS);
      rightLevel = rightLevel + (rawRightLevel - rightLevel) * attackCoeff;
    } else {
      const releaseCoeff = 1 - Math.exp(-deltaTime / VU_RELEASE_MS);
      rightLevel = rightLevel + (rawRightLevel - rightLevel) * releaseCoeff;
    }

    // Update peak hold
    if (rawLeftLevel > peakHoldL) {
      peakHoldL = rawLeftLevel;
      peakHoldTime = now;
    } else if (now - peakHoldTime > PEAK_HOLD_MS) {
      peakHoldL = Math.max(peakHoldL - PEAK_DECAY_RATE * (deltaTime / 16.67), rawLeftLevel);
    }

    if (rawRightLevel > peakHoldR) {
      peakHoldR = rawRightLevel;
    } else if (now - peakHoldTime > PEAK_HOLD_MS) {
      peakHoldR = Math.max(peakHoldR - PEAK_DECAY_RATE * (deltaTime / 16.67), rawRightLevel);
    }

    // Calculate crest factor
    if (rawLeftLevel > -99 && peakHoldL > -99) {
      const newCrestL = peakHoldL - rawLeftLevel;
      crestFactorL = crestFactorL * 0.9 + newCrestL * 0.1;
    }
    if (rawRightLevel > -99 && peakHoldR > -99) {
      const newCrestR = peakHoldR - rawRightLevel;
      crestFactorR = crestFactorR * 0.9 + newCrestR * 0.1;
    }

    animationId = requestAnimationFrame(updateMeters);
  }

  onMount(() => {
    animationId = requestAnimationFrame(updateMeters);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
  });

  function dbToPercent(db: number): number {
    const minDb = -60;
    const maxDb = 0;
    return Math.max(0, Math.min(100, ((db - minDb) / (maxDb - minDb)) * 100));
  }

  function getMeterColor(db: number): string {
    if (db > -3) return '#ef4444';
    if (db > -6) return '#f97316';
    if (db > -12) return '#eab308';
    return '#22c55e';
  }

  function getPeakHoldColor(db: number): string {
    if (db > -1) return '#ef4444';
    if (db > -3) return '#f97316';
    return '#fff';
  }
</script>

<div class="panel" class:vertical-mode={displayMode === 'vertical'}>
  <div class="panel-header">
    <span class="panel-title">VU METERS</span>
    <div class="header-right">
      <span class="peak-label" class:clipping={peakLevel > -1}>
        PK: {peakLevel > -100 ? peakLevel.toFixed(1) : '---'}
      </span>
      <button class="mode-toggle" on:click={toggleDisplayMode}>
        {displayMode === 'horizontal' ? 'H' : 'V'}
      </button>
    </div>
  </div>

  {#if displayMode === 'horizontal'}
    <div class="meters horizontal">
      <div class="vu-meter">
        <div class="meter-label">L</div>
        <div class="meter-bar">
          <div class="meter-fill" style="width: {dbToPercent(leftLevel)}%; background: {getMeterColor(leftLevel)}"></div>
          <div class="peak-hold" style="left: {dbToPercent(peakHoldL)}%; background: {getPeakHoldColor(peakHoldL)}"></div>
        </div>
        <div class="meter-value">{leftLevel > -100 ? leftLevel.toFixed(1) : '---'}</div>
      </div>

      <div class="vu-meter">
        <div class="meter-label">R</div>
        <div class="meter-bar">
          <div class="meter-fill" style="width: {dbToPercent(rightLevel)}%; background: {getMeterColor(rightLevel)}"></div>
          <div class="peak-hold" style="left: {dbToPercent(peakHoldR)}%; background: {getPeakHoldColor(peakHoldR)}"></div>
        </div>
        <div class="meter-value">{rightLevel > -100 ? rightLevel.toFixed(1) : '---'}</div>
      </div>

      <div class="meter-scale horizontal">
        <span>-60</span>
        <span>-40</span>
        <span>-20</span>
        <span>-12</span>
        <span>-6</span>
        <span>0</span>
      </div>

      <div class="stats-row">
        <div class="stat-group">
          <span class="stat-label">CREST</span>
          <span class="stat-value">L: {crestFactorL > 0 ? crestFactorL.toFixed(1) : '---'}</span>
          <span class="stat-value">R: {crestFactorR > 0 ? crestFactorR.toFixed(1) : '---'}</span>
        </div>
        <div class="stat-group">
          <span class="stat-label">AVG</span>
          <span class="stat-value" class:compressed={((crestFactorL + crestFactorR) / 2) < 6} class:dynamic={((crestFactorL + crestFactorR) / 2) >= 12}>
            {((crestFactorL + crestFactorR) / 2) > 0 ? ((crestFactorL + crestFactorR) / 2).toFixed(1) : '---'} dB
          </span>
        </div>
      </div>
    </div>
  {:else}
    <div class="meters vertical">
      <div class="vertical-meters">
        <div class="vu-meter-vertical">
          <div class="meter-value-top">{leftLevel > -100 ? leftLevel.toFixed(1) : '---'}</div>
          <div class="meter-bar-vertical">
            <div class="meter-fill-vertical" style="height: {dbToPercent(leftLevel)}%; background: {getMeterColor(leftLevel)}"></div>
            <div class="peak-hold-vertical" style="bottom: {dbToPercent(peakHoldL)}%; background: {getPeakHoldColor(peakHoldL)}"></div>
          </div>
          <div class="meter-label-vertical">L</div>
        </div>

        <div class="meter-scale-vertical">
          <span>0</span>
          <span>-6</span>
          <span>-12</span>
          <span>-24</span>
          <span>-40</span>
          <span>-60</span>
        </div>

        <div class="vu-meter-vertical">
          <div class="meter-value-top">{rightLevel > -100 ? rightLevel.toFixed(1) : '---'}</div>
          <div class="meter-bar-vertical">
            <div class="meter-fill-vertical" style="height: {dbToPercent(rightLevel)}%; background: {getMeterColor(rightLevel)}"></div>
            <div class="peak-hold-vertical" style="bottom: {dbToPercent(peakHoldR)}%; background: {getPeakHoldColor(peakHoldR)}"></div>
          </div>
          <div class="meter-label-vertical">R</div>
        </div>
      </div>

      <div class="stats-vertical">
        <div class="stat-row-vertical">
          <span class="stat-label">CREST L:</span>
          <span class="stat-value">{crestFactorL > 0 ? crestFactorL.toFixed(1) : '---'}</span>
        </div>
        <div class="stat-row-vertical">
          <span class="stat-label">CREST R:</span>
          <span class="stat-value">{crestFactorR > 0 ? crestFactorR.toFixed(1) : '---'}</span>
        </div>
      </div>
    </div>
  {/if}
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

  .peak-label {
    font-size: 0.65rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .peak-label.clipping {
    color: #ef4444;
    font-weight: 600;
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

  .meters {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.75rem;
    justify-content: center;
  }

  .meters.horizontal {
    justify-content: center;
  }

  .meters.vertical {
    justify-content: space-between;
  }

  .vu-meter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .meter-label {
    width: 16px;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-align: center;
  }

  .meter-bar {
    flex: 1;
    height: 16px;
    background: var(--bg-secondary);
    border-radius: 2px;
    position: relative;
    overflow: visible;
  }

  .meter-fill {
    height: 100%;
    transition: width 50ms ease-out;
    border-radius: 2px;
  }

  .peak-hold {
    position: absolute;
    top: -2px;
    width: 3px;
    height: calc(100% + 4px);
    border-radius: 1px;
    transition: left 50ms ease-out;
    transform: translateX(-50%);
  }

  .meter-value {
    width: 40px;
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    text-align: right;
  }

  .meter-scale.horizontal {
    display: flex;
    justify-content: space-between;
    margin-left: 24px;
    margin-right: 48px;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border-color);
    font-family: var(--font-mono);
    font-size: 0.55rem;
    color: var(--text-muted);
  }

  .stats-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--border-color);
    margin-top: 0.25rem;
  }

  .stat-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .stat-label {
    font-size: 0.6rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }

  .stat-value.compressed {
    color: #f97316;
  }

  .stat-value.dynamic {
    color: #22c55e;
  }

  /* Vertical Mode Styles */
  .vertical-meters {
    display: flex;
    justify-content: center;
    align-items: stretch;
    gap: 0.5rem;
    flex: 1;
    min-height: 0;
  }

  .vu-meter-vertical {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    max-width: 40px;
  }

  .meter-value-top {
    font-size: 0.6rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    height: 14px;
    text-align: center;
  }

  .meter-bar-vertical {
    flex: 1;
    width: 100%;
    background: var(--bg-secondary);
    border-radius: 2px;
    position: relative;
    overflow: visible;
    min-height: 60px;
  }

  .meter-fill-vertical {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    max-height: 100%;
    transition: height 50ms ease-out;
    border-radius: 2px;
  }

  .peak-hold-vertical {
    position: absolute;
    left: -2px;
    width: calc(100% + 4px);
    height: 3px;
    border-radius: 1px;
    transition: bottom 50ms ease-out;
    transform: translateY(50%);
  }

  .meter-label-vertical {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-align: center;
  }

  .meter-scale-vertical {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 14px 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.5rem;
    color: var(--text-muted);
    text-align: center;
    min-height: 60px;
  }

  .stats-vertical {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--border-color);
  }

  .stat-row-vertical {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.6rem;
  }

  .stat-row-vertical .stat-label {
    color: var(--text-muted);
  }
</style>
