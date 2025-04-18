let mountains;
let bricks;

async function setup() {
  // Load the images.
  mountains = await loadImage('flower-1.png');
  bricks = await loadImage('flower-1.png');
  createCanvas(100, 100);

  // Blend the bricks image into the mountains.
  mountains.blend(bricks, 0, 0, 33, 100, 67, 0, 33, 100, ADD);

  // Display the mountains image.
  image(mountains, 0, 0);

  // Display the bricks image.
  image(bricks, 0, 0);

  describe('A wall of bricks in front of a mountain landscape. The same wall of bricks appears faded on the right of the image.');
}