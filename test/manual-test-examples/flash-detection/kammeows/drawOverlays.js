
// Highlight currently-flagged AA clusters directly on the WEBGL canvas
function drawViolationOverlay() {
  push();
  translate(-width / 2, -height / 2, 1); // emulate 2D coord space in WEBGL
  noStroke();
  rectMode(CORNER);
  const cs = aaPipeline.clusterPx;
  for (const idx of aaPipeline.flaggedClusters) {
    const gx = idx % aaPipeline.gridW;
    const gy = Math.floor(idx / aaPipeline.gridW);
    const isRed = aaPipeline.flaggedClustersRed.has(idx);
    fill(isRed ? color(255, 0, 0, 140) : color(255, 200, 0, 110));
    rect(gx * cs, gy * cs, cs, cs);
  }
  pop();
}

function drawHUD(aaaNow, aaNow, redNow, aaArea) {
  const now = millis();

  // 1. Update Cooldown Timers
  // If a flash happens, push the expiration time 1.5 seconds into the future
  if (aaaNow) aaaAlertTime = now + ALERT_COOLDOWN_MS;
  if (aaNow) aaAlertTime = now + ALERT_COOLDOWN_MS;
  if (redNow) redAlertTime = now + ALERT_COOLDOWN_MS;

  // Evaluate if we are currently in an active alert state
  const showAAA = now < aaaAlertTime;
  const showAA = now < aaAlertTime;
  const showRed = now < redAlertTime;

  // 2. Draw the HUD Graphics
  hud.clear();
  hud.background(15, 15, 20, 235);
  hud.noStroke();
  hud.textFont('monospace');
  hud.textSize(12);

  const line = (y, msg, col) => { hud.fill(col); hud.text(msg, 8, y); };

  line(16, `Test scenario: ${testMode}`, [200, 200, 200]);

  line(34, `AAA (2.3.2, any size, strict) : ${showAAA ? 'FLASHING NOW' : 'ok'}`,
       showAAA ? [255, 80, 80] : [120, 220, 120]);
       
  line(50, `AA  (2.3.1, area-based)       : ${showAA ? 'FLASHING NOW' : 'ok'}  ` +
           `[${aaArea} / ${AA_VIOLATION_AREA_PX} px]`,
       showAA ? [255, 80, 80] : [120, 220, 120]);
       
  line(66, `RED FLASH (special case)      : ${showRed ? 'RED FLASH NOW' : 'ok'}`,
       showRed ? [255, 40, 40] : [120, 220, 120]);

  hud.stroke(60); 
  hud.line(8, 76, hud.width - 8, 76); 
  hud.noStroke();

  // 3. Position the HUD in the Bottom-Right Corner
  push();
  // WebGL center is (0,0). 
  // width/2 is the far right edge. height/2 is the absolute bottom edge.
  // We subtract half the HUD's size so its center pulls back fully onto the screen.
  let targetX = (width / 2) - (hud.width / 2);
  let targetY = (height / 2) - (hud.height / 2);
  
  translate(targetX, targetY, 1);
  texture(hud);
  noStroke();
  plane(hud.width, hud.height); 
  pop();
}