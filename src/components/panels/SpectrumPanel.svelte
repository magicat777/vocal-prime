<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { vocalEngine } from '../../core/VocalEngine';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number;
  let width = 0;
  let height = 0;

  // Gain control
  let gain = 0; // dB

  // Subscribe to spectrum data
  let spectrumData = { bars: new Float32Array(512), peak: 0, rms: 0, gain: 0 };
  const unsubscribe = vocalEngine.spectrum.subscribe(data => {
    spectrumData = data;
  });

  // Frequency labels for log scale
  const freqLabels = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const minFreq = 20;
  const maxFreq = 20000;

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

  function freqToX(freq: number, drawWidth?: number): number {
    const ratio = Math.log10(freq / minFreq) / Math.log10(maxFreq / minFreq);
    return ratio * (drawWidth ?? width);
  }

  function handleGainChange(e: Event) {
    const target = e.target as HTMLInputElement;
    gain = parseFloat(target.value);
    vocalEngine.setSpectrumGain(gain);
  }

  // dB level labels for y-axis
  const dbLevels = [0, -6, -12, -18, -24, -30];
  const dbMin = -30; // Minimum dB level shown

  function draw() {
    if (!ctx) return;

    const bars = spectrumData.bars;
    const marginLeft = 32; // Space for dB labels
    const marginBottom = 24;
    const marginRight = 8;
    const drawWidth = width - marginLeft - marginRight;
    const drawHeight = height - marginBottom;

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // Draw horizontal grid lines with dB labels
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';

    dbLevels.forEach(db => {
      // Convert dB to normalized position (0dB = top, -30dB = bottom)
      // In audio: 0 dBFS is full scale (top), negative values are quieter (down)
      const normalized = db / dbMin;  // 0 → 0 (top), -30 → 1 (bottom)
      const y = normalized * drawHeight;

      // Grid line
      ctx.strokeStyle = db === 0 ? '#2a2a35' : '#1a1a25';
      ctx.lineWidth = db === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(marginLeft, y);
      ctx.lineTo(marginLeft + drawWidth, y);
      ctx.stroke();

      // dB label
      ctx.fillStyle = '#555';
      ctx.fillText(`${db}`, marginLeft - 4, y + 3);
    });

    // Vertical grid (frequency markers)
    ctx.strokeStyle = '#2a2a35';
    freqLabels.forEach(freq => {
      const x = marginLeft + freqToX(freq, drawWidth);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, drawHeight);
      ctx.stroke();
    });

    // Draw spectrum bars with gradient
    const barWidth = drawWidth / bars.length;
    const gradient = ctx.createLinearGradient(0, drawHeight, 0, 0);
    gradient.addColorStop(0, '#22c55e');
    gradient.addColorStop(0.5, '#eab308');
    gradient.addColorStop(0.8, '#f97316');
    gradient.addColorStop(1, '#ef4444');

    for (let i = 0; i < bars.length; i++) {
      const barHeight = bars[i] * drawHeight;
      const x = marginLeft + i * barWidth;

      ctx.fillStyle = gradient;
      ctx.fillRect(x, drawHeight - barHeight, barWidth - 1, barHeight);
    }

    // Draw frequency labels
    ctx.font = '9px monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    freqLabels.forEach(freq => {
      const x = marginLeft + freqToX(freq, drawWidth);
      const label = freq >= 1000 ? `${freq / 1000}k` : freq.toString();
      ctx.fillText(label, x, height - 6);
    });

    // Draw level meters
    const meterX = width - 70;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#22d3ee';
    ctx.fillText(`PK: ${(spectrumData.peak * 100).toFixed(0)}%`, meterX, 14);
    ctx.fillStyle = '#a78bfa';
    ctx.fillText(`RMS: ${(spectrumData.rms * 100).toFixed(0)}%`, meterX, 26);
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">SPECTRUM</span>
    <span class="panel-subtitle">20Hz - 20kHz</span>
    <div class="gain-control">
      <label for="gain">GAIN</label>
      <input
        type="range"
        id="gain"
        min="-20"
        max="20"
        step="1"
        value={gain}
        on:input={handleGainChange}
      />
      <span class="gain-value">{gain > 0 ? '+' : ''}{gain}dB</span>
    </div>
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

  .gain-control {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: var(--text-secondary);
  }

  .gain-control label {
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .gain-control input[type="range"] {
    width: 80px;
    height: 4px;
    background: var(--bg-primary);
    border-radius: 2px;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
  }

  .gain-control input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    background: var(--accent-primary);
    border-radius: 50%;
    cursor: pointer;
  }

  .gain-control input[type="range"]::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: var(--accent-primary);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .gain-value {
    min-width: 40px;
    text-align: right;
    color: var(--accent-primary);
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
