import { FlashDetector, NaiveLeakyIntegrator } from './flashDetector.js';

const W = 900;
const H = 600;
const COLS = 32;
const ROWS = 24;

// Square wave: hz full cycles per second, so hz flashes per second.
const wave = (t, hz) => Math.floor(t * hz * 2) % 2;

const MODES = [
  {
    name: 'Static grey',
    expect: 'pass',
    why: 'nothing changes',
    draw: p => p.background(128) 
  },
  {
    name: 'Smooth fade, 2 Hz',
    expect: 'pass',
    why: '2 flashes/sec is within the limit, but every single frame changes a lot',
    draw: (p, t) => p.background(128 + 127 * Math.sin(t * Math.PI * 4))
  },
  {
    name: 'Full canvas strobe, 2 Hz',
    expect: 'pass',
    why: '2 flashes/sec is at or below the limit of 3',
    draw: (p, t) => p.background(wave(t, 2) ? 255 : 0)
  },
  {
    name: 'Full canvas strobe, 8 Hz',
    expect: 'FAIL',
    why: '8 flashes/sec over the whole canvas',
    draw: (p, t) => p.background(wave(t, 8) ? 255 : 0)
  },
  {
    name: 'Tiny 40x40 square, 8 Hz',
    expect: 'pass',
    why: 'fast enough, but the area is far below 25% of a 10 degree field',
    draw: (p, t) => {
      p.background(128);
      p.fill(wave(t, 8) ? 255 : 0);
      p.rect(W / 2 - 20, H / 2 - 20, 40, 40);
    }
  },
  {
    name: 'Corner 260x200 region, 8 Hz',
    expect: 'FAIL',
    why: 'only ~10% of the canvas, but it fills one 10 degree field',
    draw: (p, t) => {
      p.background(128);
      p.fill(wave(t, 8) ? 255 : 0);
      p.rect(40, 40, 260, 200);
    }
  },
  {
    name: 'Fine 3px checkerboard, 8 Hz',
    expect: 'pass',
    why: 'balanced pattern below 0.1 degree, explicitly excepted',
    draw: (p, t, a) => p.image(wave(t, 8) ? a.checkerA : a.checkerB, 0, 0, W, H)
  },
  {
    name: 'White noise',
    expect: 'pass',
    why: 'also excepted, and it averages to a constant grey',
    draw: (p, t, a) =>
      p.image(a.noise[Math.floor(t * 60) % a.noise.length], 0, 0, W, H)
  },
  {
    name: 'Red / blue flash, 8 Hz',
    expect: 'FAIL',
    why: 'saturated red with a large chromaticity shift',
    draw: (p, t) => p.background(wave(t, 8) ? [255, 0, 0] : [0, 0, 255])
  }
];

new p5(p => {
  let detector;
  let naive;
  let assets;
  let mode = 0;
  let start = 0;
  let lastHud = 0;
  let heatCtx;

  const buildChecker = invert => {
    const img = p.createImage(300, 200);
    img.loadPixels();
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 300; x++) {
        const v = ((x + y) % 2 === 0) !== invert ? 255 : 0;
        const i = 4 * (y * 300 + x);
        img.pixels[i] = img.pixels[i + 1] = img.pixels[i + 2] = v;
        img.pixels[i + 3] = 255;
      }
    }
    img.updatePixels();
    return img;
  };

  const buildNoise = () => {
    const img = p.createImage(300, 200);
    img.loadPixels();
    for (let i = 0; i < img.pixels.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.pixels[i] = img.pixels[i + 1] = img.pixels[i + 2] = v;
      img.pixels[i + 3] = 255;
    }
    img.updatePixels();
    return img;
  };

  p.setup = () => {
    const c = p.createCanvas(W, H);
    c.parent('stage');
    p.noSmooth();
    p.noStroke();

    assets = {
      checkerA: buildChecker(false),
      checkerB: buildChecker(true),
      noise: Array.from({ length: 8 }, buildNoise)
    };

    detector = new FlashDetector(c.elt, { cols: COLS, rows: ROWS });
    naive = new NaiveLeakyIntegrator();
    heatCtx = document.getElementById('heat').getContext('2d');

    buildModeList();
    selectMode(0);

    window.flashPOC = {
      modes: MODES,
      select: selectMode,
      // Drives one frame at a simulated timestamp, so the detector can be
      // exercised without requestAnimationFrame.
      step(simMs, dtMs = 1000 / 60) {
        MODES[mode].draw(p, simMs / 1000, assets);
        const r = detector.update(simMs);
        naive.update(detector.luminance, dtMs);
        return r;
      },
      get mode() {
        return MODES[mode];
      },
      get detector() {
        return detector;
      },
      get report() {
        return detector.report;
      },
      get naive() {
        return { level: naive.level, fails: naive.fails };
      }
    };
  };

  p.draw = () => {
    const t = (p.millis() - start) / 1000;
    MODES[mode].draw(p, t, assets);

    const report = detector.update(p.millis());
    naive.update(detector.luminance, p.deltaTime);

    if (p.millis() - lastHud > 100) {
      lastHud = p.millis();
      updateHud(report);
      drawHeat();
    }
  };

  p.keyPressed = e => {
    const k = (e && e.key) || p.key;
    const n = parseInt(k, 10);
    if (n >= 1 && n <= MODES.length) selectMode(n - 1);
    if (k === 'r' || k === 'R') selectMode(mode);
  };

  function selectMode(i) {
    mode = i;
    start = p.millis();
    detector.reset();
    naive.reset();
    document.querySelectorAll('#modes li').forEach((el, k) => {
      el.classList.toggle('on', k === i);
    });
  }

  function buildModeList() {
    const ul = document.getElementById('modes');
    ul.innerHTML = MODES.map(
      (m, i) =>
        `<li><b>${i + 1}</b> ${m.name}
         <span class="tag ${m.expect === 'pass' ? 'ok' : 'bad'}">${m.expect}</span>
         <em>${m.why}</em></li>`
    ).join('');
    ul.addEventListener('click', e => {
      const li = e.target.closest('li');
      if (li) selectMode([...ul.children].indexOf(li));
    });
  }

  function verdict(fail) {
    return fail
      ? '<span class="bad">FAIL</span>'
      : '<span class="ok">pass</span>';
  }

  function updateHud(r) {
    const m = MODES[mode];
    const correct =
      (r.fails || r.failsRed) === (m.expect === 'FAIL') ? 'ok' : 'bad';

    document.getElementById('hud').innerHTML = `
      <h2>${m.name}</h2>
      <table>
        <tr><td>general flashes / sec (peak cell)</td><td>${r.flashesPerSecond}</td></tr>
        <tr><td>red flashes / sec (peak cell)</td><td>${r.redFlashesPerSecond}</td></tr>
        <tr><td>cells over 3 flashes/sec</td><td>${r.hotCells} / ${COLS * ROWS}</td></tr>
        <tr class="rule"><td>area of worst 10 degree field</td><td>${r.fieldPercent.toFixed(1)}% <small>(limit 25%)</small></td></tr>
        <tr><td>same area as % of whole canvas</td><td>${r.canvasPercent.toFixed(1)}% <small>(what a global sum would report)</small></td></tr>
        <tr class="rule"><td><b>this detector</b></td><td>${verdict(r.fails)} general, ${verdict(r.failsRed)} red</td></tr>
        <tr><td>naive leaky integrator</td><td>${verdict(naive.fails)} <small>level ${naive.level.toFixed(2)}</small></td></tr>
        <tr><td>expected</td><td class="${correct}">${m.expect}</td></tr>
      </table>`;
  }

  function drawHeat() {
    const s = 6;
    heatCtx.fillStyle = '#111';
    heatCtx.fillRect(0, 0, COLS * s, ROWS * s);
    for (let i = 0; i < COLS * ROWS; i++) {
      if (!detector.hot[i] && !detector.hotRed[i]) continue;
      heatCtx.fillStyle = detector.hotRed[i] ? '#f04' : '#fc0';
      heatCtx.fillRect((i % COLS) * s, Math.floor(i / COLS) * s, s - 1, s - 1);
    }
  }
});
