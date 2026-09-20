// Dave's sketch, minimally modified:
//   1. pulsing circle -> one flashing pixel
//   2. every 30 frames, log each pyramid level's max value

let prev, next;
let pyramid = [];
let diffShader;
let average;

function setup() {
  createCanvas(400, 400, WEBGL);
  pixelDensity(1);

  prev = createFramebuffer();
  next = createFramebuffer();

  let w = width;
  let h = height;
  do {
    pyramid.push(createFramebuffer({ width: w, height: h }));
    w = max(1, floor(w / 2));
    h = max(1, floor(h / 2));
  } while (w > 1 || h > 1);
  pyramid.push(createFramebuffer({ width: 1, height: 1 }));

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

  average = buildFilterShader(() => {
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

  next.begin();
  background(128);
  noStroke();
  // CHANGE 1: circle ki jagah ek flashing pixel
  fill(frameCount % 2 ? 255 : 0);
  rect(0, 0, 1, 1);
  next.end();

  pyramid[0].begin();
  clear();
  filter(diffShader);
  pyramid[0].end();

  for (let i = 1; i < pyramid.length; i++) {
    pyramid[i].begin();
    average.setUniform('source', pyramid[i - 1]);
    filter(average);
    pyramid[i].end();
  }

  clear();
  imageMode(CENTER);
  image(next, 0, 0, width, height);

  // CHANGE 2: har 30 frames pe poori pyramid ke values
  if (frameCount % 30 === 0) {
    const line = pyramid
      .map(f => f.width + 'x' + f.height + ': ' + maxPixel(f))
      .join('  |  ');
    console.log(line);
    window.__lastLine = line;
  }
}
