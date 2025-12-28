<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { vocalEngine, type PitchMode } from '../../core/VocalEngine';

  let canvas: HTMLCanvasElement;
  let canvasContainer: HTMLDivElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number;
  let width = 0;
  let height = 0;
  let resizeObserver: ResizeObserver | null = null;

  // Subscribe to pitch data
  let pitchData = { frequency: 0, confidence: 0, voiced: false, history: new Float32Array(128) };
  const unsubscribePitch = vocalEngine.pitch.subscribe(data => {
    pitchData = data;
  });

  // Subscribe to engine state for pitch mode
  let pitchMode: PitchMode = 'off';
  let pitchAlgorithm = 'local';
  const unsubscribeState = vocalEngine.state.subscribe(state => {
    pitchMode = state.pitchMode;
    pitchAlgorithm = state.pitchAlgorithm;
  });

  // Handle pitch mode change
  async function handleModeChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const newMode = select.value as PitchMode;

    // Always stop current streaming first before switching modes
    if (pitchMode !== 'off') {
      await vocalEngine.stopPitchStreaming();
    }

    if (newMode !== 'off') {
      await vocalEngine.startPitchStreaming(newMode as 'auto' | 'crepe' | 'melodia');
    }
  }

  // Note frequency reference (extended for high soprano range)
  const noteFreqs: { [key: string]: number } = {
    'C2': 65.41,
    'A2': 110,
    'C3': 130.81,
    'A3': 220,
    'C4': 261.63,  // Middle C
    'A4': 440,     // Concert pitch
    'C5': 523.25,
    'A5': 880,
    'C6': 1046.50,
    'E6': 1318.51, // High soprano range
    'A6': 1760,
    'C7': 2093.00, // Whistle register
  };

  // Extended range to accommodate high soprano/whistle register
  const minHz = 50;
  const maxHz = 2200;

  onMount(() => {
    ctx = canvas.getContext('2d');
    resizeCanvas();

    // Use ResizeObserver for container resize detection
    resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    resizeObserver.observe(canvasContainer);

    animate();
  });

  onDestroy(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    cancelAnimationFrame(animationId);
    unsubscribePitch();
    unsubscribeState();
  });

  function resizeCanvas() {
    const rect = canvasContainer?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      width = rect.width;
      height = rect.height;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (ctx) {
        ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
      }
    }
  }

  function animate() {
    draw();
    animationId = requestAnimationFrame(animate);
  }

  function hzToY(hz: number): number {
    if (hz <= 0) return height;
    const ratio = Math.log10(hz / minHz) / Math.log10(maxHz / minHz);
    return height * (1 - ratio);
  }

  function freqToNote(freq: number): string {
    if (freq <= 0) return '--';
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const semitone = 12 * Math.log2(freq / 440) + 69;
    const noteIndex = Math.round(semitone) % 12;
    const octave = Math.floor(Math.round(semitone) / 12) - 1;
    const cents = Math.round((semitone - Math.round(semitone)) * 100);
    return `${noteNames[noteIndex]}${octave} ${cents >= 0 ? '+' : ''}${cents}c`;
  }

  function draw() {
    if (!ctx) return;

    const marginLeft = 50;
    const marginRight = 100;
    const drawWidth = width - marginLeft - marginRight;
    const history = pitchData.history;

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // Draw note grid lines
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    Object.entries(noteFreqs).forEach(([note, freq]) => {
      const y = hzToY(freq);
      if (y > 10 && y < height - 10) {
        ctx.strokeStyle = note.startsWith('C') ? '#2a2a45' : '#1a1a25';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(marginLeft, y);
        ctx.lineTo(width - marginRight, y);
        ctx.stroke();

        ctx.fillStyle = note.startsWith('C') ? '#666' : '#444';
        ctx.fillText(note, marginLeft - 6, y + 3);
      }
    });

    // Draw pitch contour
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2;
    ctx.beginPath();

    let started = false;
    const step = drawWidth / history.length;

    for (let i = 0; i < history.length; i++) {
      const freq = history[i];
      if (freq > 0) {
        const x = marginLeft + i * step;
        const y = hzToY(freq);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();

    // Draw current pitch indicator
    if (pitchData.voiced && pitchData.frequency > 0) {
      const currentY = hzToY(pitchData.frequency);

      // Horizontal line
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(marginLeft, currentY);
      ctx.lineTo(width - marginRight, currentY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Current value display
      ctx.fillStyle = '#22d3ee';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${pitchData.frequency.toFixed(1)} Hz`, width - marginRight + 8, currentY + 4);

      ctx.fillStyle = '#f97316';
      ctx.fillText(freqToNote(pitchData.frequency), width - marginRight + 8, currentY + 18);
    }

    // Draw confidence bar with label
    const barWidth = 8;
    const barX = width - 22;
    const barHeight = height - 40;
    const barY = 25;

    // Background
    ctx.fillStyle = '#1a1a25';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Confidence fill - scale for visibility (Melodia often returns low values for mixed audio)
    // Boost display: 0.3 confidence shows as 60% bar height for better visibility
    const displayConfidence = Math.min(1, pitchData.confidence * 2);
    const confHeight = barHeight * displayConfidence;

    // Color based on actual confidence (not boosted)
    ctx.fillStyle = pitchData.confidence > 0.4 ? '#22c55e' :
                    pitchData.confidence > 0.2 ? '#eab308' : '#ef4444';
    ctx.fillRect(barX, barY + barHeight - confHeight, barWidth, confHeight);

    // Label
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#666';
    ctx.fillText('CONF', barX + barWidth / 2, barY - 6);
    ctx.fillText(`${Math.round(pitchData.confidence * 100)}%`, barX + barWidth / 2, barY + barHeight + 12);

    // Voice indicator
    const voiceIndicatorY = height - 30;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = pitchData.voiced ? '#22c55e' : '#444';
    ctx.fillText(pitchData.voiced ? 'VOICED' : 'UNVOICED', marginLeft + drawWidth / 2, voiceIndicatorY);
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">PITCH (F0)</span>
    <span class="panel-subtitle">Fundamental Frequency</span>
    <div class="header-spacer"></div>
    <div class="mode-selector">
      <select bind:value={pitchMode} on:change={handleModeChange}>
        <option value="off">Local</option>
        <option value="melodia">Melodia</option>
        <option value="crepe">CREPE</option>
        <option value="auto">Auto</option>
      </select>
      {#if pitchMode !== 'off'}
        <span class="algorithm-badge">{pitchAlgorithm}</span>
      {/if}
    </div>
  </div>
  <div class="canvas-container" bind:this={canvasContainer}>
    <canvas bind:this={canvas}></canvas>
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
    gap: 0.75rem;
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

  .panel-subtitle {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: var(--text-secondary);
  }

  .header-spacer {
    flex: 1;
  }

  .mode-selector {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .mode-selector select {
    background: var(--bg-primary);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    cursor: pointer;
    outline: none;
  }

  .mode-selector select:hover {
    border-color: var(--accent-color);
  }

  .mode-selector select:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 1px var(--accent-color);
  }

  .algorithm-badge {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    padding: 0.125rem 0.375rem;
    background: #22c55e33;
    color: #22c55e;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .canvas-container {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
</style>
