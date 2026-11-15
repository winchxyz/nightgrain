// The render pipeline: source frame -> tone -> detail -> mask -> dither -> pixels -> finish.

import { clamp, smooth, hash, hexToRgb, adjustHex, hslToHex, hexOf } from './util.js';
import { dither } from './dither.js';
import { paintTag, tagUnder } from './tag.js';

const TAU = Math.PI * 2;

// ---------- pixel shapes ----------

export const SHAPES = [
  ['square', 'Square'], ['gap', 'Tile'], ['round', 'Rounded'], ['dot', 'Dot'], ['ring', 'Ring'], ['diamond', 'Diamond'],
  ['plus', 'Plus'], ['cross', 'Cross'], ['star', 'Star'], ['spark', 'Spark'], ['heart', 'Heart'], ['tri', 'Triangle'],
  ['hex', 'Hexagon'], ['moon', 'Moon'], ['arrow', 'Arrow'], ['rows', 'Rows'], ['cols', 'Columns'], ['slash', 'Slash'],
];
const SHAPE_IDS = new Set([...SHAPES.map((s) => s[0]), 'custom']);

// The user's own pixel (an image or a typed character) and their own frame image.
// Shared by every engine; the version numbers keep the caches honest.
let customShape = null, customVer = 0;
let frameImage = null, frameVer = 0;
export function setCustomShape(c) { customShape = c || null; customVer++; }
export function setFrameImage(c) { frameImage = c || null; frameVer++; }
export const hasCustomShape = () => !!customShape;

/** The shapes in use when several are mixed. */
export function shapeSet(P) {
  const set = String(P.shapeSet || '').split(',').filter((s) => SHAPE_IDS.has(s));
  return set.length ? set : [P.shape];
}

/** True when light effects add colours beyond the palette. */
export const hasLight = (P) => P.glow > 0 || P.bloom > 0 || P.streak > 0 || P.ring > 0;

/** True when pixels are drawn as anything other than plain full squares. */
export const isShaped = (P) => P.shape !== 'square' || P.shapeMix !== 'none' || P.shapeVar > 0;

function heartPath(x, a) {
  x.moveTo(0, a * 0.88);
  x.bezierCurveTo(-a * 1.35, a * 0.05, -a * 0.75, -a * 1.0, 0, -a * 0.38);
  x.bezierCurveTo(a * 0.75, -a * 1.0, a * 1.35, a * 0.05, 0, a * 0.88);
  x.closePath();
}
function roundedPath(x, hw, hh, c) {
  x.moveTo(-hw + c, -hh);
  x.lineTo(hw - c, -hh); x.quadraticCurveTo(hw, -hh, hw, -hh + c);
  x.lineTo(hw, hh - c); x.quadraticCurveTo(hw, hh, hw - c, hh);
  x.lineTo(-hw + c, hh); x.quadraticCurveTo(-hw, hh, -hw, hh - c);
  x.lineTo(-hw, -hh + c); x.quadraticCurveTo(-hw, -hh, -hw + c, -hh);
  x.closePath();
}

function polygon(x, pts) {
  x.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
  x.closePath();
}
function starPoints(n, R, r, turn = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = turn + (i * Math.PI) / n;
    const q = i % 2 ? r : R;
    pts.push([Math.cos(a) * q, Math.sin(a) * q]);
  }
  return pts;
}

/**
 * Paint one white pixel shape into a k x k cell that starts at the context origin.
 * gap: spacing 0..0.6, rot: degrees, scale: 0..1 share of the full size.
 */
export function paintShape(x, shape, k, gap = 0.18, rot = 0, scale = 1) {
  x.save();
  x.fillStyle = '#fff';
  rot = ((rot % 360) + 360) % 360;
  const g = Math.max(1, Math.round(k * gap));
  // Straight rectangles stay on whole pixels so they are crisp.
  if (rot % 90 === 0 && (shape === 'square' || shape === 'gap' || shape === 'rows' || shape === 'cols')) {
    const flip = rot % 180 !== 0;
    const kind = flip && shape === 'rows' ? 'cols' : flip && shape === 'cols' ? 'rows' : shape;
    const full = Math.max(1, Math.round(k * scale));
    const cut = Math.max(1, Math.round((k - g) * scale));
    const ww = kind === 'square' || kind === 'rows' ? (kind === 'rows' ? k : full) : cut;
    const hh = kind === 'square' || kind === 'cols' ? (kind === 'cols' ? k : full) : cut;
    x.fillRect(Math.floor((k - ww) / 2), Math.floor((k - hh) / 2), ww, hh);
    x.restore();
    return;
  }
  x.beginPath();
  x.rect(0, 0, k, k);
  x.clip();
  x.translate(k / 2, k / 2);
  if (rot) x.rotate((rot * Math.PI) / 180);
  const r = (k / 2) * scale;
  let rule = 'nonzero';
  x.beginPath();
  if (shape === 'square') x.rect(-r, -r, 2 * r, 2 * r);
  else if (shape === 'gap') { const a = r * (1 - gap); x.rect(-a, -a, 2 * a, 2 * a); }
  else if (shape === 'rows') { const a = r * (1 - gap); x.rect(-k, -a, 2 * k, 2 * a); }
  else if (shape === 'cols') { const a = r * (1 - gap); x.rect(-a, -k, 2 * a, 2 * k); }
  else if (shape === 'custom') {
    if (customShape) {
      const a = r * (1.12 - gap);
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(customShape, -a, -a, 2 * a, 2 * a);
      x.restore();
      return;
    }
    x.rect(-r, -r, 2 * r, 2 * r);
  } else if (shape === 'round') {
    const a = r * (1.04 - gap * 0.7);
    roundedPath(x, a, a, a * 0.7);
  } else if (shape === 'dot') x.arc(0, 0, Math.max(0.6, r * (1.08 - gap * 1.2)), 0, TAU);
  else if (shape === 'ring') {
    const a = Math.max(0.8, r * (1.1 - gap));
    x.arc(0, 0, a, 0, TAU);
    x.moveTo(a * 0.5, 0);
    x.arc(0, 0, a * 0.5, 0, TAU);
    rule = 'evenodd';
  } else if (shape === 'diamond') { const a = r * (1.25 - gap); polygon(x, [[0, -a], [a, 0], [0, a], [-a, 0]]); }
  else if (shape === 'plus' || shape === 'cross') {
    if (shape === 'cross') x.rotate(Math.PI / 4);
    const a = r * (shape === 'cross' ? 1.28 - gap : 1.12 - gap), th = a * 0.36;
    x.rect(-a, -th, 2 * a, 2 * th);
    x.rect(-th, -a, 2 * th, 2 * a);
  } else if (shape === 'star') { const a = r * (1.22 - gap); x.translate(0, a * 0.06); polygon(x, starPoints(5, a, a * 0.46)); }
  else if (shape === 'spark') { const a = r * (1.25 - gap); polygon(x, starPoints(4, a, a * 0.3)); }
  else if (shape === 'heart') heartPath(x, r * (1.16 - gap));
  else if (shape === 'tri') { const a = r * (1.16 - gap); polygon(x, [[0, -a * 0.92], [a, a * 0.8], [-a, a * 0.8]]); }
  else if (shape === 'hex') { const a = r * (1.2 - gap); polygon(x, starPoints(6, a, a * 0.866).filter((_, i) => i % 2 === 0)); }
  else if (shape === 'moon') {
    const a = Math.max(0.8, r * (1.1 - gap));
    // A disc with a bite taken out. The cell canvas holds nothing else, so erasing is safe.
    x.arc(0, 0, a, 0, TAU);
    x.fill();
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    x.arc(a * 0.48, -a * 0.22, a * 0.8, 0, TAU);
  } else if (shape === 'arrow') {
    const a = r * (1.16 - gap);
    polygon(x, [[0, -a * 0.9], [a, a * 0.1], [a * 0.42, a * 0.1], [a * 0.42, a * 0.9], [-a * 0.42, a * 0.9], [-a * 0.42, a * 0.1], [-a, a * 0.1]]);
  } else if (shape === 'slash') {
    const th = Math.max(0.5, r * (0.62 - gap * 0.6));
    x.rotate(-Math.PI / 4);
    x.rect(-k * 1.5, -th, k * 3, 2 * th);
  } else x.rect(-r, -r, 2 * r, 2 * r);
  x.fill(rule);
  x.restore();
}

// ---------- palette with the "adjust all" sliders applied ----------

let liveSig = '';
let liveOut = null;
/** The colours actually drawn: switched-off colours left out, adjustments applied. */
export function livePalette(P) {
  const sig = P.pal.join(',') + '|' + P.palHue + '|' + P.palSat + '|' + P.palLight;
  if (sig !== liveSig) {
    const adj = P.palHue || P.palSat !== 1 || P.palLight;
    liveOut = [];
    P.pal.forEach((c, i) => {
      if (i > 0 && c[0] === '!') return;
      liveOut.push(i === 0 || !adj ? hexOf(c) : adjustHex(hexOf(c), P.palHue, P.palSat, P.palLight));
    });
    if (liveOut.length < 2) liveOut.push('#ffffff');
    liveSig = sig;
  }
  return liveOut;
}

export function gridSize(P, sw, sh) {
  let ar;
  if (P.aspect === 'source') {
    const quarter = P.rot === 90 || P.rot === 270;
    ar = quarter ? sh / sw : sw / sh;
  } else {
    const [a, b] = P.aspect.split(':').map(Number);
    ar = a / b;
  }
  if (!Number.isFinite(ar) || ar <= 0) ar = 1;
  const g = Math.max(8, P.grid | 0);
  if (ar >= 1) return { w: g, h: Math.max(4, Math.round(g / ar)) };
  return { w: Math.max(4, Math.round(g * ar)), h: g };
}

// Draw the source into a W x H box with the user's framing.
export function drawFrame(ctx, W, H, src, sw, sh, P) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const quarter = P.rot === 90 || P.rot === 270;
  const rw = quarter ? sh : sw;
  const rh = quarter ? sw : sh;
  const base = P.fit === 'contain' ? Math.min(W / rw, H / rh) : Math.max(W / rw, H / rh);
  const s = base * P.zoom;
  const ox = Math.abs(rw * s - W) / 2;
  const oy = Math.abs(rh * s - H) / 2;
  ctx.translate(W / 2 + P.panX * ox, H / 2 + P.panY * oy);
  ctx.rotate((P.rot * Math.PI) / 180);
  ctx.scale(P.flipX ? -s : s, P.flipY ? -s : s);
  try {
    ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  } catch (e) {
    /* a video that has no frame yet */
  }
  ctx.restore();
}

function boxBlur(src, dst, tmp, w, h, r) {
  // Two-pass box blur with edge clamping.
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + (k < 0 ? 0 : k >= w ? w - 1 : k)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const a = x - r, b = x + r + 1;
      sum += src[row + (b >= w ? w - 1 : b)] - src[row + (a < 0 ? 0 : a)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[(k < 0 ? 0 : k >= h ? h - 1 : k) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / win;
      const a = y - r, b = y + r + 1;
      sum += tmp[(b >= h ? h - 1 : b) * w + x] - tmp[(a < 0 ? 0 : a) * w + x];
    }
  }
}

// Box blur along rows or columns, with nothing beyond the edges. `t` is scratch space.
function blurRows(a, t, w, h, r) {
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x < r && x < w; x++) sum += a[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) sum += a[row + x + r];
      t[row + x] = sum / win;
      if (x - r >= 0) sum -= a[row + x - r];
    }
  }
  a.set(t);
}
function blurCols(a, t, w, h, r) {
  const win = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < r && y < h; y++) sum += a[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) sum += a[(y + r) * w + x];
      t[y * w + x] = sum / win;
      if (y - r >= 0) sum -= a[(y - r) * w + x];
    }
  }
  a.set(t);
}

/**
 * Look at a picture and work out how to turn it into a low-key subject on black:
 * a gain, a black cut and a midtone curve, plus whether it sits on a plain light background.
 */
export function analyse(drawable, sw, sh, invert) {
  const S = 96;
  const c = canvas(S, S);
  const x = c.getContext('2d', { willReadFrequently: true });
  const none = { gain: 1, black: 0, gamma: 1, lightBg: false };
  let d;
  try {
    x.drawImage(drawable, 0, 0, sw, sh, 0, 0, S, S);
    d = x.getImageData(0, 0, S, S).data;
  } catch (e) {
    return none;
  }
  const lumAt = (j) => (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255;
  // Border ring: is the background one plain colour?
  let br = 0, bg = 0, bb = 0, bc = 0;
  const ring = [];
  for (let i = 0; i < S; i++) for (const [px, py] of [[i, 0], [i, 1], [i, S - 1], [i, S - 2], [0, i], [1, i], [S - 1, i], [S - 2, i]]) ring.push((py * S + px) * 4);
  for (const j of ring) if (d[j + 3] > 127) { br += d[j]; bg += d[j + 1]; bb += d[j + 2]; bc++; }
  let lightBg = false;
  if (bc > ring.length * 0.6) {
    br /= bc; bg /= bc; bb /= bc;
    let dev = 0;
    for (const j of ring) if (d[j + 3] > 127) dev += Math.abs(d[j] - br) + Math.abs(d[j + 1] - bg) + Math.abs(d[j + 2] - bb);
    dev /= bc * 3;
    lightBg = !invert && dev < 16 && 0.299 * br + 0.587 * bg + 0.114 * bb > 135;
  }
  const lum = [];
  for (let j = 0; j < d.length; j += 4) {
    if (d[j + 3] < 128) continue;
    if (lightBg && Math.abs(d[j] - br) + Math.abs(d[j + 1] - bg) + Math.abs(d[j + 2] - bb) < 110) continue;
    let l = lumAt(j);
    if (invert) l = 1 - l;
    if (l > 0.04) lum.push(l);
  }
  if (lum.length < S * S * 0.01) return { ...none, lightBg };
  lum.sort((a, b) => a - b);
  const p50 = lum[Math.floor(lum.length * 0.5)];
  const p99 = lum[Math.floor(lum.length * 0.99)];
  const gain = clamp(0.86 / Math.max(p99, 0.08), 0.7, 4);
  const m = Math.min(0.98, p50 * gain);
  const black = clamp(m - 0.34, 0, 0.5);
  const m2 = Math.max(0.01, (m - black) / (1 - black));
  const gamma = clamp(Math.log(0.13) / Math.log(m2), 1, 2.3);
  return { gain: +gain.toFixed(3), black: +black.toFixed(3), gamma: +gamma.toFixed(3), lightBg };
}

const canvas = (w = 1, h = 1) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export class Engine {
  constructor() {
    this.work = canvas();
    this.wctx = this.work.getContext('2d', { willReadFrequently: true });
    this.pix = canvas();
    this.pctx = this.pix.getContext('2d');
    this.layer = canvas();
    this.lctx = this.layer.getContext('2d');
    this.tmpA = canvas();
    this.tmpB = canvas();
    this.small = canvas();
    this.w = 0;
    this.h = 0;
    this.patterns = new Map();
    this.tiles = new Map();
    this.gammaLUT = new Float32Array(1025);
    this.gammaFor = -1;
    this.raw = null;
    this.hasFilter = typeof this.lctx.filter === 'string';
  }

  alloc(w, h) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.work.width = w;
    this.work.height = h;
    this.pix.width = w;
    this.pix.height = h;
    this.R = new Float32Array(n);
    this.G = new Float32Array(n);
    this.B = new Float32Array(n);
    this.M = new Float32Array(n);
    this.T1 = new Float32Array(n);
    this.T2 = new Float32Array(n);
    this.T3 = new Float32Array(n);
    this.idx = new Uint8Array(n);
    this.idx2 = new Uint8Array(n);
    this.lit = new Uint8Array(n);
    // How bright every cell is (0..255), kept beside its palette colour.
    this.lv = new Uint8Array(n);
    this.lv2 = new Uint8Array(n);
    this.pimg = this.pctx.createImageData(w, h);
  }

  /**
   * P: settings, src: drawable, sw/sh: its size, t: seconds into the loop, L: loop length.
   * Leaves palette indices in this.idx and the coloured pixels in this.pix.
   */
  render(P, src, sw, sh, t = 0, L = 4) {
    const { w, h } = gridSize(P, sw, sh);
    if (w !== this.w || h !== this.h) this.alloc(w, h);
    drawFrame(this.wctx, w, h, src, sw, sh, P);
    if (P.sym !== 'none') this.symmetry(P, w, h);
    if (P.text) this.drawText(P, w, h);
    const d = this.wctx.getImageData(0, 0, w, h).data;
    this.raw = d;
    const n = w * h;
    const { R, G, B, M, T1, T2, T3 } = this;
    const phase = L > 0 ? (((t % L) + L) % L) / L : 0;

    // ---- tone ----
    const pulse = P.pulse > 0 ? 1 + P.pulse * 0.6 * Math.sin(TAU * phase * Math.max(1, Math.round(P.pulseN))) : 1;
    const gain = Math.pow(2, P.exposure) * pulse;
    const gr = gain * (1 + P.temp * 0.35);
    const gb = gain * (1 - P.temp * 0.35);
    const hr = (P.hue * Math.PI) / 180;
    const c = Math.cos(hr), s = Math.sin(hr);
    const m00 = 0.213 + c * 0.787 - s * 0.213, m01 = 0.715 - c * 0.715 - s * 0.715, m02 = 0.072 - c * 0.072 + s * 0.928;
    const m10 = 0.213 - c * 0.213 + s * 0.143, m11 = 0.715 + c * 0.285 + s * 0.14, m12 = 0.072 - c * 0.072 - s * 0.283;
    const m20 = 0.213 - c * 0.213 - s * 0.787, m21 = 0.715 - c * 0.715 + s * 0.715, m22 = 0.072 + c * 0.928 + s * 0.072;
    const sat = P.sat;
    const con = P.contrast >= 0 ? 1 + P.contrast * 2.5 : 1 + P.contrast;
    const black = P.black;
    const range = Math.max(0.02, P.white - P.black);
    if (this.gammaFor !== P.gamma) {
      for (let i = 0; i <= 1024; i++) this.gammaLUT[i] = Math.pow(i / 1024, P.gamma);
      this.gammaFor = P.gamma;
    }
    const LUT = this.gammaLUT;
    const inv = P.invert;
    const useHue = P.hue !== 0;
    const NL = P.auto && this.norm ? this.normLUT(this.norm) : null;

    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const a = d[j + 3] / 255;
      let r = (d[j] / 255) * a, g = (d[j + 1] / 255) * a, b = (d[j + 2] / 255) * a;
      if (inv) { r = a - r; g = a - g; b = a - b; }
      if (NL) { r = NL[(r * 1024) | 0]; g = NL[(g * 1024) | 0]; b = NL[(b * 1024) | 0]; }
      r *= gr; g *= gain; b *= gb;
      if (useHue) {
        const r2 = m00 * r + m01 * g + m02 * b;
        const g2 = m10 * r + m11 * g + m12 * b;
        b = m20 * r + m21 * g + m22 * b;
        r = r2; g = g2;
      }
      if (sat !== 1) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
      }
      r = ((r - 0.5) * con + 0.5 - black) / range;
      g = ((g - 0.5) * con + 0.5 - black) / range;
      b = ((b - 0.5) * con + 0.5 - black) / range;
      R[i] = LUT[r <= 0 ? 0 : r >= 1 ? 1024 : (r * 1024) | 0];
      G[i] = LUT[g <= 0 ? 0 : g >= 1 ? 1024 : (g * 1024) | 0];
      B[i] = LUT[b <= 0 ? 0 : b >= 1 ? 1024 : (b * 1024) | 0];
      M[i] = a;
    }

    // ---- soften / sharpen ----
    const br = Math.round(P.blur);
    if (br > 0) {
      boxBlur(R, R, T1, w, h, br);
      boxBlur(G, G, T1, w, h, br);
      boxBlur(B, B, T1, w, h, br);
    }
    if (P.sharpen > 0) {
      const k = P.sharpen;
      for (const ch of [R, G, B]) {
        boxBlur(ch, T2, T1, w, h, 1);
        for (let i = 0; i < n; i++) ch[i] += (ch[i] - T2[i]) * k;
      }
    }

    // ---- edges ----
    if (P.edge > 0 || P.edgeFill < 1) {
      const Lm = T1;
      for (let i = 0; i < n; i++) Lm[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
      const E = T2;
      const ek = P.edge * 1.4;
      for (let y = 0; y < h; y++) {
        const y0 = (y > 0 ? y - 1 : y) * w, y1 = y * w, y2 = (y < h - 1 ? y + 1 : y) * w;
        for (let x = 0; x < w; x++) {
          const x0 = x > 0 ? x - 1 : x, x2 = x < w - 1 ? x + 1 : x;
          const gx = Lm[y0 + x2] + 2 * Lm[y1 + x2] + Lm[y2 + x2] - Lm[y0 + x0] - 2 * Lm[y1 + x0] - Lm[y2 + x0];
          const gy = Lm[y2 + x0] + 2 * Lm[y2 + x] + Lm[y2 + x2] - Lm[y0 + x0] - 2 * Lm[y0 + x] - Lm[y0 + x2];
          E[y1 + x] = Math.sqrt(gx * gx + gy * gy) * ek;
        }
      }
      const fill = P.edgeFill;
      for (let i = 0; i < n; i++) {
        const e = E[i];
        R[i] = R[i] * fill + e;
        G[i] = G[i] * fill + e;
        B[i] = B[i] * fill + e;
      }
    }

    // ---- glint: a band of light that sweeps across the subject ----
    if (P.glint > 0) {
      const ang = (P.glintAngle * Math.PI) / 180;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const diag = Math.abs(w * ca) + Math.abs(h * sa) || 1;
      const sweeps = Math.max(1, Math.round(P.glintN));
      const pos = ((phase * sweeps) % 1) * (1 + 6 * P.glintWidth) - 3 * P.glintWidth;
      const wd = Math.max(0.01, P.glintWidth);
      const k = P.glint * 3;
      // With "dark outside" the band is the only light there is, like a torch passing over.
      const base = 1 - (P.glintDark || 0);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = ((x - w / 2) * ca + (y - h / 2) * sa) / diag + 0.5;
          const q = (p - pos) / wd;
          const lit = q > -3 && q < 3;
          if (lit || base < 1) {
            const gl = base + (lit ? Math.exp(-q * q) * (k + 1 - base) : 0);
            const i = y * w + x;
            R[i] *= gl; G[i] *= gl; B[i] *= gl;
          }
        }
      }
    }

    // ---- tint: colour the picture itself, so the dither picks other palette colours ----
    if (P.tint !== 'none' && P.tintAmt > 0) this.tint(P, w, h, phase);

    // ---- isolate: key, vignette, reveal ----
    if (P.key === 'luma') {
      const lo = P.keyTh - P.keySoft / 2, hi = P.keyTh + P.keySoft / 2;
      for (let i = 0; i < n; i++) M[i] *= smooth(lo, hi, 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i]);
    } else if (P.key === 'auto' || P.key === 'pick') {
      let kr, kg, kb;
      if (P.key === 'pick') [kr, kg, kb] = hexToRgb(P.keyColor);
      else [kr, kg, kb] = this.borderColor(d, w, h);
      const lo = P.keyTh * 1.2, hi = lo + Math.max(0.005, P.keySoft);
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const dr = (d[j] - kr) / 255, dg = (d[j + 1] - kg) / 255, db = (d[j + 2] - kb) / 255;
        M[i] *= smooth(lo, hi, Math.sqrt(dr * dr + dg * dg + db * db));
      }
    }
    // V: what the frame shape, the corner fade and the entrance let through. Kept apart
    // from M so that painted pixels obey it too.
    const V = T3;
    const fm = P.frame !== 'none' ? this.frameMask(P, w, h) : null;
    const entering = P.intro !== 'none' && P.introLen > 0;
    const useV = P.vig > 0 || !!fm || entering;
    if (useV) V.fill(1);
    if (P.vig > 0) {
      const cx = w / 2, cy = h / 2;
      const size = P.vigSize;
      for (let y = 0; y < h; y++) {
        const dy = (y + 0.5 - cy) / cy;
        for (let x = 0; x < w; x++) {
          const dx = (x + 0.5 - cx) / cx;
          V[y * w + x] *= 1 - P.vig * smooth(size, size + 0.6, Math.sqrt(dx * dx + dy * dy));
        }
      }
    }
    if (fm) for (let i = 0; i < n; i++) V[i] *= fm[i];
    if (entering) {
      const tin = phase / P.introLen;
      const tout = P.outro ? (1 - phase) / P.introLen : 9;
      const vis = clamp(Math.min(tin, tout));
      if (vis < 1) this.reveal(V, w, h, P.intro, vis);
    }
    const pt = this.paint && this.paint.used ? this.paint : null;
    if (!pt) {
      for (let i = 0; i < n; i++) {
        const m = useV ? M[i] * V[i] : M[i];
        if (m < 1) { R[i] *= m; G[i] *= m; B[i] *= m; }
      }
    } else {
      // Hand painting: the eraser hides pixels, the brush lays colour over the picture.
      const lit = this.lit;
      lit.fill(0);
      const pw = pt.w, ph = pt.h, er = pt.erase, pc = pt.col;
      for (let y = 0; y < h; y++) {
        const prow = Math.min(ph - 1, ((y + 0.5) / h * ph) | 0) * pw;
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const j = prow + Math.min(pw - 1, ((x + 0.5) / w * pw) | 0);
          const v = useV ? V[i] : 1;
          let m = M[i] * v;
          const e = er[j];
          if (e) m *= 1 - e / 255;
          if (m < 1) { R[i] *= m; G[i] *= m; B[i] *= m; }
          const a = pc[j * 4 + 3];
          if (a) {
            const pa = (a / 255) * v;
            R[i] += (pc[j * 4] / 255 - R[i]) * pa;
            G[i] += (pc[j * 4 + 1] / 255 - G[i]) * pa;
            B[i] += (pc[j * 4 + 2] / 255 - B[i]) * pa;
            if (pa > 0.3) lit[i] = 1;
          }
        }
      }
    }

    // ---- trails: bright pixels smear along one direction and break into dust ----
    if (P.wind > 0) this.trails(P, w, h);

    // ---- touch: the pointer bends and lights the picture (live view only) ----
    if (this.touch && this.touchOn && P.touch !== 'off') this.touch.apply(this, P);

    const lv = this.lv;
    for (let i = 0; i < n; i++) {
      const l = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
      lv[i] = l <= 0 ? 0 : l >= 1 ? 255 : (l * 255) | 0;
    }

    // ---- dither ----
    const pal = this.palette(P);
    const tick = Math.floor(t * P.rate + 1e-6);
    this.tick = tick;
    dither({
      R, G, B, w, h, pal: pal.f, n: pal.n, out: this.idx,
      algo: P.algo, mode: P.mode, amount: P.amount, bias: P.bias, pscale: P.pscale, serp: P.serp,
      shimmer: P.shimmer, tick,
      dx: Math.round(tick * P.driftX), dy: Math.round(tick * P.driftY),
    });

    const idx = this.idx;
    // Outside the picture (letterbox, transparent PNG) is always backdrop.
    if (P.wind <= 0) {
      const lit = pt ? this.lit : null;
      for (let i = 0, j = 3; i < n; i++, j += 4) if (d[j] < 96 && !(lit && lit[i])) { idx[i] = 0; lv[i] = 0; }
    }

    if (P.sparkle > 0) {
      const top = pal.brightest;
      const p = P.sparkle * 0.12;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (idx[i] !== 0 && hash(x, y, tick * 7 + 3) < p) { idx[i] = top; lv[i] = 255; }
        }
      }
    }

    // ---- break apart: lit pixels fly off and come back ----
    if (P.burst !== 'none') this.scatter(P, w, h, phase);

    // How much light the frame holds; the lens ring answers to it.
    let energy = 0;
    for (let i = 0; i < n; i++) if (idx[i]) energy += lv[i];
    this.energy = energy / (n * 255);

    // ---- paint ----
    const out = this.pimg.data;
    const u8 = pal.u8;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const k = idx[i];
      if (k === 0) { out[j + 3] = 0; continue; }
      out[j] = u8[k * 3];
      out[j + 1] = u8[k * 3 + 1];
      out[j + 2] = u8[k * 3 + 2];
      out[j + 3] = 255;
    }
    this.pctx.putImageData(this.pimg, 0, 0);
    return this;
  }

  /** Mirror halves or build a kaleidoscope out of the framed picture. */
  symmetry(P, w, h) {
    const c = this.symC || (this.symC = canvas());
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d');
    x.clearRect(0, 0, w, h);
    x.drawImage(this.work, 0, 0);
    const g = this.wctx;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    const part = (cx, cy, cw, ch, fx, fy) => {
      g.save();
      g.beginPath();
      g.rect(cx, cy, cw, ch);
      g.clip();
      g.translate(fx ? w : 0, fy ? h : 0);
      g.scale(fx ? -1 : 1, fy ? -1 : 1);
      g.drawImage(c, 0, 0);
      g.restore();
    };
    const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
    if (P.sym === 'h') { part(0, 0, hw, h, false, false); part(w - hw, 0, hw, h, true, false); }
    else if (P.sym === 'v') { part(0, 0, w, hh, false, false); part(0, h - hh, w, hh, false, true); }
    else if (P.sym === 'quad') {
      part(0, 0, hw, hh, false, false); part(w - hw, 0, hw, hh, true, false);
      part(0, h - hh, hw, hh, false, true); part(w - hw, h - hh, hw, hh, true, true);
    } else {
      const N = Math.max(2, Math.round(P.symN));
      const th = Math.PI / N;
      const rad = Math.hypot(w, h);
      const turn = (P.symTurn * Math.PI) / 180;
      for (let i = 0; i < N * 2; i++) {
        g.save();
        g.translate(w / 2, h / 2);
        g.rotate(i * th);
        if (i % 2) { g.rotate(th); g.scale(1, -1); }
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(rad, -0.6);
        g.lineTo(rad * Math.cos(th + 0.012), rad * Math.sin(th + 0.012));
        g.closePath();
        g.clip();
        g.rotate(-turn);
        g.drawImage(c, -w / 2, -h / 2);
        g.restore();
      }
    }
    g.restore();
  }

  /** Words on top of the picture; they go through the same pipeline. */
  drawText(P, w, h) {
    const g = this.wctx;
    let lines = String(P.text).split('\n').slice(0, 10);
    if (P.textUpper) lines = lines.map((s) => s.toUpperCase());
    const size = Math.max(4, P.textSize * h);
    const fam = P.textFont === 'serif' ? '700 SIZE "New York", "Iowan Old Style", Georgia, serif'
      : P.textFont === 'mono' ? '500 SIZE "SF Mono", ui-monospace, "Geist Mono", Menlo, monospace'
        : '700 SIZE -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.font = fam.replace('SIZE', size.toFixed(1) + 'px');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = P.textColor;
    const sp = P.textSpace * size;
    const spaced = 'letterSpacing' in g;
    if (spaced) g.letterSpacing = sp.toFixed(2) + 'px';
    g.translate(P.textX * w, P.textY * h);
    if (P.textRot) g.rotate((P.textRot * Math.PI) / 180);
    const lh = size * 1.12;
    lines.forEach((s, i) => {
      const y = (i - (lines.length - 1) / 2) * lh;
      // With letter spacing the browser adds a gap after the last letter too; shift it back.
      g.fillText(s, spaced ? sp / 2 : 0, y);
    });
    g.restore();
  }

  /** Coverage 0..1 of the frame shape at every cell. */
  frameMask(P, w, h) {
    if (P.frame === 'custom' && !frameImage) return null;
    const sig = [w, h, P.frame, P.frameSize, P.frameRound, P.frameSoft, P.frame === 'custom' ? frameVer : 0].join('|');
    if (this.fmSig === sig) return this.fm;
    const c = canvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    const s = P.frameSize;
    const m = (Math.min(w, h) / 2) * s;
    x.fillStyle = '#fff';
    x.translate(w / 2, h / 2);
    x.beginPath();
    if (P.frame === 'round') roundedPath(x, (w / 2) * s, (h / 2) * s, Math.min(w, h) * s * P.frameRound);
    else if (P.frame === 'circle') x.ellipse(0, 0, (w / 2) * s, (h / 2) * s, 0, 0, TAU);
    else if (P.frame === 'diamond') polygon(x, [[0, (-h / 2) * s], [(w / 2) * s, 0], [0, (h / 2) * s], [(-w / 2) * s, 0]]);
    else if (P.frame === 'hex') polygon(x, starPoints(6, m, m * 0.866).filter((_, i) => i % 2 === 0));
    else if (P.frame === 'star') { x.translate(0, m * 0.06); polygon(x, starPoints(5, m * 1.05, m * 0.5)); }
    else if (P.frame === 'heart') heartPath(x, m * 1.02);
    else if (P.frame === 'custom') {
      const k = Math.min((w * s) / frameImage.width, (h * s) / frameImage.height);
      x.imageSmoothingQuality = 'high';
      x.drawImage(frameImage, (-frameImage.width * k) / 2, (-frameImage.height * k) / 2, frameImage.width * k, frameImage.height * k);
    }
    x.fill();
    const d = x.getImageData(0, 0, w, h).data;
    const n = w * h;
    const fm = (this.fm && this.fm.length === n) ? this.fm : new Float32Array(n);
    for (let i = 0; i < n; i++) fm[i] = d[i * 4 + 3] / 255;
    const r = Math.round(P.frameSoft * Math.min(w, h));
    if (r > 0) {
      const tmp = new Float32Array(n);
      boxBlur(fm, fm, tmp, w, h, r);
      boxBlur(fm, fm, tmp, w, h, Math.max(1, r >> 1));
    }
    this.fm = fm;
    this.fmSig = sig;
    return fm;
  }

  /** Move lit cells away from their places at the start and/or end of the loop. */
  scatter(P, w, h, phase) {
    const len = Math.max(0.02, P.burstLen);
    const tin = P.burstWhen === 'end' ? 9 : phase / len;
    const tout = P.burstWhen === 'start' ? 9 : (1 - phase) / len;
    const away = 1 - clamp(Math.min(tin, tout));
    if (away <= 0) return;
    const src = this.idx2, out = this.idx;
    src.set(out);
    out.fill(0);
    const lv = this.lv, lsrc = this.lv2;
    lsrc.set(lv);
    lv.fill(0);
    const st = P.burstStagger * 1.5;
    const reach = P.burstDist * Math.max(w, h);
    const cx = w / 2, cy = h / 2;
    const mode = P.burst;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = src[y * w + x];
        if (!v) continue;
        const h1 = hash(x, y, 7), h2 = hash(x, y, 13), h3 = hash(x, y, 29);
        let b = away * (1 + st) - h1 * st;
        if (b <= 0) { out[y * w + x] = v; lv[y * w + x] = lsrc[y * w + x]; continue; }
        if (b > 1) b = 1;
        // Some pixels burn out on the way, so the cloud thins as it spreads.
        if (h3 < b * b * 0.9) continue;
        const e = b * b;
        let nx = x, ny = y;
        if (mode === 'explode') {
          const a = Math.atan2(y - cy, x - cx) + (h2 - 0.5) * 0.9;
          const dist = reach * e * (0.35 + 0.65 * h3);
          nx = x + Math.cos(a) * dist; ny = y + Math.sin(a) * dist;
        } else if (mode === 'scatter') {
          const a = h2 * TAU;
          const dist = reach * 0.6 * e * (0.3 + 0.7 * h3);
          nx = x + Math.cos(a) * dist; ny = y + Math.sin(a) * dist;
        } else if (mode === 'fall' || mode === 'rise') {
          const dy = reach * e * (0.5 + 0.5 * h3);
          nx = x + (h2 - 0.5) * reach * 0.25 * b; ny = mode === 'fall' ? y + dy : y - dy;
        } else if (mode === 'blow') {
          nx = x + reach * 1.2 * e * (0.4 + 0.6 * h3);
          ny = y + Math.sin(b * 5 + h2 * TAU) * reach * 0.08 - reach * 0.15 * e * h2;
        } else {
          const a = Math.atan2(y - cy, x - cx) + e * 3.2 * (0.6 + 0.4 * h2);
          const rr = Math.hypot(x - cx, y - cy) * (1 + e * P.burstDist * (0.6 + h3));
          nx = cx + Math.cos(a) * rr; ny = cy + Math.sin(a) * rr;
        }
        nx = Math.round(nx); ny = Math.round(ny);
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) { out[ny * w + nx] = v; lv[ny * w + nx] = lsrc[y * w + x]; }
      }
    }
  }

  normLUT(nm) {
    const sig = nm.gain + '|' + nm.black + '|' + nm.gamma;
    if (this.normSig === sig) return this.normTable;
    const t = (this.normTable = this.normTable || new Float32Array(1025));
    for (let i = 0; i <= 1024; i++) {
      const v = ((i / 1024) * nm.gain - nm.black) / (1 - nm.black);
      t[i] = v <= 0 ? 0 : Math.pow(v > 1 ? 1 : v, nm.gamma);
    }
    this.normSig = sig;
    return t;
  }

  tint(P, w, h, phase) {
    const { R, G, B } = this;
    const mode = P.tint;
    const move = mode === 'solid' ? 0 : Math.round(P.tintMove);
    const cyc = move !== 0;
    const sig = mode + '|' + P.tintA + '|' + P.tintB + '|' + cyc;
    if (this.tintSig !== sig) {
      const lut = (this.tintTable = this.tintTable || new Float32Array(256 * 3));
      const norm = (hex) => {
        const [r, g, b] = hexToRgb(hex);
        const m = Math.max(r, g, b);
        if (m < 6) return [1, 1, 1];
        // Full-strength hue, lifted so dark hues (blue, red) keep about as many lit pixels.
        const k = Math.pow((0.299 * r + 0.587 * g + 0.114 * b) / m, -0.4);
        return [(r / m) * k, (g / m) * k, (b / m) * k];
      };
      const A = norm(P.tintA), Bc = norm(P.tintB);
      for (let i = 0; i < 256; i++) {
        let f = i / 255, c;
        if (mode === 'rainbow') c = norm(hslToHex(f * 360, 1, 0.5));
        else if (mode === 'solid') c = A;
        else {
          // A moving gradient goes there and back, so it wraps without a seam.
          if (cyc) f = 1 - Math.abs(2 * f - 1);
          c = [A[0] + (Bc[0] - A[0]) * f, A[1] + (Bc[1] - A[1]) * f, A[2] + (Bc[2] - A[2]) * f];
        }
        lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
      }
      this.tintSig = sig;
    }
    const lut = this.tintTable;
    const amt = P.tintAmt;
    const off = cyc ? phase * move : 0;
    const ang = (P.tintAngle * Math.PI) / 180;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const diag = Math.abs(w * ca) + Math.abs(h * sa) || 1;
    const kind = mode === 'solid' ? 0 : mode === 'tone' ? 1 : mode === 'radial' ? 2 : 3;
    for (let y = 0; y < h; y++) {
      const dy = (y + 0.5 - h / 2) / (h / 2);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const l = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
        if (l <= 0.003) continue;
        let f = 0;
        if (kind === 1) f = l;
        else if (kind === 2) { const dx = (x + 0.5 - w / 2) / (w / 2); f = Math.sqrt(dx * dx + dy * dy) / 1.15; }
        else if (kind === 3) f = ((x - w / 2) * ca + (y - h / 2) * sa) / diag + 0.5;
        if (cyc) { f += off; f -= Math.floor(f); }
        const q = ((f <= 0 ? 0 : f >= 1 ? 1 : f) * 255 | 0) * 3;
        R[i] += (lut[q] * l - R[i]) * amt;
        G[i] += (lut[q + 1] * l - G[i]) * amt;
        B[i] += (lut[q + 2] * l - B[i]) * amt;
      }
    }
  }

  palette(P) {
    const cols = livePalette(P);
    const sig = cols.join(',');
    if (this.palSig === sig) return this.pal;
    const n = Math.min(64, cols.length);
    const f = new Float32Array(n * 3);
    const u8 = new Uint8Array(n * 3);
    let brightest = 0, bl = -1;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = hexToRgb(cols[i]);
      u8[i * 3] = r; u8[i * 3 + 1] = g; u8[i * 3 + 2] = b;
      f[i * 3] = r / 255; f[i * 3 + 1] = g / 255; f[i * 3 + 2] = b / 255;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (i > 0 && l > bl) { bl = l; brightest = i; }
    }
    this.palSig = sig;
    this.pal = { n, f, u8, brightest };
    return this.pal;
  }

  borderColor(d, w, h) {
    let r = 0, g = 0, b = 0, c = 0;
    const add = (x, y) => {
      const j = (y * w + x) * 4;
      if (d[j + 3] < 128) return;
      r += d[j]; g += d[j + 1]; b += d[j + 2]; c++;
    };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
    return c ? [r / c, g / c, b / c] : [0, 0, 0];
  }

  reveal(M, w, h, style, vis) {
    const soft = 0.22;
    const v = vis * (1 + soft);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const nz = hash(x, y, 51);
        let p;
        if (style === 'fade') { M[i] *= vis; continue; }
        else if (style === 'dissolve') p = nz;
        else if (style === 'up') p = (1 - y / h) + nz * soft;
        else if (style === 'down') p = y / h + nz * soft;
        else if (style === 'side') p = x / w + nz * soft;
        else {
          const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
          p = Math.sqrt(dx * dx + dy * dy) / 1.42 + nz * soft;
        }
        if (p > v) M[i] = 0;
      }
    }
  }

  trails(P, w, h) {
    const { R, G, B } = this;
    const amt = P.wind;
    const horiz = P.windDir === 'left' || P.windDir === 'right';
    const fwd = P.windDir === 'right' || P.windDir === 'down';
    const lines = horiz ? h : w;
    const len = horiz ? w : h;
    for (let l = 0; l < lines; l++) {
      const g = hash(l, 17, 5);
      if (g > P.windRows) continue;
      const decay = Math.min(0.995, P.windLen * (0.86 + 0.14 * hash(l, 3, 9)));
      const gainRow = amt * (0.4 + 0.6 * hash(l, 29, 2));
      for (const ch of [R, G, B]) {
        let trail = 0;
        for (let k = 0; k < len; k++) {
          const q = fwd ? k : len - 1 - k;
          const i = horiz ? l * w + q : q * w + l;
          const v = ch[i];
          trail = v > trail * decay ? v : trail * decay;
          if (trail > v) ch[i] = v + (trail - v) * gainRow;
        }
      }
    }
  }

  // ---------- finish: scale up and apply pixel shape, glow, scanlines ----------

  shapePattern(ctx, k, P) {
    const key = P.shape + ':' + k + ':' + P.gap.toFixed(3) + ':' + P.shapeRot + (P.shape === 'custom' ? ':' + customVer : '');
    let c = this.patterns.get(key);
    if (!c) {
      c = canvas(k, k);
      paintShape(c.getContext('2d'), P.shape, k, P.gap, P.shapeRot, 1);
      if (this.patterns.size > 40) this.patterns.clear();
      this.patterns.set(key, c);
    }
    return ctx.createPattern(c, 'repeat');
  }

  /** Coverage (0..255) of one shape inside a k x k cell. */
  shapeTile(shape, k, P, scale) {
    const s = Math.round(scale * 20) / 20;
    const own = shape === 'custom' && !P.customTint && customShape;
    const key = shape + ':' + k + ':' + P.gap.toFixed(3) + ':' + P.shapeRot + ':' + s + (shape === 'custom' ? ':' + customVer + (own ? 'c' : '') : '');
    let t = this.tiles.get(key);
    if (!t) {
      const c = canvas(k, k);
      const x = c.getContext('2d', { willReadFrequently: true });
      paintShape(x, shape, k, P.gap, P.shapeRot, s);
      const img = x.getImageData(0, 0, k, k);
      const d = img.data;
      t = new Uint8Array(k * k);
      for (let i = 0; i < t.length; i++) t[i] = d[i * 4 + 3];
      // A custom pixel that keeps its own colours carries them along.
      if (own) t.rgba = new Uint32Array(d.buffer.slice(0));
      if (this.tiles.size > 300) this.tiles.clear();
      this.tiles.set(key, t);
    }
    return t;
  }

  /**
   * Draw every lit cell with its own shape: one shape per palette colour, shapes
   * scattered at random, or sizes that follow the colour's brightness.
   */
  /** Which shape and what size every palette colour gets. Used by the painter and the SVG export. */
  shapePlan(P) {
    const pal = this.palette(P);
    const n = pal.n;
    const set = shapeSet(P);
    const random = P.shapeMix === 'random';
    const byColour = P.shapeMix === 'colour';
    const slots = random ? set.length : 1;
    const scale = new Float32Array(n).fill(1);
    if (P.shapeVar > 0 && n > 2) {
      const lum = new Float32Array(n);
      let lo = 1e9, hi = -1e9;
      for (let i = 1; i < n; i++) {
        lum[i] = 0.299 * pal.u8[i * 3] + 0.587 * pal.u8[i * 3 + 1] + 0.114 * pal.u8[i * 3 + 2];
        if (lum[i] < lo) lo = lum[i];
        if (lum[i] > hi) hi = lum[i];
      }
      if (hi > lo) for (let i = 1; i < n; i++) scale[i] = Math.round((1 - P.shapeVar * 0.72 * (1 - (lum[i] - lo) / (hi - lo))) * 20) / 20;
    }
    const shapes = new Array(n * slots);
    for (let i = 1; i < n; i++) {
      for (let j = 0; j < slots; j++) shapes[i * slots + j] = random ? set[j] : byColour ? set[(i - 1) % set.length] : P.shape;
    }
    return { pal, n, slots, random, shapes, scale };
  }

  /** The slot (which of the scattered shapes) of the cell at x, y. */
  static slotOf(x, y, slots) { return (hash(x, y, 91) * slots) | 0; }

  paintCells(lx, k, pad, P) {
    const { w, h, idx } = this;
    const { pal, n, slots, random, shapes, scale } = this.shapePlan(P);
    const tiles = new Array(n * slots);
    const rgb = new Uint32Array(n);
    for (let i = 1; i < n; i++) {
      rgb[i] = (pal.u8[i * 3 + 2] << 16) | (pal.u8[i * 3 + 1] << 8) | pal.u8[i * 3];
      for (let j = 0; j < slots; j++) tiles[i * slots + j] = this.shapeTile(shapes[i * slots + j], k, P, scale[i]);
    }
    const W = w * k, H = h * k;
    if (!this.cimg || this.cimg.width !== W || this.cimg.height !== H) {
      this.cimg = new ImageData(W, H);
      this.c32 = new Uint32Array(this.cimg.data.buffer);
    }
    const o = this.c32;
    o.fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = idx[y * w + x];
        if (!v) continue;
        const T = tiles[v * slots + (random ? Engine.slotOf(x, y, slots) : 0)];
        const col = rgb[v];
        let row = y * k * W + x * k;
        for (let ty = 0, q = 0; ty < k; ty++, row += W) {
          for (let tx = 0; tx < k; tx++, q++) {
            const a = T[q];
            if (a) o[row + tx] = T.rgba ? T.rgba[q] : (a << 24) | col;
          }
        }
      }
    }
    lx.putImageData(this.cimg, pad * k, pad * k);
  }

  /**
   * Light that spills from the brightest cells: a soft bloom in three sizes and thin
   * sideways streaks. Worked out in plain numbers at one value per cell (or coarser for
   * the wide layers), then enlarged, so it stays smooth and cheap.
   */
  highlights(ctx, k, pad, P) {
    const { w, h, idx, lv } = this;
    const u8 = this.palette(P).u8;
    const th = Math.round(P.hot * 255);
    const tint = P.bloomTint > 0 ? P.bloomTint : 0;
    const [tr, tg, tb] = hexToRgb(P.bloomColor).map((v) => v / 255);
    const store = this.lightStore || (this.lightStore = []);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    let slot = 0;
    // s: cells per value, rx / ry: blur reach in cells, gain: strength, lift: how much faint light is raised.
    const layer = (s, rx, ry, gain, lift, tinted) => {
      const qx = Math.round(rx / s), qy = Math.round(ry / s);
      const mx = 2 * qx + 1, my = 2 * qy + 1;
      const cw = Math.ceil(w / s) + 2 * mx, ch = Math.ceil(h / s) + 2 * my;
      const n = cw * ch;
      let L = store[slot];
      if (!L || L.n !== n) L = store[slot] = { n, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), t: new Float32Array(n), c: canvas(), img: null };
      slot++;
      const { r, g, b, t } = L;
      r.fill(0); g.fill(0); b.fill(0);
      const share = 1 / (255 * s * s);
      for (let y = 0; y < h; y++) {
        const row = (((y / s) | 0) + my) * cw + mx;
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = idx[i], l = lv[i];
          if (!v || l < th) continue;
          // Just over the threshold counts a little, well over it counts in full.
          const e = (0.4 + Math.min(0.6, (l - th) / 60)) * share;
          const j = row + ((x / s) | 0);
          r[j] += u8[v * 3] * e; g[j] += u8[v * 3 + 1] * e; b[j] += u8[v * 3 + 2] * e;
        }
      }
      for (const a of [r, g, b]) {
        for (let pass = 0; pass < 2; pass++) {
          if (qx > 0) blurRows(a, t, cw, ch, qx);
          if (qy > 0) blurCols(a, t, cw, ch, qy);
        }
      }
      if (L.c.width !== cw || L.c.height !== ch) { L.c.width = cw; L.c.height = ch; L.img = null; }
      const lx = L.c.getContext('2d');
      if (!L.img) L.img = lx.createImageData(cw, ch);
      const o = L.img.data;
      const tt = tinted ? tint : 0;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        let R = r[i], G = g[i], B = b[i];
        let m = R > G ? (R > B ? R : B) : (G > B ? G : B);
        if (m < 0.002) { o[j + 3] = 0; continue; }
        if (tt > 0) {
          const lum = 0.299 * R + 0.587 * G + 0.114 * B;
          R += (tr * lum * 1.6 - R) * tt; G += (tg * lum * 1.6 - G) * tt; B += (tb * lum * 1.6 - B) * tt;
          m = R > G ? (R > B ? R : B) : (G > B ? G : B);
          if (m < 0.002) { o[j + 3] = 0; continue; }
        }
        // Colour at full strength, with the amount of light carried in the alpha.
        const amount = gain * (1 - Math.exp(-m * lift));
        o[j] = (R / m) * 255; o[j + 1] = (G / m) * 255; o[j + 2] = (B / m) * 255;
        o[j + 3] = amount >= 1 ? 255 : amount * 255;
      }
      lx.putImageData(L.img, 0, 0);
      ctx.drawImage(L.c, (pad - mx * s) * k, (pad - my * s) * k, cw * s * k, ch * s * k);
    };
    if (P.bloom > 0) {
      const z = P.bloomSize, a = P.bloom;
      layer(1, 1.2 * z, 1.2 * z, Math.min(1, a * 0.3), 1.6, false);
      layer(w > 140 ? 2 : 1, 4 * z, 4 * z, Math.min(1, a * 0.26), 2.6, true);
      layer(w > 140 ? 4 : 2, 13 * z, 13 * z, Math.min(1, a * 0.24), 4.5, true);
    }
    if (P.streak > 0) {
      const len = 4 + P.streak * 26;
      layer(1, len * 0.4, 0, Math.min(1, P.streak * 0.5), 3, false);
      layer(1, len, 0, Math.min(1, P.streak * 0.4), 6, true);
    }
    ctx.restore();
  }

  /** A ring of stray light around the frame, as an old lens shows when it looks at something bright. */
  lensRing(ctx, W, H, P) {
    const a = P.ring * Math.min(1, this.energy * 9);
    if (a <= 0.004) return;
    const cx = W / 2, cy = H / 2;
    const R = 0.5 * Math.hypot(W, H) * 0.8 * P.ringSize;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const band = (centre, width, rgb, peak) => {
      const r0 = Math.max(0, R * (centre - width)), r1 = R * (centre + width);
      const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
      g.addColorStop(0, `rgba(${rgb},0)`);
      g.addColorStop(0.5, `rgba(${rgb},${(peak * a).toFixed(3)})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    // Warm on the inside, cool on the outside, the way glass splits white light.
    band(0.985, 0.13, '255,206,160', 0.2);
    band(1.03, 0.15, '150,178,255', 0.22);
    band(1.0, 0.3, '190,190,205', 0.1);
    // A faint veil inside the ring.
    const [vr, vg, vb] = hexToRgb(P.bloomTint > 0 ? P.bloomColor : '#8f95c8');
    const v = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.92);
    v.addColorStop(0, `rgba(${vr},${vg},${vb},${(0.1 * a).toFixed(3)})`);
    v.addColorStop(0.8, `rgba(${vr},${vg},${vb},${(0.07 * a).toFixed(3)})`);
    v.addColorStop(1, `rgba(${vr},${vg},${vb},0)`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  outSize(P, k) {
    const pad = Math.round(P.pad * Math.max(this.w, this.h));
    return { pad, W: (this.w + 2 * pad) * k, H: (this.h + 2 * pad) * k };
  }

  /** Draw the finished picture onto `target` at k screen pixels per cell. */
  compose(target, k, P, opts = {}) {
    const { pad, W, H } = this.outSize(P, k);
    if (target.width !== W || target.height !== H) { target.width = W; target.height = H; }
    const ctx = target.getContext('2d');
    const L = this.layer;
    if (L.width !== W || L.height !== H) { L.width = W; L.height = H; }
    const lx = this.lctx;
    lx.globalCompositeOperation = 'source-over';
    lx.globalAlpha = 1;
    lx.clearRect(0, 0, W, H);
    lx.imageSmoothingEnabled = false;
    const shaped = k >= 3 && isShaped(P);
    const ownColours = !P.customTint && customShape && (P.shapeMix === 'none' ? P.shape === 'custom' : shapeSet(P).includes('custom'));
    if (shaped && (P.shapeMix !== 'none' || P.shapeVar > 0 || ownColours)) this.paintCells(lx, k, pad, P);
    else {
      lx.drawImage(this.pix, pad * k, pad * k, this.w * k, this.h * k);
      if (shaped) {
        lx.globalCompositeOperation = 'destination-in';
        lx.fillStyle = this.shapePattern(lx, k, P);
        lx.fillRect(0, 0, W, H);
      }
    }
    if (P.scan > 0 && k >= 2) {
      const key = 'scan:' + k;
      let c = this.patterns.get(key);
      if (!c) {
        c = canvas(1, k);
        const x = c.getContext('2d');
        x.fillStyle = '#000';
        x.fillRect(0, k - Math.max(1, Math.round(k * 0.4)), 1, k);
        this.patterns.set(key, c);
      }
      lx.globalCompositeOperation = 'destination-out';
      lx.globalAlpha = P.scan;
      lx.fillStyle = lx.createPattern(c, 'repeat');
      lx.fillRect(0, 0, W, H);
      lx.globalAlpha = 1;
    }
    lx.globalCompositeOperation = 'source-over';

    let art = L;
    if (P.aberr > 0) {
      const off = Math.max(1, Math.round(P.aberr * k));
      const A = this.tmpA, Bc = this.tmpB;
      for (const cv of [A, Bc]) if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      const ax = A.getContext('2d'), bx = Bc.getContext('2d');
      bx.globalCompositeOperation = 'source-over';
      bx.clearRect(0, 0, W, H);
      const parts = [['#ff0000', -off], ['#00ff00', 0], ['#0000ff', off]];
      for (const [col, dx] of parts) {
        ax.globalCompositeOperation = 'source-over';
        ax.clearRect(0, 0, W, H);
        ax.drawImage(L, 0, 0);
        ax.globalCompositeOperation = 'multiply';
        ax.fillStyle = col;
        ax.fillRect(0, 0, W, H);
        ax.globalCompositeOperation = 'destination-in';
        ax.drawImage(L, 0, 0);
        bx.globalCompositeOperation = 'lighter';
        bx.drawImage(A, dx, 0);
      }
      art = Bc;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);
    if (!opts.transparent) {
      ctx.fillStyle = P.pal[0];
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(art, 0, 0);

    if (P.glow > 0) {
      const r = Math.max(1, k * P.glowSize * 1.3);
      ctx.globalCompositeOperation = 'lighter';
      if (this.hasFilter) {
        ctx.globalAlpha = Math.min(1, P.glow * 0.8);
        ctx.filter = `blur(${r.toFixed(1)}px)`;
        ctx.drawImage(art, 0, 0);
        ctx.globalAlpha = Math.min(1, P.glow * 0.5);
        ctx.filter = `blur(${(r * 3.2).toFixed(1)}px)`;
        ctx.drawImage(art, 0, 0);
        ctx.filter = 'none';
      } else {
        // No canvas filters here: blur by shrinking and stretching back.
        const f = Math.max(2, Math.round(r * 1.5));
        const sm = this.small;
        sm.width = Math.max(1, Math.round(W / f));
        sm.height = Math.max(1, Math.round(H / f));
        const sx = sm.getContext('2d');
        sx.imageSmoothingEnabled = true;
        sx.imageSmoothingQuality = 'high';
        sx.drawImage(art, 0, 0, sm.width, sm.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = Math.min(1, P.glow);
        ctx.drawImage(sm, 0, 0, W, H);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.touch && this.touchOn && P.touch === 'glow') {
      const u8 = this.palette(P).u8, b = this.pal.brightest * 3;
      this.touch.paintLight(ctx, pad * k, pad * k, this.w * k, this.h * k, [u8[b], u8[b + 1], u8[b + 2]], P);
    }
    if (P.bloom > 0 || P.streak > 0) this.highlights(ctx, k, pad, P);
    if (P.ring > 0) this.lensRing(ctx, W, H, P);
    if (this.tag && opts.tag !== false) paintTag(ctx, W, H, hexOf(P.pal[0]), tagUnder(this, P, k));
    return { W, H, pad };
  }
}
