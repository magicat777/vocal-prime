<script lang="ts">
  import { onMount } from 'svelte';

  // Application state
  let mode: 'live' | 'file' = 'live';
  let pythonStatus = { running: false };
  let audioDevices: { id: string; name: string; isMonitor: boolean }[] = [];
  let selectedDevice = '';
  let isCapturing = false;

  // Analysis state
  let hasFile = false;
  let fileName = '';
  let analysisProgress = 0;
  let analysisStage = '';

  onMount(async () => {
    // Check Python status
    pythonStatus = await window.electronAPI.python.getStatus();

    // Get audio devices
    audioDevices = await window.electronAPI.audio.getDevices();
    if (audioDevices.length > 0) {
      // Default to first monitor device
      const monitor = audioDevices.find((d) => d.isMonitor);
      selectedDevice = monitor?.id || audioDevices[0].id;
    }
  });

  async function startCapture() {
    if (!selectedDevice) return;
    const success = await window.electronAPI.audio.start(selectedDevice);
    if (success) {
      isCapturing = true;
    }
  }

  async function stopCapture() {
    await window.electronAPI.audio.stop();
    isCapturing = false;
  }

  async function importFile() {
    const result = await window.electronAPI.file.import();
    if (result) {
      hasFile = true;
      fileName = result.name;
      mode = 'file';
    }
  }

  async function startPython() {
    await window.electronAPI.python.restart();
    pythonStatus = await window.electronAPI.python.getStatus();
  }
</script>

<div class="app">
  <!-- Header -->
  <header class="header">
    <div class="header-left">
      <h1 class="logo">VOCAL<span class="accent">_PRIME</span></h1>
      <div class="mode-toggle">
        <button class="mode-btn" class:active={mode === 'live'} on:click={() => (mode = 'live')}>
          LIVE
        </button>
        <button class="mode-btn" class:active={mode === 'file'} on:click={() => (mode = 'file')}>
          FILE
        </button>
      </div>
    </div>

    <div class="header-center">
      {#if mode === 'live'}
        <select bind:value={selectedDevice} class="device-select">
          {#each audioDevices as device}
            <option value={device.id}>{device.name}</option>
          {/each}
        </select>
        {#if isCapturing}
          <button class="control-btn stop" on:click={stopCapture}> STOP </button>
        {:else}
          <button class="control-btn start" on:click={startCapture}> START </button>
        {/if}
      {:else}
        <button class="control-btn" on:click={importFile}> IMPORT FILE </button>
        {#if hasFile}
          <span class="file-name">{fileName}</span>
        {/if}
      {/if}
    </div>

    <div class="header-right">
      <div class="python-status" class:running={pythonStatus.running}>
        <span class="status-dot"></span>
        <span class="status-text">Python {pythonStatus.running ? 'Ready' : 'Offline'}</span>
        {#if !pythonStatus.running}
          <button class="start-python" on:click={startPython}>Start</button>
        {/if}
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="main">
    <div class="placeholder-panel">
      <h2>Voice Analysis Panels</h2>
      <p class="text-secondary">Waveform, Pitch Contour, Formants, Quality Metrics</p>
      <p class="text-muted">Coming soon...</p>
    </div>
  </main>

  <!-- Status Bar -->
  <footer class="status-bar">
    <div class="status-left">
      {#if analysisProgress > 0 && analysisProgress < 100}
        <span class="analysis-progress">
          {analysisStage}: {analysisProgress.toFixed(0)}%
        </span>
      {:else}
        <span class="text-muted">Ready</span>
      {/if}
    </div>
    <div class="status-right">
      <span class="text-muted">VOCAL_PRIME v0.1.0</span>
    </div>
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .header-left,
  .header-center,
  .header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .logo {
    font-size: 1.25rem;
    font-weight: 700;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
  }

  .logo .accent {
    color: var(--accent-primary);
  }

  .mode-toggle {
    display: flex;
    gap: 0.25rem;
    background: var(--bg-primary);
    padding: 0.25rem;
    border-radius: var(--border-radius);
  }

  .mode-btn {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.05em;
    border-radius: 4px;
    color: var(--text-secondary);
    transition: all 0.15s ease;
  }

  .mode-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .mode-btn.active {
    color: var(--accent-primary);
    background: rgba(74, 158, 255, 0.15);
  }

  .device-select {
    min-width: 200px;
  }

  .control-btn {
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
    font-family: var(--font-mono);
    font-weight: 600;
    letter-spacing: 0.1em;
    border-radius: var(--border-radius);
    transition: all 0.15s ease;
  }

  .control-btn.start {
    background: var(--accent-success);
    color: #000;
  }

  .control-btn.start:hover {
    background: #16a34a;
  }

  .control-btn.stop {
    background: var(--accent-error);
    color: #fff;
  }

  .control-btn.stop:hover {
    background: #dc2626;
  }

  .control-btn:not(.start):not(.stop) {
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .control-btn:not(.start):not(.stop):hover {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
  }

  .file-name {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .python-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-family: var(--font-mono);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-error);
  }

  .python-status.running .status-dot {
    background: var(--accent-success);
  }

  .status-text {
    color: var(--text-secondary);
  }

  .start-python {
    padding: 0.25rem 0.5rem;
    font-size: 0.625rem;
    font-family: var(--font-mono);
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
  }

  .start-python:hover {
    background: var(--bg-hover);
    border-color: var(--accent-primary);
  }

  /* Main */
  .main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    min-height: 0;
  }

  .placeholder-panel {
    text-align: center;
    padding: 3rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
  }

  .placeholder-panel h2 {
    font-size: 1.25rem;
    margin-bottom: 0.5rem;
  }

  .placeholder-panel p {
    margin-bottom: 0.25rem;
  }

  /* Status Bar */
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
    font-size: 0.75rem;
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .analysis-progress {
    color: var(--accent-primary);
  }
</style>
