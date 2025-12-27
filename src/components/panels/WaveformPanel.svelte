<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { vocalEngine } from '../../core/VocalEngine';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number;
  let width = 0;
  let height = 0;

  // Subscribe to waveform data
  let waveformData = { left: new Float32Array(2048), right: new Float32Array(2048), mono: new Float32Array(2048) };
  const unsubscribe = vocalEngine.waveform.subscribe(data => {
    waveformData = data;
  });

  onMount(() => {
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    animate();
  });

  onDestroy(() => {
    window.removeEventListener('resize', resizeCanvas);
    cancelAnimationFrame(animationId);
    unsubscribe();
  });

  function resizeCanvas() {
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      width = rect.width;
      height = rect.height;
      canvas.width = width * window.devicePixelRatio;
      canvas.height = height * window.devicePixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx?.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
  }

  function animate() {
    draw();
    animationId = requestAnimationFrame(animate);
  }

  function draw() {
    if (!ctx) return;

    const marginLeft = 28; // Space for amplitude labels
    const marginRight = 8;
    const drawWidth = width - marginLeft - marginRight;

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // Draw amplitude grid and labels for each channel
    const channelHeight = height / 2;
    drawChannelGrid(0, channelHeight, marginLeft, drawWidth);
    drawChannelGrid(channelHeight, channelHeight, marginLeft, drawWidth);

    // Draw time grid (vertical lines)
    ctx.strokeStyle = '#1a1a25';
    ctx.lineWidth = 1;
    const timeMarkers = 5; // Number of time divisions
    for (let i = 1; i < timeMarkers; i++) {
      const x = marginLeft + (i / timeMarkers) * drawWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw left channel (top half, cyan)
    drawChannel(waveformData.left, '#22d3ee', 0, channelHeight, marginLeft, drawWidth);

    // Draw right channel (bottom half, magenta)
    drawChannel(waveformData.right, '#f472b6', channelHeight, channelHeight, marginLeft, drawWidth);

    // Channel labels
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#22d3ee';
    ctx.fillText('L', marginLeft + 4, 14);
    ctx.fillStyle = '#f472b6';
    ctx.fillText('R', marginLeft + 4, channelHeight + 14);
  }

  function drawChannelGrid(yOffset: number, channelHeight: number, marginLeft: number, drawWidth: number) {
    if (!ctx) return;

    const centerY = yOffset + channelHeight / 2;
    const amplitude = channelHeight / 2 * 0.9;

    // Horizontal grid lines at amplitude levels
    const ampLevels = [1, 0.5, 0, -0.5, -1];
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';

    ampLevels.forEach(level => {
      const y = centerY - level * amplitude;

      // Grid line
      ctx.strokeStyle = level === 0 ? '#2a2a35' : '#1a1a25';
      ctx.lineWidth = level === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(marginLeft, y);
      ctx.lineTo(marginLeft + drawWidth, y);
      ctx.stroke();

      // Label (skip 0 for cleaner look, show +1, +0.5, -0.5, -1)
      if (level !== 0) {
        ctx.fillStyle = '#555';
        const label = level > 0 ? `+${level}` : `${level}`;
        ctx.fillText(label, marginLeft - 4, y + 3);
      }
    });
  }

  function drawChannel(samples: Float32Array, color: string, yOffset: number, channelHeight: number, marginLeft: number, drawWidth: number) {
    if (!ctx || samples.length === 0) return;

    const centerY = yOffset + channelHeight / 2;
    const amplitude = channelHeight / 2 * 0.9;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const step = samples.length / drawWidth;
    for (let i = 0; i < drawWidth; i++) {
      const x = marginLeft + i;
      const sampleIdx = Math.floor(i * step);
      const sample = samples[sampleIdx] || 0;
      const y = centerY - sample * amplitude;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">WAVEFORM</span>
    <span class="panel-subtitle">Stereo L/R</span>
  </div>
  <div class="canvas-container">
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
