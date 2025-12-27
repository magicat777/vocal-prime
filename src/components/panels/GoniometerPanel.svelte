<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { vocalEngine } from '../../core/VocalEngine';

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number;

  // Display mode
  type DisplayMode = 'gonio' | 'vector' | 'polar';
  let displayMode: DisplayMode = 'gonio';

  function cycleDisplayMode() {
    if (displayMode === 'gonio') displayMode = 'vector';
    else if (displayMode === 'vector') displayMode = 'polar';
    else displayMode = 'gonio';

    // Clear persistence buffer on mode change
    if (persistenceBuffer) {
      persistenceBuffer.data.fill(0);
    }
  }

  $: panelTitle = displayMode === 'gonio' ? 'GONIOMETER' : displayMode === 'vector' ? 'VECTORSCOPE' : 'POLAR SCOPE';
  $: modeLabel = displayMode === 'gonio' ? 'M/S' : displayMode === 'vector' ? 'L/R' : 'POL';

  // Persistence buffer for phosphor effect
  let persistenceBuffer: ImageData | null = null;
  let canvasSize = 180;

  // Decay lookup table
  const DECAY_LUT = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    DECAY_LUT[i] = (i * 0.94) | 0;
  }

  let resizeObserver: ResizeObserver | null = null;

  function handleResize(width: number, height: number) {
    const size = Math.floor(Math.min(width, height));
    if (size === canvasSize || size < 50) return;

    canvasSize = size;
    canvas.width = size;
    canvas.height = size;

    if (ctx) {
      persistenceBuffer = ctx.createImageData(size, size);
    }
  }

  onMount(() => {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    persistenceBuffer = ctx.createImageData(canvasSize, canvasSize);

    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        handleResize(width, height);
      }
    });
    resizeObserver.observe(container);

    animate();
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  });

  function animate() {
    render();
    animationId = requestAnimationFrame(animate);
  }

  function render() {
    if (!ctx || !persistenceBuffer) return;

    const width = canvas.width;
    const height = canvas.height;

    if (persistenceBuffer.width !== width || persistenceBuffer.height !== height) {
      persistenceBuffer = ctx.createImageData(width, height);
    }

    const centerX = width / 2;
    const centerY = height / 2;
    const scale = Math.min(width, height) / 2 - 12;

    // Decay persistence buffer
    const data = persistenceBuffer.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = DECAY_LUT[data[i]];
      data[i + 1] = DECAY_LUT[data[i + 1]];
      data[i + 2] = DECAY_LUT[data[i + 2]];
    }

    // Get stereo samples
    const samples = get(vocalEngine.stereoSamples);

    // Draw samples based on display mode
    for (let i = 0; i < samples.length - 1; i += 2) {
      const l = samples[i];
      const r = samples[i + 1];

      let px: number, py: number;
      let sideAmount: number;

      if (displayMode === 'gonio') {
        // GONIOMETER: M/S Lissajous
        const x = (r - l) * 0.707;
        const y = (l + r) * 0.707;
        px = Math.floor(centerX + x * scale);
        py = Math.floor(centerY - y * scale);
        sideAmount = Math.abs(x);
      } else if (displayMode === 'vector') {
        // VECTORSCOPE: Raw L/R as X/Y
        px = Math.floor(centerX + r * scale);
        py = Math.floor(centerY - l * scale);
        sideAmount = Math.abs(r - l) * 0.5;
      } else {
        // POLAR: Angle = pan, Radius = amplitude
        const amplitude = Math.sqrt(l * l + r * r);
        const mid = l + r;
        const side = r - l;
        let panAngle = 0;
        if (Math.abs(mid) > 0.001 || Math.abs(side) > 0.001) {
          panAngle = Math.atan2(side, Math.abs(mid)) * (180 / Math.PI);
        }
        const angleRad = (panAngle - 90) * (Math.PI / 180);
        const polarScale = Math.min(width, height) - 20;
        const radius = amplitude * polarScale * 0.45;
        const polarCenterY = height - 10;
        px = Math.floor(centerX + Math.cos(angleRad) * radius);
        py = Math.floor(polarCenterY + Math.sin(angleRad) * radius);
        sideAmount = Math.abs(panAngle) / 90;
      }

      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;
        const intensity = Math.min(255, 100 + Math.abs(l + r) * 500);

        data[idx] = Math.min(255, data[idx] + 50 + sideAmount * 150);
        data[idx + 1] = Math.min(255, data[idx + 1] + intensity);
        data[idx + 2] = Math.min(255, data[idx + 2] + 30 + sideAmount * 50);
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(persistenceBuffer, 0, 0);

    // Draw grid
    const fontSize = Math.max(8, Math.floor(canvasSize / 22));
    ctx.font = `${fontSize}px monospace`;

    if (displayMode === 'polar') {
      // POLAR MODE: Semi-circular grid
      const polarCenterY = height - 10;
      const polarScale = Math.min(width, height) - 20;
      const polarRadius = polarScale * 0.45;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      for (let r = 0.25; r <= 1; r += 0.25) {
        ctx.beginPath();
        ctx.arc(centerX, polarCenterY, polarRadius * r, -Math.PI, 0);
        ctx.stroke();
      }

      // Radial lines
      const angles = [-90, -45, 0, 45, 90];
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      for (const deg of angles) {
        const angleRad = (deg - 90) * (Math.PI / 180);
        ctx.beginPath();
        ctx.moveTo(centerX, polarCenterY);
        ctx.lineTo(centerX + Math.cos(angleRad) * polarRadius, polarCenterY + Math.sin(angleRad) * polarRadius);
        ctx.stroke();
      }

      // Center line (mono) brighter
      ctx.strokeStyle = 'rgba(100, 255, 100, 0.15)';
      ctx.beginPath();
      ctx.moveTo(centerX, polarCenterY);
      ctx.lineTo(centerX, polarCenterY - polarRadius);
      ctx.stroke();

      // Labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('C', centerX, polarCenterY - polarRadius - 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('L', centerX - polarRadius - 2, polarCenterY + 2);
      ctx.textAlign = 'left';
      ctx.fillText('R', centerX + polarRadius + 2, polarCenterY + 2);
    } else {
      // GONIO and VECTOR modes
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;

      // Main axes
      ctx.beginPath();
      ctx.moveTo(centerX, 4);
      ctx.lineTo(centerX, height - 4);
      ctx.moveTo(4, centerY);
      ctx.lineTo(width - 4, centerY);
      ctx.stroke();

      // Diagonals
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(4, height - 4);
      ctx.lineTo(width - 4, 4);
      ctx.moveTo(4, 4);
      ctx.lineTo(width - 4, height - 4);
      ctx.stroke();

      // Reference circles
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, scale * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(centerX, centerY, scale, 0, Math.PI * 2);
      ctx.stroke();

      // Labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      if (displayMode === 'gonio') {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('+M', centerX, 2);
        ctx.textBaseline = 'bottom';
        ctx.fillText('-M', centerX, height - 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('L', 2, centerY);
        ctx.textAlign = 'right';
        ctx.fillText('R', width - 2, centerY);
      } else {
        // Vectorscope labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('+L', centerX, 2);
        ctx.textBaseline = 'bottom';
        ctx.fillText('-L', centerX, height - 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('-R', 2, centerY);
        ctx.textAlign = 'right';
        ctx.fillText('+R', width - 2, centerY);

        // Mono line (45° diagonal) brighter
        ctx.strokeStyle = 'rgba(100, 255, 100, 0.1)';
        ctx.beginPath();
        ctx.moveTo(4, height - 4);
        ctx.lineTo(width - 4, 4);
        ctx.stroke();
      }
    }
  }
</script>

<div class="panel" bind:this={container}>
  <div class="panel-header">
    <span class="panel-title">{panelTitle}</span>
    <button class="mode-toggle" on:click={cycleDisplayMode}>{modeLabel}</button>
  </div>
  <div class="canvas-container">
    <canvas bind:this={canvas} width={canvasSize} height={canvasSize}></canvas>
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

  .panel-title {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--text-primary);
  }

  .canvas-container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 0;
    overflow: hidden;
    padding: 0.5rem;
  }

  canvas {
    background: rgb(8, 8, 12);
    border-radius: 4px;
    max-width: 100%;
    max-height: 100%;
  }
</style>
