import { FlashDetector } from './flashDetector.js';
import { GpuFlashDetector } from './gpuDetector.js';

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/*
 * The same per-pixel work the shader does, written as a flat CPU loop.
 * FlashDetector itself is built for coarse grids and allocates a timestamp
 * array per cell, so it is not a fair stand-in at per-pixel resolution.
 */
class MinimalCpuDetector {
  constructor(source) {
    this.source = source;
    const w = source.width;
    const h = source.height;
    this.w = w;
    this.h = h;
    this.grid = document.createElement('canvas');
    this.grid.width = w;
    this.grid.height = h;
    this.ctx = this.grid.getContext('2d', { willReadFrequently: true });
    const n = w * h;
    this.lastExt = new Float32Array(n);
    this.runExt = new Float32Array(n);
    this.dir = new Int8Array(n);
    this.count = new Uint16Array(n);
    this.hits = 0;
  }

  update() {
    this.ctx.drawImage(this.source, 0, 0);
    const px = this.ctx.getImageData(0, 0, this.w, this.h).data;
    const n = this.w * this.h;
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const L =
        0.2126 * LIN[px[i * 4]] +
        0.7152 * LIN[px[i * 4 + 1]] +
        0.0722 * LIN[px[i * 4 + 2]];
      const d = this.dir[i];
      let commit = false;
      if (d === 0) {
        if (L > this.runExt[i] + 0.02) { this.dir[i] = 1; this.runExt[i] = L; }
        else if (L < this.runExt[i] - 0.02) { this.dir[i] = -1; this.runExt[i] = L; }
      } else if (d === 1) {
        if (L >= this.runExt[i]) this.runExt[i] = L;
        else if (this.runExt[i] - L > 0.02) { commit = true; }
      } else {
        if (L <= this.runExt[i]) this.runExt[i] = L;
        else if (L - this.runExt[i] > 0.02) { commit = true; }
      }
      if (commit) {
        const a = this.lastExt[i];
        const b = this.runExt[i];
        if (Math.abs(a - b) >= 0.1 && Math.min(a, b) < 0.8) hits++;
        this.lastExt[i] = b;
        this.dir[i] = -this.dir[i];
        this.runExt[i] = L;
      }
    }
    this.hits = hits;
    return hits;
  }
}

function makeSource(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  return { canvas: c, ctx };
}

// One pixel alternating black/white, everything else static grey. This is the
// case an averaging pyramid loses and a sum pyramid keeps.
function drawSinglePixel({ ctx }, w, h, frame) {
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = frame % 2 ? '#fff' : '#000';
  ctx.fillRect((w >> 1), (h >> 1), 1, 1);
}

function drawFullStrobe({ ctx }, w, h, frame) {
  ctx.fillStyle = frame % 2 ? '#fff' : '#000';
  ctx.fillRect(0, 0, w, h);
}

function time(fn, n) {
  for (let i = 0; i < 10; i++) fn(i);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn(i + 10);
  return (performance.now() - t0) / n;
}

function correctness() {
  const w = 900;
  const h = 600;
  const src = makeSource(w, h);
  const gpu = new GpuFlashDetector(src.canvas, { asyncReadback: false });
  const cpu = new FlashDetector(src.canvas, { cols: 32, rows: 24 });

  let gpuHits = 0;
  let cpuHits = 0;
  let minHits = 0;
  const minimal = new MinimalCpuDetector(src.canvas);
  for (let f = 0; f < 40; f++) {
    drawSinglePixel(src, w, h, f);
    if (gpu.update() > 0) gpuHits++;
    cpu.update(f * 16.67);
    if (cpu.report.flashesPerSecond > 0) cpuHits++;
    if (minimal.update() > 0) minHits++;
  }

  const src2 = makeSource(w, h);
  const gpu2 = new GpuFlashDetector(src2.canvas, { asyncReadback: false });
  let fullHits = 0;
  let peak = 0;
  for (let f = 0; f < 40; f++) {
    drawFullStrobe(src2, w, h, f);
    const r = gpu2.update();
    if (r > 0) fullHits++;
    if (r > peak) peak = r;
  }

  return [
    'Correctness on a 900x600 source',
    '',
    'single flashing pixel, rest static grey:',
    `  GPU sum pyramid       detected on ${gpuHits}/40 frames`,
    `  CPU per-pixel         detected on ${minHits}/40 frames`,
    `  CPU 32x24 averaged    detected on ${cpuHits}/40 frames  (this is the dilution)`,
    '',
    'full canvas strobe:',
    `  GPU sum pyramid       detected on ${fullHits}/40 frames, peak count ${peak.toFixed(0)} of ${w * h} px`
  ].join('\n');
}

function performance_() {
  const sizes = [[400, 400], [900, 600], [1440, 800], [1920, 1080], [3840, 2160]];
  const rows = [
    'size          GPU queue   GPU sync read   CPU per-pixel   CPU 32x24 (level A)'
  ];

  for (const [w, h] of sizes) {
    const src = makeSource(w, h);
    const gl = new GpuFlashDetector(src.canvas, { asyncReadback: false });
    const glAsync = new GpuFlashDetector(src.canvas, { asyncReadback: true });

    const sync = time(f => {
      drawFullStrobe(src, w, h, f);
      gl.update();
    }, 60);

    const asyncMs = time(f => {
      drawFullStrobe(src, w, h, f);
      glAsync.update();
    }, 60);

    const cpuFine = new MinimalCpuDetector(src.canvas);
    const cpuFineMs = time(f => {
      drawFullStrobe(src, w, h, f);
      cpuFine.update();
    }, 30);

    const cpuCoarse = new FlashDetector(src.canvas, { cols: 32, rows: 24 });
    const cpuCoarseMs = time(f => {
      drawFullStrobe(src, w, h, f);
      cpuCoarse.update(f * 16.67);
    }, 60);

    rows.push(
      `${w}x${h}`.padEnd(13) +
      `${asyncMs.toFixed(2)}`.padStart(9) +
      `${sync.toFixed(2)}`.padStart(16) +
      `${cpuFineMs.toFixed(2)}`.padStart(16) +
      `${cpuCoarseMs.toFixed(2)}`.padStart(21)
    );
  }

  rows.push('');
  rows.push('ms/frame, main thread, including the sketch redraw itself.');
  rows.push('"GPU queue" is the async readback path: it only measures the time to');
  rows.push('queue the work, the GPU still does it, just off the critical path.');
  return rows.join('\n');
}

function breakdown() {
  const w = 900;
  const h = 600;
  const src = makeSource(w, h);
  const gl = new GpuFlashDetector(src.canvas, { asyncReadback: false });
  const ctx = gl.gl;

  const draw = time(f => drawFullStrobe(src, w, h, f), 60);
  const upload = time(f => {
    drawFullStrobe(src, w, h, f);
    gl.upload();
    ctx.finish();
  }, 60);
  const full = time(f => {
    drawFullStrobe(src, w, h, f);
    gl.upload();
    gl.passes();
    ctx.finish();
  }, 60);
  const withRead = time(f => {
    drawFullStrobe(src, w, h, f);
    gl.update();
  }, 60);

  return [
    'Where the time goes, 900x600, GPU path',
    '',
    `  sketch redraw only            ${draw.toFixed(2)} ms`,
    `  + canvas to texture upload    ${(upload - draw).toFixed(2)} ms`,
    `  + state pass and pyramid      ${(full - upload).toFixed(2)} ms`,
    `  + sync readPixels of 1 px     ${(withRead - full).toFixed(2)} ms`,
    `  pyramid levels                ${gl.chain.length}`
  ].join('\n');
}

window.flashBench = { correctness, performance: performance_, breakdown };

const out = document.getElementById('out');
document.getElementById('run').addEventListener('click', () => {
  out.textContent = 'running...';
  setTimeout(() => {
    out.textContent = [correctness(), '', breakdown(), '', performance_()].join('\n');
  }, 0);
});
