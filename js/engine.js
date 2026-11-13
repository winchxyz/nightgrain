// The render pipeline: source frame -> tone -> detail -> mask -> dither -> pixels -> finish.

import { clamp, smooth, hash, hexToRgb } from './util.js';
import { dither } from './dither.js';

const TAU = Math.PI * 2;

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
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = ((x - w / 2) * ca + (y - h / 2) * sa) / diag + 0.5;
          const q = (p - pos) / wd;
          if (q > -3 && q < 3) {
            const gl = 1 + Math.exp(-q * q) * k;
            const i = y * w + x;
            R[i] *= gl; G[i] *= gl; B[i] *= gl;
          }
        }
      }
    }

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
    if (P.vig > 0) {
      const cx = w / 2, cy = h / 2;
      const size = P.vigSize;
      for (let y = 0; y < h; y++) {
        const dy = (y + 0.5 - cy) / cy;
        for (let x = 0; x < w; x++) {
          const dx = (x + 0.5 - cx) / cx;
          M[y * w + x] *= 1 - P.vig * smooth(size, size + 0.6, Math.sqrt(dx * dx + dy * dy));
        }
      }
    }
    if (P.intro !== 'none' && P.introLen > 0) {
      const tin = phase / P.introLen;
      const tout = P.outro ? (1 - phase) / P.introLen : 9;
      const vis = clamp(Math.min(tin, tout));
      if (vis < 1) this.reveal(M, w, h, P.intro, vis);
    }
    for (let i = 0; i < n; i++) {
      const m = M[i];
      if (m < 1) { R[i] *= m; G[i] *= m; B[i] *= m; }
    }

    // ---- trails: bright pixels smear along one direction and break into dust ----
    if (P.wind > 0) this.trails(P, w, h);

    // ---- dither ----
    const pal = this.palette(P);
    const tick = Math.floor(t * P.rate + 1e-6);
    dither({
      R, G, B, w, h, pal: pal.f, n: pal.n, out: this.idx,
      algo: P.algo, mode: P.mode, amount: P.amount, bias: P.bias, pscale: P.pscale, serp: P.serp,
      shimmer: P.shimmer, tick,
      dx: Math.round(tick * P.driftX), dy: Math.round(tick * P.driftY),
    });

    const idx = this.idx;
    // Outside the picture (letterbox, transparent PNG) is always backdrop.
    if (P.wind <= 0) for (let i = 0, j = 3; i < n; i++, j += 4) if (d[j] < 96) idx[i] = 0;

    if (P.sparkle > 0) {
      const top = pal.brightest;
      const p = P.sparkle * 0.12;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (idx[i] !== 0 && hash(x, y, tick * 7 + 3) < p) idx[i] = top;
        }
      }
    }

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

  palette(P) {
    const sig = P.pal.join(',');
    if (this.palSig === sig) return this.pal;
    const n = Math.min(64, P.pal.length);
    const f = new Float32Array(n * 3);
    const u8 = new Uint8Array(n * 3);
    let brightest = 0, bl = -1;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = hexToRgb(P.pal[i]);
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
    const key = P.shape + ':' + k + ':' + P.gap.toFixed(3);
    let c = this.patterns.get(key);
    if (!c) {
      c = canvas(k, k);
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      const g = Math.max(1, Math.round(k * P.gap));
      if (P.shape === 'gap') x.fillRect(0, 0, k - g, k - g);
      else if (P.shape === 'rows') x.fillRect(0, 0, k, k - g);
      else if (P.shape === 'cols') x.fillRect(0, 0, k - g, k);
      else if (P.shape === 'dot') {
        x.beginPath();
        x.arc(k / 2, k / 2, Math.max(0.6, (k / 2) * (1.08 - P.gap * 1.2)), 0, TAU);
        x.fill();
      } else if (P.shape === 'diamond') {
        const r = (k / 2) * (1.25 - P.gap);
        x.beginPath();
        x.moveTo(k / 2, k / 2 - r); x.lineTo(k / 2 + r, k / 2); x.lineTo(k / 2, k / 2 + r); x.lineTo(k / 2 - r, k / 2);
        x.closePath();
        x.fill();
      } else x.fillRect(0, 0, k, k);
      if (this.patterns.size > 40) this.patterns.clear();
      this.patterns.set(key, c);
    }
    return ctx.createPattern(c, 'repeat');
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
    lx.drawImage(this.pix, pad * k, pad * k, this.w * k, this.h * k);
    if (P.shape !== 'square' && k >= 3) {
      lx.globalCompositeOperation = 'destination-in';
      lx.fillStyle = this.shapePattern(lx, k, P);
      lx.fillRect(0, 0, W, H);
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
    return { W, H, pad };
  }
}
