const VERT_SRC = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  vec4 positionVec4 = vec4(aPosition, 1.0);
  gl_Position = uProjectionMatrix * uModelViewMatrix * positionVec4;
}
`;

// Pass 1: box-downsample source texture into small (color, luminance) texels
const DOWNSAMPLE_FRAG_SRC = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D tex0;
uniform vec2 uSrcTexel;   // 1 / sourceWidth, 1 / sourceHeight
uniform vec2 uDstSize;    // destination (grid) width, height in texels
uniform int  uClusterPx;  // samples per axis for this cluster

void main() {
  vec2 dstPixel = floor(vTexCoord * uDstSize);      // which cluster
  vec2 blockOriginPx = dstPixel * float(uClusterPx); // top-left, source px

  vec3 sumColor = vec3(0.0);
  float count = 0.0;

  for (int j = 0; j < 16; j++) {
    if (j >= uClusterPx) break;
    for (int i = 0; i < 16; i++) {
      if (i >= uClusterPx) break;
      vec2 srcPx = blockOriginPx + vec2(float(i), float(j)) + 0.5;
      vec2 uv = srcPx * uSrcTexel;
      sumColor += texture2D(tex0, uv).rgb;
      count += 1.0;
    }
  }

  vec3 avgColor = sumColor / max(count, 1.0);
  float luminance = 0.2126 * avgColor.r + 0.7152 * avgColor.g + 0.0722 * avgColor.b;
  gl_FragColor = vec4(avgColor, luminance);
}
`;

// Pass 2: temporal accumulator (leaky integrator) with red-flash channel
const ACCUM_FRAG_SRC = `
precision highp float;
varying vec2 vTexCoord;
uniform sampler2D uCurrTex;      // this frame's Pass-1 output
uniform sampler2D uPrevTex;      // previous frame's Pass-1 output
uniform sampler2D uPrevAccumTex; // previous frame's accumulator output
uniform float uLumThreshold;
uniform float uIncrement;
uniform float uRedIncrement;
uniform float uGeneralTrigger;
uniform float uRedTrigger;
uniform float uDecay; // already scaled by deltaTime on CPU side

void main() {
  vec4 curr = texture2D(uCurrTex, vTexCoord);       // rgb=avgColor, a=lum
  vec4 prev = texture2D(uPrevTex, vTexCoord);
  vec4 prevAccum = texture2D(uPrevAccumTex, vTexCoord); // r,g used

  float lumDelta = abs(curr.a - prev.a);
  float flashIntensity = prevAccum.r;
  float redIntensity = prevAccum.g;

  if (lumDelta > uLumThreshold) {
    flashIntensity += uIncrement;
  } else {
    flashIntensity -= uDecay;
  }
  flashIntensity = clamp(flashIntensity, 0.0, 1.5);

  // Heuristic saturated-red test (documented limitation: not the formal
  // WCAG color-difference test, just a fast proxy for "looks red-flashy")
  float rednessCurr = curr.r - max(curr.g, curr.b);
  float rednessPrev = prev.r - max(prev.g, prev.b);
  bool isRedSaturated = (rednessCurr > 0.15 && curr.r > 0.35) ||
                         (rednessPrev > 0.15 && prev.r > 0.35);
  float colorDelta = length(curr.rgb - prev.rgb);
  bool isRedTransition = isRedSaturated && colorDelta > 0.15;

  if (isRedTransition) {
    redIntensity += uRedIncrement;
  } else {
    redIntensity -= uDecay;
  }
  redIntensity = clamp(redIntensity, 0.0, 1.5);

  float violation = 0.0;
  if (redIntensity >= uRedTrigger) {
    violation = 1.0;       // red flash - highest severity
  } else if (flashIntensity >= uGeneralTrigger) {
    violation = 0.5;       // general flash
  }

  gl_FragColor = vec4(flashIntensity, redIntensity, violation, 1.0);
}
`;
