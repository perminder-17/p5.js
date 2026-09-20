/*
 * Dave's proposal from the thread, implemented for measurement:
 *   - do the per-pixel comparison in a shader
 *   - then reduce with a shader pyramid (sum 4 pixels into 1, repeatedly)
 *     until a single value is left
 *   - read back only that one value
 *
 * The comparison runs at full resolution and the pyramid sums an already
 * computed 0/1 flag, so a single flashing pixel survives all the way down.
 * That is the property an averaging pyramid does not have.
 *
 * Per-pixel flash state (last extreme, running extreme, direction) lives in a
 * ping-ponged RGBA8 texture. 8 bits gives 1/255 = 0.0039 precision, which is
 * comfortably finer than the 0.10 threshold.
 */

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const STATE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uState;
out vec4 outColor;

const float DEADBAND = 0.02;
const float LUM_DELTA = 0.10;
const float DARK_LIMIT = 0.80;

float toLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(uSrc, uv, 0).rgb;
  float L = 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);

  vec4 s = texelFetch(uState, uv, 0);
  float lastExt = s.r;
  float runExt  = s.g;
  float dir     = s.b;
  float transition = 0.0;

  if (dir < 0.25) {
    if (L > runExt + DEADBAND) { dir = 0.5; runExt = L; }
    else if (L < runExt - DEADBAND) { dir = 1.0; runExt = L; }
  } else if (dir < 0.75) {
    if (L >= runExt) {
      runExt = L;
    } else if (runExt - L > DEADBAND) {
      if (abs(runExt - lastExt) >= LUM_DELTA && min(runExt, lastExt) < DARK_LIMIT) {
        transition = 1.0;
      }
      lastExt = runExt; dir = 1.0; runExt = L;
    }
  } else {
    if (L <= runExt) {
      runExt = L;
    } else if (L - runExt > DEADBAND) {
      if (abs(runExt - lastExt) >= LUM_DELTA && min(runExt, lastExt) < DARK_LIMIT) {
        transition = 1.0;
      }
      lastExt = runExt; dir = 0.5; runExt = L;
    }
  }

  outColor = vec4(lastExt, runExt, dir, transition);
}`;

const REDUCE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform int uFromState;
out vec4 outColor;

void main() {
  ivec2 dst = ivec2(gl_FragCoord.xy);
  ivec2 src = dst * 2;
  ivec2 size = textureSize(uTex, 0);
  float sum = 0.0;
  for (int dy = 0; dy < 2; dy++) {
    for (int dx = 0; dx < 2; dx++) {
      ivec2 p = src + ivec2(dx, dy);
      if (p.x < size.x && p.y < size.y) {
        vec4 t = texelFetch(uTex, p, 0);
        sum += (uFromState == 1) ? t.a : t.r;
      }
    }
  }
  outColor = vec4(sum, 0.0, 0.0, 1.0);
}`;

function compile(gl, vertSrc, fragSrc) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

export class GpuFlashDetector {
  constructor(source, { asyncReadback = true } = {}) {
    this.source = source;
    this.asyncReadback = asyncReadback;
    this.width = source.width;
    this.height = source.height;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1;
    this.canvas.height = 1;
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false
    });
    if (!gl) throw new Error('WebGL2 not available');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('EXT_color_buffer_float not available');
    }
    this.gl = gl;

    this.stateProgram = compile(gl, VERT, STATE_FRAG);
    this.reduceProgram = compile(gl, VERT, REDUCE_FRAG);
    this.vao = gl.createVertexArray();

    this.srcTex = this._tex(gl.RGBA8, this.width, this.height);
    this.stateA = this._target(gl.RGBA8, this.width, this.height);
    this.stateB = this._target(gl.RGBA8, this.width, this.height);

    this.chain = [];
    let w = this.width;
    let h = this.height;
    while (w > 1 || h > 1) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      this.chain.push(this._target(gl.RGBA32F, w, h));
    }

    this.pbo = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.pending = null;
    this.result = 0;
    this.readback = new Float32Array(4);
  }

  _tex(internalFormat, w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _target(internalFormat, w, h) {
    const gl = this.gl;
    const tex = this._tex(internalFormat, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  _draw(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  upload() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.source
    );
  }

  passes() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);

    gl.useProgram(this.stateProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(gl.getUniformLocation(this.stateProgram, 'uSrc'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.stateA.tex);
    gl.uniform1i(gl.getUniformLocation(this.stateProgram, 'uState'), 1);
    this._draw(this.stateB);

    gl.useProgram(this.reduceProgram);
    const uTex = gl.getUniformLocation(this.reduceProgram, 'uTex');
    const uFrom = gl.getUniformLocation(this.reduceProgram, 'uFromState');
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(uTex, 0);

    let from = this.stateB.tex;
    for (let i = 0; i < this.chain.length; i++) {
      gl.uniform1i(uFrom, i === 0 ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, from);
      this._draw(this.chain[i]);
      from = this.chain[i].tex;
    }

    const swap = this.stateA;
    this.stateA = this.stateB;
    this.stateB = swap;
  }

  readSync() {
    const gl = this.gl;
    const last = this.chain[this.chain.length - 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, last.fbo);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, this.readback);
    this.result = this.readback[0];
    return this.result;
  }

  readAsync() {
    const gl = this.gl;
    if (this.pending) {
      const st = gl.clientWaitSync(this.pending, 0, 0);
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.readback);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteSync(this.pending);
        this.pending = null;
        this.result = this.readback[0];
      }
    }
    if (!this.pending) {
      const last = this.chain[this.chain.length - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, last.fbo);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.pending = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    }
    return this.result;
  }

  update() {
    this.upload();
    this.passes();
    return this.asyncReadback ? this.readAsync() : this.readSync();
  }
}
