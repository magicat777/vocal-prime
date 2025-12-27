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

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // Draw center line
    ctx.strokeStyle = '#2a2a35';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw left channel (top half, cyan)
    drawChannel(waveformData.left, '#22d3ee', 0, height / 2);

    // Draw right channel (bottom half, magenta)
    drawChannel(waveformData.right, '#f472b6', height / 2, height / 2);

    // Labels
    ctx.font = '10px monospace';
    ctx.fillStyle = '#22d3ee';
    ctx.fillText('L', 8, 14);
    ctx.fillStyle = '#f472b6';
    ctx.fillText('R', 8, height / 2 + 14);
  }

  function drawChannel(samples: Float32Array, color: string, yOffset: number, channelHeight: number) {
    if (!ctx || samples.length === 0) return;

    const centerY = yOffset + channelHeight / 2;
    const amplitude = channelHeight / 2 * 0.9;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const step = samples.length / width;
    for (let x = 0; x < width; x++) {
      const sampleIdx = Math.floor(x * step);
      const sample = samples[sampleIdx] || 0;
      const y = centerY - sample * amplitude;

      if (x === 0) {
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
