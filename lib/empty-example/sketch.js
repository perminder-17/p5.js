let fb;

function setup() {
  createCanvas(400, 400, WEBGL);
  
  fb = createFramebuffer({w:width, h:height});
}
function draw(){

  fb.begin();
  orbitControl();
  background(0);
  lights();
  fill(255,0,0);
  specularMaterial(128);
  noStroke();
  filter(INVERT);
  torus(80, 20, 48);
  fb.end();

  clear();
  image(fb.color, -350, -350);
  // filter(INVERT);
}
