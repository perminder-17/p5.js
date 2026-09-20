// Diagnostic version: every stage of the pipeline is checked separately so a
// zero shows WHERE the chain breaks, not just that it broke.

let prev, next, diffFbo;
let avgChain = [];
let sumChain = [];
let diffShader, averageShader, sumShader;
let out;
let flashing = true;
let tick = 0;

const PIXEL_SIZE = 1;

function setup() {
  createCanvas(400, 400, WEBGL);
  pixelDensity(1);

  out = createElement('pre', 'measuring...');
  out.style('font', '13px/1.5 monospace');

  prev = createFramebuffer();
  next = createFramebuffer();
  diffFbo = createFramebuffer({ width: width, height: height });

  let w = width;
  let h = height;
  do {
    w = max(1, floor(w / 2));
    h = max(1, floor(h / 2));
    avgChain.push(createFramebuffer({ width: w, height: h }));
    sumChain.push(createFramebuffer({ width: w, height: h }));
  } while (w > 1 || h > 1);

  diffShader = buildFilterShader(() => {
    let prevTex = uniformTexture(() => prev);
    let nextTex = uniformTexture(() => next);
    const lum = (c) => dot([0.2126, 0.7152, 0.0722], c.rgb);
    filterColor.begin();
    let a = getTexture(prevTex, filterColor.texCoord);
    let b = getTexture(nextTex, filterColor.texCoord);
    filterColor.set([abs(lum(a) - lum(b)), 0, 0, 1]);
    filterColor.end();
  });

  averageShader = buildFilterShader(() => {
    let source = uniformTexture();
    filterColor.begin();
    let v = 0;
    for (let xo = -0.5; xo <= 0.5; xo++) {
      for (let yo = -0.5; yo <= 0.5; yo++) {
        v += getTexture(source, filterColor.texCoord + [xo, yo] * filterColor.texelSize).r;
      }
    }
    v /= 4;
    filterColor.set([v, 0, 0, 1]);
    filterColor.end();
  });

  sumShader = buildFilterShader(() => {
    let source = uniformTexture();
    filterColor.begin();
    let v = 0;
    for (let xo = -0.5; xo <= 0.5; xo++) {
      for (let yo = -0.5; yo <= 0.5; yo++) {
        v += getTexture(source, filterColor.texCoord + [xo, yo] * filterColor.texelSize).r;
      }
    }
    filterColor.set([v, 0, 0, 1]);
    filterColor.end();
  });

  window.dbg = { get prev() { return prev; }, get next() { return next; },
    diffFbo, avgChain, sumChain,
    get diffShader() { return diffShader; },
    get averageShader() { return averageShader; },
    get sumShader() { return sumShader; },
    scene(v) {
      let tmp = next; next = prev; prev = tmp;
      next.begin(); background(128); noStroke(); fill(v); rect(0, 0, 1, 1); next.end();
    },
    runDiff() {
      diffFbo.begin(); clear(); filter(diffShader); diffFbo.end();
    },
    runChains() {
      for (let i = 0; i < avgChain.length; i++) {
        avgChain[i].begin();
        averageShader.setUniform('source', i === 0 ? diffFbo : avgChain[i - 1]);
        filter(averageShader);
        avgChain[i].end();
        sumChain[i].begin();
        sumShader.setUniform('source', i === 0 ? diffFbo : sumChain[i - 1]);
        filter(sumShader);
        sumChain[i].end();
      }
    },
    display() {
      clear(); imageMode(CENTER); image(next, 0, 0, width, height);
      noFill(); stroke(255, 0, 0); circle(0, 0, 24);
    },
    probe(fbo, x, y) {
      fbo.loadPixels();
      const i = 4 * (y * fbo.width + x);
      return [fbo.pixels[i], fbo.pixels[i + 1], fbo.pixels[i + 2], fbo.pixels[i + 3]];
    }
  };
}

function maxPixel(fbo) {
  fbo.loadPixels();
  let m = 0;
  for (let i = 0; i < fbo.pixels.length; i += 4) {
    if (fbo.pixels[i] > m) m = fbo.pixels[i];
  }
  return m;
}

function draw() {
  let tmp = next;
  next = prev;
  prev = tmp;

  tick++;

  next.begin();
  background(128);
  noStroke();
  if (flashing) {
    fill(tick % 2 ? 255 : 0);
    rect(0, 0, PIXEL_SIZE, PIXEL_SIZE);
  }
  next.end();

  diffFbo.begin();
  clear();
  filter(diffShader);
  diffFbo.end();

  for (let i = 0; i < avgChain.length; i++) {
    avgChain[i].begin();
    averageShader.setUniform('source', i === 0 ? diffFbo : avgChain[i - 1]);
    filter(averageShader);
    avgChain[i].end();

    sumChain[i].begin();
    sumShader.setUniform('source', i === 0 ? diffFbo : sumChain[i - 1]);
    filter(sumShader);
    sumChain[i].end();
  }

  clear();
  imageMode(CENTER);
  image(next, 0, 0, width, height);
  // p5 2.3.1: filter() draws its quad with the current fill, so a sticky
  // noFill() zeroes every later filter pass. push/pop keeps it contained.
  push();
  noFill();
  stroke(255, 0, 0);
  circle(0, 0, 24);
  pop();

  if (tick % 15 === 0) {
    // stage checks
    next.loadPixels();
    const n = next.pixels.length;
    const cx = 4 * (200 * next.width + 200);   // centre pixel of the scene
    const centre = next.pixels[cx];

    let rows = '';
    rows += 'DIAGNOSTICS\n';
    rows += '  frame               ' + tick + '  (badhna chahiye)\n';
    rows += '  scene pixels loaded ' + n + '  (640000 hona chahiye)\n';
    rows += '  centre pixel value  ' + centre + '  (0/255 alternate hona chahiye)\n';
    rows += '\n';
    rows += 'PYRAMID          average    sum\n';
    rows += '400x400 (diff)  ' + String(maxPixel(diffFbo)).padStart(5) +
            String(maxPixel(diffFbo)).padStart(9) + '\n';
    for (let i = 0; i < avgChain.length; i++) {
      rows += (avgChain[i].width + 'x' + avgChain[i].height).padEnd(16) +
        String(maxPixel(avgChain[i])).padStart(5) +
        String(maxPixel(sumChain[i])).padStart(9) + '\n';
    }
    const a = maxPixel(avgChain[avgChain.length - 1]);
    const s = maxPixel(sumChain[sumChain.length - 1]);
    rows += '\n1x1 verdict: average=' + a + (a === 0 ? ' (flash GAYAB)' : '') +
      '  sum=' + s + (s > 0 ? ' (flash DETECTED)' : '') + '\n';
    rows += '\n[SPACE] flashing: ' + (flashing ? 'ON' : 'OFF') +
      '   pixel: ' + PIXEL_SIZE + 'px   p5 v' + (window.p5 ? p5.VERSION : '?');
    out.html(rows);
    window.selftestRows = rows;
  }
}

function keyPressed() {
  if (key === ' ') flashing = !flashing;
}
