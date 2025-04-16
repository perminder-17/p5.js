// Click and drag the mouse to view the scene from different angles.

let myGeometry;

function setup() {
  createCanvas(100, 100, WEBGL);

  // Create a p5.Geometry object.
  myGeometry = buildGeometry( function() {
   v0 = createVector(-40, 0, 0);
   v1 = createVector(0, -40, 0);
   v2 = createVector(40, 0, 0);
  });

  // Create p5.Vector objects to position the vertices.

  // Add the vertices to the p5.Geometry object's vertices array.
  myGeometry.vertices.push(v0, v1, v2);

  describe('A white triangle drawn on a gray background.');
}

function draw() {
  background(200);

  // Enable orbiting with the mouse.
  orbitControl();

  // Draw the p5.Geometry object.
  model(myGeometry);
}