// Canvas navigation - manual test sketch
//
// Everything a screen reader can reach here comes from the drawing calls
// themselves. The only accessibility code in this file is the one call to
// canvasNavigation(), plus a handful of labels where the automatic
// description would have been worse than a written one.
//
// Tab once to reach the canvas. Arrow keys walk the contents, right arrow
// opens an item for more detail, Escape goes back to the summary.

let t = 0;
let crowd = false;
let refreshed = 0;
let lastRefresh = -999;

function setup() {
  createCanvas(720, 420);

  // This is the whole feature.
  canvasNavigation();

  textFont('system-ui, sans-serif');
}

function draw() {
  t += 0.02;
  background('#eae4f5');

  // ---------------------------------------------------------------- hidden
  // Two hundred dots of texture. They carry no meaning, so they stay out of
  // the description entirely. Without this, they would be the description.
  beginAccessibleHidden();
  randomSeed(7);
  noStroke();
  fill(255, 55);
  for (let i = 0; i < 200; i++) {
    circle(random(width), random(height), random(2, 7));
  }
  endAccessibleHidden();

  // ----------------------------------------------------------------- group
  // Nine drawing calls, one thing. A person hears "the afternoon sun", and
  // can open it with the right arrow key if they want the parts.
  beginAccessibleGroup('the afternoon sun');
  noStroke();
  fill('#e8a90c');
  circle(590, 105, 112);
  stroke('#e8a90c');
  strokeWeight(5);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TWO_PI + t * 0.3;
    line(
      590 + cos(a) * 74,
      105 + sin(a) * 74,
      590 + cos(a) * 96,
      105 + sin(a) * 96
    );
  }
  noStroke();
  endAccessibleGroup();

  // ------------------------------------------------------------ plain text
  // No label written by hand. The string is the description.
  fill('#241c33');
  textSize(58);
  textStyle(BOLD);
  text('Delhi', 48, 108);
  textStyle(NORMAL);

  // -------------------------------------------------- text that keeps moving
  // The automatic label would be "31.4°C", which a screen reader reads as
  // "31.4 degree sign C". A written label fixes the pronunciation, and the
  // key pins this item's identity so that rewriting its text every frame
  // does not throw the reader out of it.
  const temp = 31 + sin(t) * 0.7;
  accessibleLabel(`${temp.toFixed(1)} degrees Celsius, feels like 36`, {
    key: 'temperature',
    detail: 'a live reading, updated every frame, spoken only when you ask'
  });
  fill('#584a6e');
  textSize(26);
  text(`${temp.toFixed(1)}°C`, 48, 152);

  // --------------------------------------------------------- shape + label
  // "purple rectangle, at mid left" is true but useless. This says what the
  // rectangle is for.
  const pm = map(sin(t * 0.7), -1, 1, 0.35, 0.85);
  accessibleLabel('air quality, poor, 168 on the index', {
    key: 'aqi',
    detail: 'the bar is about three quarters full'
  });
  fill('#7b5ea7');
  rect(48, 196, 340 * pm, 26, 13);

  fill('#241c33');
  textSize(20);
  text('Air quality', 48, 186);

  // ------------------------------------------------------------ rotated text
  // The focus ring follows the transform rather than drawing an upright box
  // around a tilted thing.
  push();
  translate(600, 330);
  rotate(-0.32);
  fill('#3f2d6b');
  textSize(24);
  textAlign(CENTER, CENTER);
  text('monsoon watch', 0, 0);
  textAlign(LEFT, BASELINE);
  pop();

  // ---------------------------------------------------- an operable control
  // A button drawn on a canvas is invisible to the keyboard unless somebody
  // says it is a button. Enter runs the same code a click would.
  const hot = millis() - lastRefresh < 600;
  accessibleLabel(refreshed ? `Refresh forecast, refreshed ${refreshed} times` : 'Refresh forecast', {
    key: 'refresh',
    role: 'button',
    detail: 'press Enter to refresh',
    activate: () => {
      refreshed++;
      lastRefresh = millis();
    }
  });
  fill(hot ? '#4b2a6d' : '#241c33');
  rect(48, 264, 252, 54, 27);

  // The button already announced itself. Announcing its face a second time
  // would just make a reader hear everything twice.
  beginAccessibleHidden();
  fill(255);
  textSize(21);
  text('Refresh forecast', 76, 297);
  endAccessibleHidden();

  // ------------------------------------------------------- the node budget
  // Four hundred points. Listed one by one they would be four hundred stops
  // to arrow through. The tree lists up to maxNodes and then summarises.
  if (crowd) {
    randomSeed(11);
    stroke('#2f2350');
    strokeWeight(4);
    for (let i = 0; i < 400; i++) {
      point(random(360, 700), random(360, 410));
    }
    noStroke();
  }
}

// ---------------------------------------------------------------------------
// page controls
// ---------------------------------------------------------------------------

window.demo = {
  setOrder(order) {
    canvasNavigation({ order });
  },
  setBudget(maxNodes) {
    canvasNavigation({ maxNodes });
  },
  setRing(ring) {
    canvasNavigation({ ring });
  },
  toggleCrowd(on) {
    crowd = on;
  },
  toggleLoop(on) {
    if (on) loop();
    else noLoop();
  }
};
