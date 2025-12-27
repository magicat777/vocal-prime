<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { vocalEngine } from '../../core/VocalEngine';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number;
  let width = 0;
  let height = 0;

  // Subscribe to formant data
  let formantData = { F1: 0, F2: 0, F3: 0, F4: 0, detected: false };
  const unsubscribe = vocalEngine.formants.subscribe(data => {
    formantData = data;
  });

  // Vowel reference points (approximate F1/F2 for American English)
  const vowelRefs: { [key: string]: [number, number] } = {
    'i': [270, 2300],   // "ee" in "beet"
    'ɪ': [390, 1990],   // "i" in "bit"
    'e': [530, 1840],   // "ay" in "bait"
    'ɛ': [610, 1900],   // "e" in "bet"
    'æ': [660, 1720],   // "a" in "bat"
    'ɑ': [730, 1090],   // "o" in "bot"
    'ɔ': [590, 880],    // "aw" in "bought"
    'o': [450, 1030],   // "o" in "boat"
    'ʊ': [440, 1020],   // "oo" in "book"
    'u': [300, 870],    // "oo" in "boot"
  };

  // F1/F2 ranges for display
  const f1Min = 200, f1Max = 900;
  const f2Min = 600, f2Max = 2800;

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

  function f1ToY(f1: number): number {
    // F1 increases downward (inverted)
    const ratio = (f1 - f1Min) / (f1Max - f1Min);
    return 40 + ratio * (height - 80);
  }

  function f2ToX(f2: number): number {
    // F2 decreases rightward (inverted, traditional vowel chart)
    const ratio = (f2 - f2Min) / (f2Max - f2Min);
    return 60 + (1 - ratio) * (width - 180);
  }

  function draw() {
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = '#1a1a25';
    ctx.lineWidth = 1;

    // F1 grid (horizontal)
    for (let f1 = 300; f1 <= 800; f1 += 100) {
      const y = f1ToY(f1);
      ctx.beginPath();
      ctx.moveTo(60, y);
      ctx.lineTo(width - 120, y);
      ctx.stroke();

      ctx.font = '9px monospace';
      ctx.fillStyle = '#444';
      ctx.textAlign = 'right';
      ctx.fillText(`${f1}`, 55, y + 3);
    }

    // F2 grid (vertical)
    for (let f2 = 1000; f2 <= 2500; f2 += 500) {
      const x = f2ToX(f2);
      ctx.beginPath();
      ctx.moveTo(x, 40);
      ctx.lineTo(x, height - 40);
      ctx.stroke();

      ctx.font = '9px monospace';
      ctx.fillStyle = '#444';
      ctx.textAlign = 'center';
      ctx.fillText(`${f2}`, x, height - 25);
    }

    // Axis labels
    ctx.font = '10px monospace';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('F2 (Hz)', width / 2, height - 8);

    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('F1 (Hz)', 0, 0);
    ctx.restore();

    // Draw vowel reference points
    ctx.font = '11px sans-serif';
    Object.entries(vowelRefs).forEach(([vowel, [f1, f2]]) => {
      const x = f2ToX(f2);
      const y = f1ToY(f1);

      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#555';
      ctx.textAlign = 'center';
      ctx.fillText(vowel, x, y - 8);
    });

    // Draw current formants
    if (formantData.detected && formantData.F1 > 0 && formantData.F2 > 0) {
      const x = f2ToX(formantData.F2);
      const y = f1ToY(formantData.F1);

      // Current position marker
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw formant values sidebar
    const sidebarX = width - 110;
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';

    const formants = [
      { label: 'F1', value: formantData.F1, color: '#22d3ee' },
      { label: 'F2', value: formantData.F2, color: '#a78bfa' },
      { label: 'F3', value: formantData.F3, color: '#f472b6' },
      { label: 'F4', value: formantData.F4, color: '#fbbf24' },
    ];

    formants.forEach((f, i) => {
      const y = 50 + i * 28;
      ctx.fillStyle = f.color;
      ctx.fillText(f.label, sidebarX, y);
      ctx.fillStyle = formantData.detected ? '#fff' : '#444';
      ctx.fillText(`${f.value.toFixed(0)} Hz`, sidebarX + 25, y);
    });

    // Detection status
    ctx.font = '10px monospace';
    ctx.fillStyle = formantData.detected ? '#22c55e' : '#ef4444';
    ctx.fillText(formantData.detected ? 'DETECTED' : 'NO VOICE', sidebarX, 180);
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">FORMANTS</span>
    <span class="panel-subtitle">F1-F4 Vowel Space</span>
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
