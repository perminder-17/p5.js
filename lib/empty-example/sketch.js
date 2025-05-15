let s = '>';

function setup() {
  createCanvas(600, 300);
  textSize(16);
}

function keyTyped(){
  s = s + ' ' + key;
}

function draw() {
  background(240); noStroke();  fill(0, 0, 160);
  text(s, 10, 10, width - 20, height - 20);
}