<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { vocalEngine } from '../../core/VocalEngine';

  let correlation = 0;
  let stereoWidth = 0;
  let balance = 0;
  let midLevel = -100;
  let sideLevel = -100;

  // Smoothing
  const SMOOTHING = 0.85;
  let smoothedCorrelation = 0;
  let smoothedWidth = 0;
  let smoothedBalance = 0;

  let animationId: number;

  function updateDisplay() {
    const data = get(vocalEngine.stereoAnalysis);

    correlation = data.correlation;
    stereoWidth = data.stereoWidth;
    balance = data.balance;
    midLevel = data.midLevel;
    sideLevel = data.sideLevel;

    // Apply smoothing
    smoothedCorrelation = smoothedCorrelation * SMOOTHING + correlation * (1 - SMOOTHING);
    smoothedWidth = smoothedWidth * SMOOTHING + stereoWidth * (1 - SMOOTHING);
    smoothedBalance = smoothedBalance * SMOOTHING + balance * (1 - SMOOTHING);

    animationId = requestAnimationFrame(updateDisplay);
  }

  onMount(() => {
    animationId = requestAnimationFrame(updateDisplay);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
  });

  function getCorrelationColor(value: number): string {
    if (value < -0.5) return '#ef4444';
    if (value < 0) return '#f97316';
    if (value < 0.5) return '#eab308';
    return '#22c55e';
  }

  function getCorrelationLabel(value: number): string {
    if (value > 0.9) return 'MONO';
    if (value > 0.5) return 'CORR';
    if (value > 0) return 'WIDE';
    if (value > -0.5) return 'DIFF';
    return 'OUT';
  }

  function correlationToPercent(value: number): number {
    return ((value + 1) / 2) * 100;
  }

  function formatDb(value: number): string {
    if (!isFinite(value) || value < -99) return '---';
    return value.toFixed(1);
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">STEREO</span>
    <span class="status" style="color: {getCorrelationColor(smoothedCorrelation)}">
      {getCorrelationLabel(smoothedCorrelation)}
    </span>
  </div>

  <div class="content">
    <!-- Correlation Meter -->
    <div class="correlation-meter">
      <div class="meter-labels">
        <span>-1</span>
        <span>0</span>
        <span>+1</span>
      </div>
      <div class="meter-bar">
        <div class="center-line"></div>
        <div
          class="meter-fill"
          style="
            left: {smoothedCorrelation >= 0 ? '50%' : correlationToPercent(smoothedCorrelation) + '%'};
            width: {Math.abs(smoothedCorrelation) * 50}%;
            background: {getCorrelationColor(smoothedCorrelation)};
          "
        ></div>
        <div
          class="position-indicator"
          style="left: {correlationToPercent(smoothedCorrelation)}%; background: {getCorrelationColor(smoothedCorrelation)};"
        ></div>
      </div>
      <div class="correlation-value">
        {smoothedCorrelation >= 0 ? '+' : ''}{smoothedCorrelation.toFixed(2)}
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-box">
        <span class="stat-label">WIDTH</span>
        <div class="mini-meter">
          <div class="mini-fill" style="width: {smoothedWidth * 100}%;"></div>
        </div>
        <span class="stat-value">{(smoothedWidth * 100).toFixed(0)}%</span>
      </div>

      <div class="stat-box">
        <span class="stat-label">BALANCE</span>
        <div class="balance-meter">
          <div class="balance-center"></div>
          <div class="balance-indicator" style="left: {50 + smoothedBalance * 50}%;"></div>
        </div>
        <span class="stat-value">
          {smoothedBalance < -0.05 ? 'L' : smoothedBalance > 0.05 ? 'R' : 'C'}
          {Math.abs(smoothedBalance) > 0.05 ? Math.abs(smoothedBalance * 100).toFixed(0) : ''}
        </span>
      </div>

      <div class="stat-box ms-levels">
        <div class="ms-item">
          <span class="stat-label">MID</span>
          <span class="stat-value">{formatDb(midLevel)}</span>
        </div>
        <div class="ms-item">
          <span class="stat-label">SIDE</span>
          <span class="stat-value side">{formatDb(sideLevel)}</span>
        </div>
      </div>
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

  .status {
    font-size: 0.7rem;
    font-weight: 600;
    font-family: var(--font-mono);
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.75rem;
    gap: 0.5rem;
    justify-content: center;
  }

  .correlation-meter {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .meter-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.6rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
    padding: 0 2px;
  }

  .meter-bar {
    height: 24px;
    background: var(--bg-secondary);
    border-radius: 3px;
    position: relative;
    overflow: visible;
  }

  .center-line {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--border-color);
    transform: translateX(-50%);
    z-index: 1;
  }

  .meter-fill {
    position: absolute;
    top: 2px;
    height: calc(100% - 4px);
    border-radius: 2px;
    transition: all 50ms ease-out;
  }

  .position-indicator {
    position: absolute;
    top: -2px;
    width: 4px;
    height: calc(100% + 4px);
    border-radius: 2px;
    transform: translateX(-50%);
    transition: left 50ms ease-out;
    z-index: 2;
  }

  .correlation-value {
    font-size: 1.2rem;
    font-weight: 500;
    font-family: var(--font-mono);
    color: var(--text-primary);
    text-align: center;
    padding-top: 0.25rem;
  }

  .stats-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border-color);
  }

  .stat-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    flex: 1;
  }

  .stat-label {
    font-size: 0.55rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }

  .mini-meter {
    width: 100%;
    height: 6px;
    background: var(--bg-secondary);
    border-radius: 3px;
    overflow: hidden;
  }

  .mini-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e, #eab308);
    border-radius: 3px;
    transition: width 50ms ease-out;
  }

  .balance-meter {
    width: 100%;
    height: 6px;
    background: var(--bg-secondary);
    border-radius: 3px;
    position: relative;
  }

  .balance-center {
    position: absolute;
    left: 50%;
    top: 0;
    width: 2px;
    height: 100%;
    background: var(--border-color);
    transform: translateX(-50%);
  }

  .balance-indicator {
    position: absolute;
    top: -1px;
    width: 6px;
    height: 8px;
    background: var(--accent-primary);
    border-radius: 2px;
    transform: translateX(-50%);
    transition: left 50ms ease-out;
  }

  .ms-levels {
    flex-direction: row;
    gap: 0.75rem;
  }

  .ms-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }

  .side {
    color: var(--accent-primary);
  }
</style>
