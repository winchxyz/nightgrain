// Anything that can feed the engine: still images, animated images, video, built-in scenes.

import { decodeGif } from './gif.js';

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

class StillSource {
  constructor(img, w, h, name) {
    this.kind = 'image';
    this.animated = false;
    this.img = img;
    this.w = w;
    this.h = h;
    this.name = name;
    this.duration = 0;
  }
  frame() { return this.img; }
  async seek() {}
  dispose() { if (this.img && this.img.close) this.img.close(); }
}

class FramesSource {
  constructor(frames, w, h, name) {
    this.kind = 'gif';
    this.animated = true;
    this.frames = frames; // [{img, at (s)}]
    this.w = w;
    this.h = h;
    this.name = name;
    this.duration = frames.total;
  }
  frame(time) {
    const f = this.frames;
    const t = ((time % this.duration) + this.duration) % this.duration;
    let lo = 0, hi = f.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f[mid].at <= t) lo = mid;
      else hi = mid - 1;
    }
    return f[lo].img;
  }
  async seek() {}
  dispose() { for (const f of this.frames) if (f.img.close) f.img.close(); }
}

class VideoSource {
  constructor(el, name, url) {
    this.kind = 'video';
    this.animated = true;
    this.el = el;
    this.url = url;
    this.w = el.videoWidth;
    this.h = el.videoHeight;
    this.name = name;
    this.duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 1;
  }
  frame() { return this.el; }
  seek(time) {
    const v = this.el;
    const target = Math.min(Math.max(0, time), Math.max(0, this.duration - 0.001));
    return new Promise((res) => {
      if (Math.abs(v.currentTime - target) < 1e-3 && v.readyState >= 2 && !v.seeking) return res();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        v.removeEventListener('seeked', finish);
        res();
      };
      v.addEventListener('seeked', finish);
      v.currentTime = target;
      setTimeout(finish, 2500);
    });
  }
  dispose() {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this.url) URL.revokeObjectURL(this.url);
  }
}

// Keep decoded animations inside a memory budget by shrinking large ones.
function frameScale(w, h, count) {
  const budget = 220e6;
  const byBudget = Math.sqrt(budget / (w * h * 4 * Math.max(1, count)));
  const bySide = 900 / Math.max(w, h);
  return Math.min(1, byBudget, bySide);
}

async function decodeAnimated(file) {
  if (typeof ImageDecoder === 'undefined') return null;
  let ok = false;
  try { ok = await ImageDecoder.isTypeSupported(file.type); } catch (e) { ok = false; }
  if (!ok) return null;
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
  await dec.tracks.ready;
  const track = dec.tracks.selectedTrack;
  if (!track || !track.animated || track.frameCount < 2) { dec.close(); return null; }
  const count = Math.min(track.frameCount, 400);
  const frames = [];
  let at = 0, w = 0, h = 0, sc = 1;
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    if (!w) {
      w = image.displayWidth;
      h = image.displayHeight;
      sc = frameScale(w, h, count);
    }
    const c = mk(Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc)));
    c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
    const dur = Math.max(0.02, (image.duration || 100000) / 1e6);
    frames.push({ img: c, at });
    at += dur;
    image.close();
  }
  dec.close();
  frames.total = at;
  return { frames, w: frames[0].img.width, h: frames[0].img.height };
}

async function decodeGifFallback(file) {
  const g = decodeGif(await file.arrayBuffer());
  if (g.frames.length < 2) return null;
  const sc = frameScale(g.width, g.height, g.frames.length);
  const frames = [];
  let at = 0;
  const full = mk(g.width, g.height);
  const fx = full.getContext('2d');
  for (const f of g.frames) {
    fx.putImageData(new ImageData(f.data, g.width, g.height), 0, 0);
    const c = mk(Math.max(1, Math.round(g.width * sc)), Math.max(1, Math.round(g.height * sc)));
    c.getContext('2d').drawImage(full, 0, 0, c.width, c.height);
    frames.push({ img: c, at });
    at += Math.max(0.02, f.delay / 1000);
  }
  frames.total = at;
  return { frames, w: frames[0].img.width, h: frames[0].img.height };
}

function loadImageEl(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('This file could not be read as an image.'));
    img.src = url;
  });
}

function loadVideo(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      rej(new Error('This video format is not supported by your browser.'));
    };
    v.onerror = fail;
    v.onloadeddata = () => {
      if (settled) return;
      settled = true;
      if (!v.videoWidth) return rej(new Error('This video has no picture track.'));
      res(new VideoSource(v, file.name, url));
    };
    setTimeout(fail, 20000);
    v.src = url;
    v.load();
  });
}

/** Turn a File or Blob into a source. Throws with a readable message. */
export async function loadFile(file) {
  const name = file.name || 'pasted image';
  const type = file.type || '';
  const isVideo = type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|ogv)$/i.test(name);
  if (isVideo) return loadVideo(file);

  const maybeAnimated = /gif|webp|apng|png|avif/.test(type) || /\.(gif|webp|apng)$/i.test(name);
  if (maybeAnimated) {
    let anim = null;
    try { anim = await decodeAnimated(file); } catch (e) { anim = null; }
    if (!anim && (/gif/.test(type) || /\.gif$/i.test(name))) {
      try { anim = await decodeGifFallback(file); } catch (e) { anim = null; }
    }
    if (anim) return new FramesSource(anim.frames, anim.w, anim.h, name);
  }

  try {
    const bmp = await createImageBitmap(file);
    return new StillSource(bmp, bmp.width, bmp.height, name);
  } catch (e) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageEl(url);
      const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
      const c = mk(w, h);
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return new StillSource(c, w, h, name);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

// ---------- built-in scenes (tiny raymarcher, so the app never opens empty) ----------

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uPhase;
uniform int uScene;
const float PI = 3.14159265;
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }

vec2 opU(vec2 a, vec2 b){ return a.x < b.x ? a : b; }

vec2 sword(vec3 p){
  p.xy = rot(0.32) * p.xy;
  p.y = 0.72 - p.y;
  p.xz = rot(0.35 + 0.55 * sin(uPhase * 2.0 * PI)) * p.xz;
  float y = p.y;
  float taper = 1.0 - smoothstep(1.3, 1.96, y);
  float w = 0.165 * taper + 0.003;
  float bl = dot(abs(p.xz), vec2(0.339, 0.941)) - w * 0.339;
  bl = max(bl, abs(y - 0.98) - 0.98);
  vec2 d = vec2(bl, 1.0);
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float gd = sdCap(q, vec3(0.0, 0.0, 0.0), vec3(0.4, 0.11, 0.0), 0.046);
  gd = min(gd, length(q - vec3(0.42, 0.12, 0.0)) - 0.072);
  gd = min(gd, length(p - vec3(0.0, 0.0, 0.0)) - 0.085);
  d = opU(d, vec2(gd, 2.0));
  float gr = sdCap(p, vec3(0.0, -0.06, 0.0), vec3(0.0, -0.56, 0.0), 0.043 + 0.006 * sin(p.y * 95.0));
  d = opU(d, vec2(gr, 3.0));
  vec3 pm = p - vec3(0.0, -0.66, 0.0); pm.y *= 1.3;
  d = opU(d, vec2(length(pm) - 0.095, 2.0));
  return d;
}

vec2 rings(vec3 p){
  float a = uPhase * 2.0 * PI;
  vec2 d = vec2(length(p) - 0.2, 2.0);
  vec3 q = p; q.xy = rot(a) * q.xy; q.yz = rot(0.5) * q.yz;
  d = opU(d, vec2(sdTorus(q, vec2(0.48, 0.035)), 1.0));
  q = p; q.yz = rot(a + 1.0) * q.yz; q.xz = rot(0.8) * q.xz;
  d = opU(d, vec2(sdTorus(q.yxz, vec2(0.74, 0.04)), 1.0));
  q = p; q.xz = rot(-a) * q.xz; q.xy = rot(1.15) * q.xy;
  d = opU(d, vec2(sdTorus(q, vec2(1.0, 0.045)), 2.0));
  return d;
}

vec2 map(vec3 p){ return uScene == 2 ? rings(p) : sword(p); }

vec3 normalAt(vec3 p){
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(map(p + e.xyy).x - map(p - e.xyy).x, map(p + e.yxy).x - map(p - e.yxy).x, map(p + e.yyx).x - map(p - e.yyx).x));
}

vec3 env(vec3 r, vec3 key){
  vec3 c = vec3(0.01, 0.03, 0.09) + vec3(0.07, 0.2, 0.62) * pow(clamp(r.y * 0.5 + 0.5, 0.0, 1.0), 2.2);
  c += vec3(1.0, 0.56, 0.25) * pow(max(dot(r, key), 0.0), 7.0) * 2.2;
  c += vec3(0.5, 0.7, 1.0) * pow(max(dot(r, normalize(vec3(-0.8, 0.1, 0.3))), 0.0), 16.0) * 1.1;
  return c;
}

float moonH(vec3 sp){ return fbm(sp * 7.0) + 0.35 * fbm(sp * 19.0); }
vec3 moon(vec2 uv){
  float r2 = dot(uv, uv);
  float R = 0.82;
  if (r2 > R * R) return vec3(0.0);
  vec3 n = vec3(uv / R, sqrt(1.0 - r2 / (R * R)));
  vec3 sp = n; sp.xz = rot(0.6) * sp.xz;
  float e = 0.012;
  float h0 = moonH(sp);
  float hx = moonH(sp + vec3(e, 0.0, 0.0));
  float hy = moonH(sp + vec3(0.0, e, 0.0));
  float maria = smoothstep(0.40, 0.60, fbm(sp * 1.7 + 3.0));
  n = normalize(n + vec3(h0 - hx, h0 - hy, 0.0) * 2.6);
  vec3 L = normalize(vec3(-0.72, 0.42, 0.5));
  float alb = mix(0.95, 0.34, maria) * (0.62 + 0.6 * h0);
  float dif = max(dot(n, L), 0.0);
  vec3 c = alb * dif * vec3(1.0, 0.84, 0.64) * 1.2;
  c += alb * vec3(0.03, 0.08, 0.24) * (0.5 + 0.5 * n.z);
  c += vec3(0.1, 0.25, 0.7) * pow(1.0 - n.z, 3.0) * 0.45;
  return c;
}

void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
  vec3 col = vec3(0.0);
  if (uScene == 1) {
    col = moon(uv);
  } else {
    vec3 ro = vec3(0.0, 0.0, 4.15);
    vec3 rd = normalize(vec3(uv * 0.74, -2.0));
    float t = 2.0; float id = 0.0; bool hit = false;
    for (int i = 0; i < 96; i++) {
      vec2 d = map(ro + rd * t);
      if (d.x < 0.0012) { hit = true; id = d.y; break; }
      t += d.x * 0.85;
      if (t > 8.0) break;
    }
    if (hit) {
      vec3 p = ro + rd * t;
      vec3 n = normalAt(p);
      // A little surface grain so flat facets catch the light unevenly.
      n = normalize(n + (vec3(noise(p * 9.0), noise(p * 9.0 + 7.3), noise(p * 9.0 + 3.1)) - 0.5) * 0.22);
      vec3 key = normalize(vec3(0.55, 0.6, 0.6));
      vec3 r = reflect(rd, n);
      float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
      // Two nearby lamps: warm by the hilt, cold toward the tip.
      vec3 l1 = vec3(1.3, 1.5, 2.2) - p; float d1 = dot(l1, l1); l1 = normalize(l1);
      vec3 l2 = vec3(-1.4, -1.3, 1.8) - p; float d2 = dot(l2, l2); l2 = normalize(l2);
      vec3 hv1 = normalize(l1 - rd), hv2 = normalize(l2 - rd);
      vec3 lamp = vec3(1.0, 0.58, 0.28) * (max(dot(n, l1), 0.0) * 0.5 + pow(max(dot(n, hv1), 0.0), 26.0) * 2.4) * 5.0 / (1.0 + d1)
                + vec3(0.35, 0.6, 1.0) * (max(dot(n, l2), 0.0) * 0.5 + pow(max(dot(n, hv2), 0.0), 20.0) * 1.8) * 5.0 / (1.0 + d2);
      if (id < 1.5) {
        col = env(r, key) * vec3(0.7, 0.8, 1.0) * 0.8 + lamp * vec3(0.8, 0.86, 1.0) * 1.3;
        col += vec3(0.25, 0.5, 1.0) * fres * 0.8;
      } else if (id < 2.5) {
        col = env(r, key) * vec3(1.0, 0.7, 0.34) * 0.6 + lamp * vec3(1.0, 0.72, 0.36) * 1.4;
        col += vec3(0.3, 0.5, 1.0) * fres * 0.4;
      } else {
        col = vec3(0.6, 0.3, 0.16) * lamp * 1.6 + vec3(0.2, 0.35, 0.8) * fres * 0.5;
      }
    }
  }
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);
}`;

export const SAMPLES = [
  { id: 'moon', name: 'Moon', scene: 1, animated: false },
  { id: 'rings', name: 'Rings', scene: 2, animated: true },
  { id: 'blade', name: 'Blade', scene: 0, animated: true },
];

let glState = null;
function sampleGL() {
  if (glState) return glState;
  const c = mk(640, 640);
  const gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return (glState = { c, gl: null });
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    glState = { c, gl, uRes: gl.getUniformLocation(prog, 'uRes'), uPhase: gl.getUniformLocation(prog, 'uPhase'), uScene: gl.getUniformLocation(prog, 'uScene') };
  } catch (e) {
    console.warn('Sample scene shader failed:', e);
    glState = { c, gl: null };
  }
  return glState;
}

class SampleSource {
  constructor(def) {
    this.kind = 'sample';
    this.def = def;
    this.animated = def.animated;
    this.loops = true; // its motion always fits the loop length exactly
    this.name = def.name + ' (built-in)';
    this.w = 640;
    this.h = 640;
    this.duration = 0;
    this.last = -1;
    const st = sampleGL();
    if (!st.gl) this.fallback();
  }
  fallback() {
    const st = sampleGL();
    const x = st.c.getContext('2d');
    if (!x) return;
    const g = x.createRadialGradient(250, 230, 20, 320, 320, 300);
    g.addColorStop(0, '#ffd9a0');
    g.addColorStop(0.5, '#3a6fd0');
    g.addColorStop(1, '#000');
    x.fillStyle = '#000';
    x.fillRect(0, 0, 640, 640);
    x.fillStyle = g;
    x.beginPath();
    x.arc(320, 320, 250, 0, 7);
    x.fill();
  }
  /** phase: 0..1 position in the loop */
  frame(time, phase = 0) {
    const st = sampleGL();
    if (!st.gl) return st.c;
    const ph = this.def.animated ? phase : 0;
    const key = this.def.scene * 10 + ph;
    if (st.drawn !== key) {
      const gl = st.gl;
      gl.viewport(0, 0, 640, 640);
      gl.uniform2f(st.uRes, 640, 640);
      gl.uniform1f(st.uPhase, ph);
      gl.uniform1i(st.uScene, this.def.scene);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      st.drawn = key;
    }
    return st.c;
  }
  async seek() {}
  dispose() {}
}

export const sampleSource = (id) => new SampleSource(SAMPLES.find((s) => s.id === id) || SAMPLES[0]);
