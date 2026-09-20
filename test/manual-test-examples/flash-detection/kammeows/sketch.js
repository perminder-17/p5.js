// noprotect
const CANVAS_SIZE = 400;

const AA_CLUSTER_PX  = 8;
const AAA_CLUSTER_PX = 4;

const AA_GRID_W  = CANVAS_SIZE / AA_CLUSTER_PX;  // 50
const AA_GRID_H  = CANVAS_SIZE / AA_CLUSTER_PX;  // 50
const AAA_GRID_W = CANVAS_SIZE / AAA_CLUSTER_PX; // 100
const AAA_GRID_H = CANVAS_SIZE / AAA_CLUSTER_PX; // 100

const AA_CLUSTER_AREA_PX = AA_CLUSTER_PX * AA_CLUSTER_PX; // 64
const AA_FIELD_AREA_PX   = 341 * 256;                     // 87,296
const AA_VIOLATION_AREA_PX = AA_FIELD_AREA_PX * 0.25;     // 21,824

const FLASH_LUM_DELTA_THRESHOLD = 0.10;   // 10% relative luminance
const FLASH_INCREMENT           = 0.34;   // ~3 hits to cross 1.0
const RED_INCREMENT             = 0.34;
const GENERAL_TRIGGER           = 1.00;
const RED_TRIGGER               = 0.60;   // more sensitive, per spec
const BASE_DECAY_PER_FRAME_60FPS = 0.02;  // tuned for ~3-50Hz flash band

let pg;
let hud;

let aaPipeline, aaaPipeline;

let everFlaggedAA = false, everFlaggedAAA = false, everFlaggedRed = false;
let testModeSelect;
let testMode = 'static';

let downsampleShader, accumShader;

let aaaAlertTime = 0;
let aaAlertTime = 0;
let redAlertTime = 0;
const ALERT_COOLDOWN_MS = 1500; // Locks the warning for 1.5 seconds

// pipeline helper
function makePipeline(gridW, gridH, clusterPx) {
  const fbOpts = { width: gridW, height: gridH, density: 1, textureFiltering: NEAREST };
  return {
    gridW, gridH, clusterPx,
    clusterAreaPx: clusterPx * clusterPx,
    lum: [createFramebuffer(fbOpts), createFramebuffer(fbOpts)], // ping-pong
    accum: [createFramebuffer(fbOpts), createFramebuffer(fbOpts)], // ping-pong
    idx: 0, // which of [0,1] is "current" going into this frame
    flaggedClusters: new Set(),       // this-frame flagged (either type)
    flaggedClustersRed: new Set(),
  };
}

function runDownsamplePass(pipeline) {
  const dstFbo = pipeline.lum[pipeline.idx];
  dstFbo.begin();
  clear();
  shader(downsampleShader);
  downsampleShader.setUniform('tex0', pg);
  downsampleShader.setUniform('uSrcTexel', [1.0 / CANVAS_SIZE, 1.0 / CANVAS_SIZE]);
  downsampleShader.setUniform('uDstSize', [pipeline.gridW, pipeline.gridH]);
  downsampleShader.setUniform('uClusterPx', pipeline.clusterPx);
  noStroke();
  rectMode(CENTER);
  plane(dstFbo.width, dstFbo.height);
  dstFbo.end();
}

function runAccumPass(pipeline, decay) {
  const prevIdx = 1 - pipeline.idx;
  const currLum = pipeline.lum[pipeline.idx];
  const prevLum = pipeline.lum[prevIdx];
  const prevAccum = pipeline.accum[prevIdx];
  const dstAccum = pipeline.accum[pipeline.idx];

  dstAccum.begin();
  clear();
  shader(accumShader);
  accumShader.setUniform('uCurrTex', currLum);
  accumShader.setUniform('uPrevTex', prevLum);
  accumShader.setUniform('uPrevAccumTex', prevAccum);
  accumShader.setUniform('uLumThreshold', FLASH_LUM_DELTA_THRESHOLD);
  accumShader.setUniform('uIncrement', FLASH_INCREMENT);
  accumShader.setUniform('uRedIncrement', RED_INCREMENT);
  accumShader.setUniform('uGeneralTrigger', GENERAL_TRIGGER);
  accumShader.setUniform('uRedTrigger', RED_TRIGGER);
  accumShader.setUniform('uDecay', decay);
  noStroke();
  rectMode(CENTER);
  plane(dstAccum.width, dstAccum.height);
  dstAccum.end();
}

function readPipeline(pipeline) {
  const fbo = pipeline.accum[pipeline.idx];
  fbo.loadPixels();
  const px = fbo.pixels;
  pipeline.flaggedClusters.clear();
  pipeline.flaggedClustersRed.clear();

  const w = pipeline.gridW, h = pipeline.gridH;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const bVal = px[i + 2]; // violation channel, 0 / ~127 / ~255
      if (bVal > 200) {
        pipeline.flaggedClusters.add(y * w + x);
        pipeline.flaggedClustersRed.add(y * w + x);
      } else if (bVal > 60) {
        pipeline.flaggedClusters.add(y * w + x);
      }
    }
  }
}

function setup() {
  pixelDensity(1);
  createCanvas(CANVAS_SIZE, CANVAS_SIZE, WEBGL);

  pg = createGraphics(CANVAS_SIZE, CANVAS_SIZE);   // 2D student sketch surface
  hud = createGraphics(CANVAS_SIZE, 130);          // 2D HUD overlay

  downsampleShader = createShader(VERT_SRC, DOWNSAMPLE_FRAG_SRC);
  accumShader = createShader(VERT_SRC, ACCUM_FRAG_SRC);

  aaPipeline  = makePipeline(AA_GRID_W, AA_GRID_H, AA_CLUSTER_PX);
  aaaPipeline = makePipeline(AAA_GRID_W, AAA_GRID_H, AAA_CLUSTER_PX);

  // Prime both ping-pong slots with identical content so frame 1 has
  // zero delta (avoids a false-positive "flash" on the very first frame).
  drawStudentSketch(pg, 0);
  for (const p of [aaPipeline, aaaPipeline]) {
    p.idx = 0; runDownsamplePass(p);
    p.idx = 1; runDownsamplePass(p);
    p.accum[0].begin(); clear(); p.accum[0].end();
    p.accum[1].begin(); clear(); p.accum[1].end();
    p.idx = 0;
  }

  // Test-scenario picker
  testModeSelect = createSelect();
  testModeSelect.position(10, CANVAS_SIZE + 145);
  testModeSelect.option('Moving box (should NOT flag)', 'moving_safe');
  testModeSelect.option('Slow color pulse (should NOT flag)', 'pulse_safe');
  testModeSelect.option('White/black strobe, full screen (AAA+AA fail)', 'strobe_full');
  testModeSelect.option('White/black strobe, small point (AAA fail only)', 'strobe_point');
  testModeSelect.option('White/black strobe, 1px (dilution test)', 'strobe_1px');
  testModeSelect.option('Red strobe, small area (RED flag, fast)', 'strobe_red');
  testModeSelect.option('Static (no violation)', 'static');
  testModeSelect.changed(() => {
    testMode = testModeSelect.value();
    resetDetectorState();
  });

  const resetBtn = createButton('Reset detector state');
  resetBtn.position(10, CANVAS_SIZE + 175);
  resetBtn.mousePressed(resetDetectorState);
}

function resetDetectorState() {
  everFlaggedAA = false; everFlaggedAAA = false; everFlaggedRed = false;
  for (const p of [aaPipeline, aaaPipeline]) {
    p.accum[0].begin(); clear(); p.accum[0].end();
    p.accum[1].begin(); clear(); p.accum[1].end();
  }
}

function draw() {
  // 1) Student sketch -> pg (2D)
  drawStudentSketch(pg, frameCount);

  // 2) Framerate-independent decay
  const decay = BASE_DECAY_PER_FRAME_60FPS * (deltaTime / (1000 / 60));

  // 3) Run both pipelines: write into the "other" slot, then it becomes current
  for (const p of [aaPipeline, aaaPipeline]) {
    p.idx = 1 - p.idx;          // this slot becomes "current" for this frame
    runDownsamplePass(p);       // pass 1: downsample+luminance
    runAccumPass(p, decay);     // pass 2: temporal accumulator
    readPipeline(p);            // CPU readback + classify
  }

  // 4) Compute verdicts
  const aaaViolationNow  = aaaPipeline.flaggedClusters.size > 0;
  const redViolationNow  = aaaPipeline.flaggedClustersRed.size > 0 ||
                            aaPipeline.flaggedClustersRed.size > 0;
  const aaFlashingArea =
    aaPipeline.flaggedClusters.size * aaPipeline.clusterAreaPx;
  const aaViolationNow = aaFlashingArea > AA_VIOLATION_AREA_PX;

  if (aaaViolationNow) everFlaggedAAA = true;
  if (aaViolationNow) everFlaggedAA = true;
  if (redViolationNow) everFlaggedRed = true;

  // 5) Render: student sketch texture on a full-canvas plane
  background(20);
  push();
  noStroke();
  texture(pg);
  plane(width, height); // default camera => exact 1:1, centered
  pop();

  drawViolationOverlay();
  drawHUD(aaaViolationNow, aaViolationNow, redViolationNow, aaFlashingArea);
}
