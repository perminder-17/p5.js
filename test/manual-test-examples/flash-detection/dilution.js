// The sketch from the thread, instrumented: one flashing pixel at the centre,
// and every pyramid level read back so the value can be watched decaying.
// Two reduction chains run from the same diff so average and sum can be
// compared level by level.

let prev, next;
let diffFbo;
let avgChain = [];
let sumChain = [];
let diffShader;
let averageShader;
let sumShader;

function setup() {
  window.__stage = 'setup start';
  createCanvas(400, 400, WEBGL);
  pixelDensity(1);
  window.__stage = 'canvas done';

  prev = createFramebuffer();
  next = createFramebuffer();
  diffFbo = createFramebuffer({ width: width, height: height });
  window.__stage = 'fbos done';

  let w = width;
  let h = height;
  do {
    w = max(1, floor(w / 2));
    h = max(1, floor(h / 2));
    avgChain.push(createFramebuffer({ width: w, height: h }));
    sumChain.push(createFramebuffer({ width: w, height: h }));
  } while (w > 1 || h > 1);
  window.__stage = 'chains done';

  diffShader = buildFilterShader(() => {
    let prevTex = uniformTexture(() => prev);
    let nextTex = uniformTexture(() => next);
    const lum = (c) => dot([0.2126, 0.7152, 0.0722], c.rgb);
    filterColor.begin();
    let prevColor = getTexture(prevTex, filterColor.texCoord);
    let nextColor = getTexture(nextTex, filterColor.texCoord);
    let diff = abs(lum(prevColor) - lum(nextColor));
    filterColor.set([diff, 0, 0, 1]);
    filterColor.end();
  });
  window.__stage = 'diffShader done';

  averageShader = buildFilterShader(() => {
    let source = uniformTexture();
    filterColor.begin();
    let avg = 0;
    for (let xOff = -0.5; xOff <= 0.5; xOff++) {
      for (let yOff = -0.5; yOff <= 0.5; yOff++) {
        let coord = filterColor.texCoord + [xOff, yOff] * filterColor.texelSize;
        avg += getTexture(source, coord).r;
      }
    }
    avg /= 4;
    filterColor.set([avg, 0, 0, 1]);
    filterColor.end();
  });
  window.__stage = 'averageShader done';

  sumShader = buildFilterShader(() => {
    let source = uniformTexture();
    filterColor.begin();
    let total = 0;
    for (let xOff = -0.5; xOff <= 0.5; xOff++) {
      for (let yOff = -0.5; yOff <= 0.5; yOff++) {
        let coord = filterColor.texCoord + [xOff, yOff] * filterColor.texelSize;
        total += getTexture(source, coord).r;
      }
    }
    filterColor.set([total, 0, 0, 1]);
    filterColor.end();
  });
  window.__stage = 'setup complete';
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
  try {
    drawImpl();
  } catch (e) {
    window.__drawErr = e.message + '\n' + (e.stack || '').slice(0, 600);
    noLoop();
  }
}

function drawImpl() {
  let tmp = next;
  next = prev;
  prev = tmp;

  next.begin();
  background(128);
  noStroke();
  window.__tick = (window.__tick || 0) + 1;
  fill(window.__tick % 2 ? 255 : 0);
  rect(0, 0, 1, 1);
  next.end();

  diffFbo.begin();
  clear();
  filter(diffShader);
  diffFbo.end();

  for (let i = 0; i < avgChain.length; i++) {
    const src = i === 0 ? diffFbo : avgChain[i - 1];
    avgChain[i].begin();
    averageShader.setUniform('source', src);
    filter(averageShader);
    avgChain[i].end();
  }

  for (let i = 0; i < sumChain.length; i++) {
    const src = i === 0 ? diffFbo : sumChain[i - 1];
    sumChain[i].begin();
    sumShader.setUniform('source', src);
    filter(sumShader);
    sumChain[i].end();
  }

  clear();
  imageMode(CENTER);
  image(next, 0, 0, width, height);

  if (window.__logNow) {
    window.__logNow = false;
    const rows = [
      { size: '400x400 (diff)', average: maxPixel(diffFbo), sum: maxPixel(diffFbo) }
    ];
    for (let i = 0; i < avgChain.length; i++) {
      rows.push({
        size: avgChain[i].width + 'x' + avgChain[i].height,
        average: maxPixel(avgChain[i]),
        sum: maxPixel(sumChain[i])
      });
    }
    window.dilutionLog = rows;
    console.table(rows);
  }
}
