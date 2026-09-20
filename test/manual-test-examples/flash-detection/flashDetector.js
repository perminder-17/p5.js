/*
 * Proof of concept for WCAG 2.3.1 / 2.3.2 flash detection.
 * See https://github.com/processing/p5.js/issues/7841
 *
 * Deliberately has no p5 or WebGL dependency: it takes any HTMLCanvasElement,
 * so the same code path works for P2D and WEBGL sketches.
 *
 * What it implements from the "general flash and red flash thresholds" definition:
 *
 *   - Relative luminance with the sRGB -> linear step (0.2126R + 0.7152G + 0.0722B).
 *   - A flash is a *pair of opposing transitions*, not any luminance change, so
 *     smooth fades and pans do not register.
 *   - A transition only counts when the change is >= 0.10 and the darker of the
 *     two states is below 0.80.
 *   - Area is measured inside *any* 10 degree visual field (341x256 px), not as a
 *     percentage of the whole canvas.
 *   - Red flashes use R/(R+G+B) >= 0.8 plus a CIE 1976 UCS distance > 0.2.
 *   - Fine checkerboards and white noise are excluded, via the box-filtered
 *     downscale plus a 3x3 blur over the grid. The blur matters: one grid cell
 *     only averages a few dozen noise pixels, so without it the sampling noise
 *     alone clears the 0.10 threshold.
 *
 * Known gaps, worth raising on the issue rather than hiding:
 *   - The downscale averages in gamma space, since that is what the browser gives
 *     us. Averaging in linear space would be more correct.
 *   - Red flashes are only sampled at luminance extremes, so a pure chroma flash
 *     at constant luminance can slip through.
 */

const FIELD_W = 341; // 10 degree visual field at 1024x768, per WCAG note 1
const FIELD_H = 256;
const AREA_LIMIT = 0.25 * FIELD_W * FIELD_H;

const LUM_DELTA = 0.1;
const DARK_LIMIT = 0.8;
const DEADBAND = 0.02;
const RED_RATIO = 0.8;
const UCS_DELTA = 0.2;
const WINDOW_MS = 1000;
const FLASH_LIMIT = 3;

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Only the final tiny grid is read back, so only it wants willReadFrequently.
// Setting it on the intermediates drops them out of the GPU and costs 2-3x.
function makeCanvas(w, h, readBack = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', readBack ? { willReadFrequently: true } : {});
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas: c, ctx };
}

export class FlashDetector {
  constructor(source, { cols = 32, rows = 24 } = {}) {
    this.source = source;
    this.cols = cols;
    this.rows = rows;

    const n = cols * rows;
    this.luminance = new Float32Array(n);
    this.hot = new Uint8Array(n);
    this.hotRed = new Uint8Array(n);

    this._rawL = new Float32Array(n);
    this._u = new Float32Array(n);
    this._v = new Float32Array(n);
    this._red = new Float32Array(n);
    this._ok = new Uint8Array(n);

    this._prevL = new Float32Array(n);
    this._dir = new Int8Array(n);
    this._runExt = new Float32Array(n);
    this._lastExt = new Float32Array(n);
    this._runU = new Float32Array(n);
    this._runV = new Float32Array(n);
    this._runRed = new Float32Array(n);
    this._runOk = new Uint8Array(n);
    this._lastU = new Float32Array(n);
    this._lastV = new Float32Array(n);
    this._lastRed = new Float32Array(n);
    this._lastOk = new Uint8Array(n);

    this._general = Array.from({ length: n }, () => []);
    this._redEvents = Array.from({ length: n }, () => []);

    this._sat = new Int32Array((cols + 1) * (rows + 1));
    this._satRed = new Int32Array((cols + 1) * (rows + 1));
    this._primed = false;

    const grid = makeCanvas(cols, rows, true);
    this._grid = grid.canvas;
    this._gridCtx = grid.ctx;
    this._pingA = makeCanvas(1, 1);
    this._pingB = makeCanvas(1, 1);

    this.report = {
      flashesPerSecond: 0,
      redFlashesPerSecond: 0,
      hotCells: 0,
      fieldArea: 0,
      fieldPercent: 0,
      redFieldPercent: 0,
      canvasPercent: 0,
      fails: false,
      failsRed: false
    };
  }

  update(now = performance.now()) {
    this._downscale();
    const px = this._gridCtx.getImageData(0, 0, this.cols, this.rows).data;
    const n = this.cols * this.rows;

    for (let i = 0; i < n; i++) {
      const r = px[i * 4];
      const g = px[i * 4 + 1];
      const b = px[i * 4 + 2];
      const lr = LINEAR[r];
      const lg = LINEAR[g];
      const lb = LINEAR[b];
      const L = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      this._rawL[i] = L;

      const X = 0.4124 * lr + 0.3576 * lg + 0.1805 * lb;
      const Z = 0.0193 * lr + 0.1192 * lg + 0.9505 * lb;
      const denom = X + 15 * L + 3 * Z;
      const ok = denom > 1e-6 ? 1 : 0;
      this._ok[i] = ok;
      this._u[i] = ok ? (4 * X) / denom : 0;
      this._v[i] = ok ? (9 * L) / denom : 0;
      const sum = r + g + b;
      this._red[i] = sum > 0 ? r / sum : 0;
    }

    this._blur();

    for (let i = 0; i < n; i++) {
      const L = this.luminance[i];
      const u = this._u[i];
      const v = this._v[i];
      const red = this._red[i];
      const ok = this._ok[i];

      if (!this._primed) {
        this._prevL[i] = L;
        this._runExt[i] = L;
        this._lastExt[i] = L;
        this._storeRun(i, u, v, red, ok);
        this._runToLast(i);
        continue;
      }

      const d = this._dir[i];
      if (d === 0) {
        if (L > this._runExt[i] + DEADBAND) this._dir[i] = 1;
        else if (L < this._runExt[i] - DEADBAND) this._dir[i] = -1;
        if (this._dir[i] !== 0) {
          this._runExt[i] = L;
          this._storeRun(i, u, v, red, ok);
        }
      } else if (d === 1) {
        if (L >= this._runExt[i]) {
          this._runExt[i] = L;
          this._storeRun(i, u, v, red, ok);
        } else if (this._runExt[i] - L > DEADBAND) {
          this._commit(i, now);
          this._dir[i] = -1;
          this._runExt[i] = L;
          this._storeRun(i, u, v, red, ok);
        }
      } else {
        if (L <= this._runExt[i]) {
          this._runExt[i] = L;
          this._storeRun(i, u, v, red, ok);
        } else if (L - this._runExt[i] > DEADBAND) {
          this._commit(i, now);
          this._dir[i] = 1;
          this._runExt[i] = L;
          this._storeRun(i, u, v, red, ok);
        }
      }
      this._prevL[i] = L;
    }

    this._primed = true;
    this._score(now);
    return this.report;
  }

  _blur() {
    const { cols, rows } = this;
    const src = this._rawL;
    const dst = this.luminance;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= cols) continue;
            sum += src[yy * cols + xx];
            count++;
          }
        }
        dst[y * cols + x] = sum / count;
      }
    }
  }

  reset() {
    this._primed = false;
    this._dir.fill(0);
    for (let i = 0; i < this._general.length; i++) {
      this._general[i].length = 0;
      this._redEvents[i].length = 0;
    }
    this.hot.fill(0);
    this.hotRed.fill(0);
  }

  _storeRun(i, u, v, red, ok) {
    this._runU[i] = u;
    this._runV[i] = v;
    this._runRed[i] = red;
    this._runOk[i] = ok;
  }

  _runToLast(i) {
    this._lastU[i] = this._runU[i];
    this._lastV[i] = this._runV[i];
    this._lastRed[i] = this._runRed[i];
    this._lastOk[i] = this._runOk[i];
  }

  _commit(i, now) {
    const a = this._lastExt[i];
    const b = this._runExt[i];
    if (Math.abs(a - b) >= LUM_DELTA && Math.min(a, b) < DARK_LIMIT) {
      this._general[i].push(now);
    }
    const involvesRed =
      this._lastRed[i] >= RED_RATIO || this._runRed[i] >= RED_RATIO;
    if (involvesRed && this._lastOk[i] && this._runOk[i]) {
      const du = this._lastU[i] - this._runU[i];
      const dv = this._lastV[i] - this._runV[i];
      if (Math.sqrt(du * du + dv * dv) > UCS_DELTA) this._redEvents[i].push(now);
    }
    this._lastExt[i] = b;
    this._runToLast(i);
  }

  _downscale() {
    const src = this.source;
    let w = src.width;
    let h = src.height;
    let from = src;
    let target = this._pingA;
    let other = this._pingB;

    // Halve repeatedly so the box filter really averages fine patterns away.
    while (w > this.cols * 2 && h > this.rows * 2) {
      const nw = Math.max(this.cols, w >> 1);
      const nh = Math.max(this.rows, h >> 1);
      if (target.canvas.width !== nw || target.canvas.height !== nh) {
        target.canvas.width = nw;
        target.canvas.height = nh;
        target.ctx.imageSmoothingEnabled = true;
        target.ctx.imageSmoothingQuality = 'high';
      }
      target.ctx.drawImage(from, 0, 0, w, h, 0, 0, nw, nh);
      from = target.canvas;
      w = nw;
      h = nh;
      const swap = target;
      target = other;
      other = swap;
    }

    this._gridCtx.drawImage(from, 0, 0, w, h, 0, 0, this.cols, this.rows);
  }

  _score(now) {
    const { cols, rows } = this;
    const n = cols * rows;
    let maxFlashes = 0;
    let maxRed = 0;
    let hotCount = 0;

    for (let i = 0; i < n; i++) {
      const g = this._general[i];
      while (g.length && now - g[0] > WINDOW_MS) g.shift();
      const r = this._redEvents[i];
      while (r.length && now - r[0] > WINDOW_MS) r.shift();

      const flashes = Math.floor(g.length / 2);
      const redFlashes = Math.floor(r.length / 2);
      if (flashes > maxFlashes) maxFlashes = flashes;
      if (redFlashes > maxRed) maxRed = redFlashes;

      this.hot[i] = flashes > FLASH_LIMIT ? 1 : 0;
      this.hotRed[i] = redFlashes > FLASH_LIMIT ? 1 : 0;
      if (this.hot[i]) hotCount++;
    }

    const cssW = this.source.clientWidth || this.source.width;
    const cssH = this.source.clientHeight || this.source.height;
    const cellArea = (cssW / cols) * (cssH / rows);
    const winCols = Math.min(cols, Math.max(1, Math.round(FIELD_W / (cssW / cols))));
    const winRows = Math.min(rows, Math.max(1, Math.round(FIELD_H / (cssH / rows))));

    const peak = this._windowPeak(this._sat, this.hot, winCols, winRows);
    const peakRed = this._windowPeak(this._satRed, this.hotRed, winCols, winRows);

    const rep = this.report;
    rep.flashesPerSecond = maxFlashes;
    rep.redFlashesPerSecond = maxRed;
    rep.hotCells = hotCount;
    rep.fieldArea = peak * cellArea;
    rep.fieldPercent = (peak * cellArea) / (FIELD_W * FIELD_H) * 100;
    rep.redFieldPercent = (peakRed * cellArea) / (FIELD_W * FIELD_H) * 100;
    rep.canvasPercent = (hotCount / n) * 100;
    rep.fails = peak * cellArea > AREA_LIMIT;
    rep.failsRed = peakRed * cellArea > AREA_LIMIT;
  }

  _windowPeak(sat, flags, winCols, winRows) {
    const { cols, rows } = this;
    const stride = cols + 1;
    sat.fill(0);
    for (let y = 0; y < rows; y++) {
      let rowSum = 0;
      for (let x = 0; x < cols; x++) {
        rowSum += flags[y * cols + x];
        sat[(y + 1) * stride + x + 1] = sat[y * stride + x + 1] + rowSum;
      }
    }
    let peak = 0;
    for (let y = 0; y + winRows <= rows; y++) {
      for (let x = 0; x + winCols <= cols; x++) {
        const s =
          sat[(y + winRows) * stride + x + winCols] -
          sat[y * stride + x + winCols] -
          sat[(y + winRows) * stride + x] +
          sat[y * stride + x];
        if (s > peak) peak = s;
      }
    }
    return peak;
  }
}

/*
 * The approach described on the issue thread: accumulate per frame luminance
 * change and let it decay. Included only so the two can be compared side by
 * side, since it cannot tell a smooth fade apart from a strobe.
 */
export class NaiveLeakyIntegrator {
  constructor({ tau = 300, limit = 0.4 } = {}) {
    this.tau = tau;
    this.limit = limit;
    this.level = 0;
    this._prev = null;
  }

  update(luminance, dtMs) {
    if (this._prev && this._prev.length === luminance.length) {
      let sum = 0;
      for (let i = 0; i < luminance.length; i++) {
        sum += Math.abs(luminance[i] - this._prev[i]);
      }
      this.level =
        this.level * Math.exp(-dtMs / this.tau) + sum / luminance.length;
    }
    this._prev = Float32Array.from(luminance);
    return this.level;
  }

  get fails() {
    return this.level > this.limit;
  }

  reset() {
    this.level = 0;
    this._prev = null;
  }
}
