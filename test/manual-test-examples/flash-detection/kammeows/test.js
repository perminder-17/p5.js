// ---------------------------------------------------------------------
// STUDENT SKETCH
// Draw into `pg` (a standard 2D p5.Graphics) using normal 2D p5 calls.
// `t` is frameCount, passed in for convenience.
// ---------------------------------------------------------------------
function drawStudentSketch(pg, t) {
  pg.push();
  pg.background(30);
 
  switch (testMode) {
 
    case 'moving_safe': {
      // A box sliding across the screen. Each cluster it crosses is hit
      // once, not repeatedly -> should NOT trigger any violation.
      const x = (t * 2) % (CANVAS_SIZE + 80) - 40;
      pg.noStroke();
      pg.fill(240, 240, 240);
      pg.rect(x, CANVAS_SIZE / 2 - 30, 60, 60);
      break;
    }
 
    case 'pulse_safe': {
      // Slow smooth brightness pulse, well under 3Hz and gradual (not a
      // hard on/off), and under the 10% per-frame delta most frames.
      const b = 128 + 60 * Math.sin(t * 0.03);
      pg.background(b);
      break;
    }
 
    case 'strobe_full': {
      // Full-canvas white/black strobe at ~10Hz (well within 3-50Hz band)
      // -> should trigger BOTH AAA and AA.
      const on = Math.floor(t / 3) % 2 === 0;
      pg.background(on ? 255 : 0);
      break;
    }
 
    case 'strobe_point': {
      // A single small (12x12) region strobing -> big enough to survive
      // the fine AAA (4px) grid, but its area (144px) is far below the
      // 21,824px AA threshold, so it should trip AAA but NOT AA.
      const on = Math.floor(t / 3) % 2 === 0;
      pg.noStroke();
      pg.fill(on ? 255 : 0);
      pg.rect(CANVAS_SIZE / 2 - 6, CANVAS_SIZE / 2 - 6, 12, 12);
      break;
    }
 
    case 'strobe_1px': {
      // A single 1x1 pixel strobing -> tests whether averaging-before-
      // detection dilutes it below the 0.10 threshold (1/16 in a 4px cluster).
      const on = Math.floor(t / 3) % 2 === 0;
      pg.noStroke();
      pg.fill(on ? 255 : 0);
      pg.rect(CANVAS_SIZE / 2, CANVAS_SIZE / 2, 1, 1);
      break;
    }

    case 'strobe_red': {
      // Small saturated-red strobe -> demonstrates the red-flash channel
      // triggering faster/more sensitively than the general channel.
      const on = Math.floor(t / 4) % 2 === 0;
      pg.noStroke();
      pg.fill(on ? color(255, 0, 0) : color(30, 30, 30));
      pg.rect(CANVAS_SIZE / 2 - 20, CANVAS_SIZE / 2 - 20, 40, 40);
      break;
    }
 
    case 'static':
    default: {
      pg.noStroke();
      pg.fill(80, 120, 200);
      pg.ellipse(CANVAS_SIZE / 2, CANVAS_SIZE / 2, 100, 100);
      break;
    }
  }
 
  pg.pop();
}