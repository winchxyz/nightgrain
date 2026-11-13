// Dithering core: threshold maps, palette mixing, error diffusion.
// Everything works on float RGB planes (0..1) and writes palette indices.

import { hash, mulberry32 } from './util.js';

export const ALGOS = [
  { id: 'bayer8', name: 'Bayer 8', group: 'Ordered', hint: 'The classic fine crosshatch grid. Closest to the reference look.' },
  { id: 'bayer4', name: 'Bayer 4', group: 'Ordered', hint: 'A coarser, more visible grid pattern.' },
  { id: 'bayer2', name: 'Bayer 2', group: 'Ordered', hint: 'Chunky checkerboard mixing, very retro.' },
  { id: 'bayer16', name: 'Bayer 16', group: 'Ordered', hint: 'The smoothest ordered grid, with the most tone steps.' },
  { id: 'blue', name: 'Blue noise', group: 'Ordered', hint: 'Evenly scattered grain with no visible pattern.' },
  { id: 'white', name: 'Static', group: 'Ordered', hint: 'Rough random grain, like TV static.' },
  { id: 'cluster', name: 'Halftone', group: 'Ordered', hint: 'Round print dots that grow with brightness.' },
  { id: 'linesh', name: 'Lines', group: 'Ordered', hint: 'Horizontal engraving lines.' },
  { id: 'linesd', name: 'Diagonal', group: 'Ordered', hint: 'Diagonal engraving lines.' },
  { id: 'cross', name: 'Crosshatch', group: 'Ordered', hint: 'Woven horizontal and vertical lines.' },
  { id: 'floyd', name: 'Floyd-Steinberg', group: 'Diffusion', hint: 'Organic, detailed grain. The standard error diffusion.' },
  { id: 'atkinson', name: 'Atkinson', group: 'Diffusion', hint: 'Crisp and contrasty, the early Macintosh look.' },
  { id: 'stucki', name: 'Stucki', group: 'Diffusion', hint: 'Smooth, clean diffusion with fine detail.' },
  { id: 'jjn', name: 'Jarvis', group: 'Diffusion', hint: 'Soft diffusion with a wide spread.' },
  { id: 'burkes', name: 'Burkes', group: 'Diffusion', hint: 'Fast, slightly streaky diffusion.' },
  { id: 'sierra', name: 'Sierra', group: 'Diffusion', hint: 'Balanced diffusion between Floyd and Jarvis.' },
  { id: 'sierralite', name: 'Sierra Lite', group: 'Diffusion', hint: 'Light diffusion with a tight, wormy texture.' },
  { id: 'none', name: 'None', group: 'Flat', hint: 'No dithering: each pixel snaps to the nearest colour.' },
];

const KERNELS = {
  floyd: { d: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { d: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  jjn: { d: 48, k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
  stucki: { d: 42, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
  burkes: { d: 32, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
  sierra: { d: 32, k: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] },
  sierralite: { d: 4, k: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
};

// Flat typed copies of the taps for the inner loops.
for (const id in KERNELS) {
  const k = KERNELS[id];
  k.dx = Int8Array.from(k.k, (t) => t[0]);
  k.dy = Int8Array.from(k.k, (t) => t[1]);
  k.wt = Float32Array.from(k.k, (t) => t[2] / k.d);
}

export const isDiffusion = (algo) => algo in KERNELS;

// ---------- threshold maps (all sizes are powers of two) ----------

function bayer(size) {
  let m = [0];
  let n = 1;
  while (n < size) {
    const next = new Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y * n + x] * 4;
        next[y * (n * 2) + x] = v;
        next[y * (n * 2) + x + n] = v + 2;
        next[(y + n) * (n * 2) + x] = v + 3;
        next[(y + n) * (n * 2) + x + n] = v + 1;
      }
    }
    m = next;
    n *= 2;
  }
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = (m[i] + 0.5) / out.length;
  return out;
}

// Turn any score field into evenly spread thresholds by ranking it.
function ranked(size, score) {
  const n = size * size;
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => score[a] - score[b]);
  const out = new Float32Array(n);
  for (let r = 0; r < n; r++) out[order[r]] = (r + 0.5) / n;
  return out;
}

function blueNoise(size) {
  // Progressive void filling: each new point goes to the emptiest spot.
  const n = size * size;
  const energy = new Float32Array(n);
  const rnd = mulberry32(1337);
  for (let i = 0; i < n; i++) energy[i] = rnd() * 1e-4;
  const used = new Uint8Array(n);
  const out = new Float32Array(n);
  const R = 6;
  const sigma2 = 2 * 1.9 * 1.9;
  const kern = new Float32Array((2 * R + 1) * (2 * R + 1));
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) kern[(dy + R) * (2 * R + 1) + dx + R] = Math.exp(-(dx * dx + dy * dy) / sigma2);
  }
  const mask = size - 1;
  for (let k = 0; k < n; k++) {
    let best = 0;
    let bv = Infinity;
    for (let i = 0; i < n; i++) {
      if (!used[i] && energy[i] < bv) {
        bv = energy[i];
        best = i;
      }
    }
    used[best] = 1;
    out[best] = (k + 0.5) / n;
    const bx = best & mask;
    const by = (best / size) | 0;
    for (let dy = -R; dy <= R; dy++) {
      const yy = ((by + dy) & mask) * size;
      for (let dx = -R; dx <= R; dx++) energy[yy + ((bx + dx) & mask)] += kern[(dy + R) * (2 * R + 1) + dx + R];
    }
  }
  return out;
}

const maps = {};
export function thresholdMap(algo) {
  if (maps[algo]) return maps[algo];
  let size = 8;
  let data;
  const b8 = () => thresholdMap('bayer8').data;
  if (algo === 'bayer2') { size = 2; data = bayer(2); }
  else if (algo === 'bayer4') { size = 4; data = bayer(4); }
  else if (algo === 'bayer16') { size = 16; data = bayer(16); }
  else if (algo === 'blue') { size = 64; data = blueNoise(64); }
  else if (algo === 'white') {
    size = 128;
    data = new Float32Array(size * size);
    const rnd = mulberry32(99);
    for (let i = 0; i < data.length; i++) data[i] = rnd();
  } else if (algo === 'cluster') {
    const s = new Float32Array(64);
    const fine = b8();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        s[y * 8 + x] = -(Math.cos(((x + 0.5) / 8) * Math.PI * 2) + Math.cos(((y + 0.5) / 8) * Math.PI * 2)) + fine[y * 8 + x] * 0.01;
      }
    }
    data = ranked(8, s);
  } else if (algo === 'linesh' || algo === 'linesd' || algo === 'cross') {
    const line = [0, 2, 1, 3];
    const s = new Float32Array(64);
    const fine = b8();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        let v;
        if (algo === 'linesh') v = line[y & 3];
        else if (algo === 'linesd') v = line[(x + y) & 3];
        else v = Math.min(line[y & 3], line[x & 3]) * 2 + Math.max(line[y & 3], line[x & 3]) * 0.5;
        s[y * 8 + x] = v + fine[y * 8 + x] * 0.9;
      }
    }
    data = ranked(8, s);
  } else {
    size = 8;
    data = bayer(8);
  }
  maps[algo] = { size, data };
  return maps[algo];
}

// ---------- palette mixing cache (pattern dithering after Thomas Knoll) ----------
// For a colour, build N palette picks whose average approximates it, sorted by
// brightness. A threshold then selects one pick, so an ordered pattern can mix
// several palette colours (grey steel becomes blue + orange + green dots).

const N = 64;
const WR = 0.35, WG = 0.45, WB = 0.2;
const QL = new Uint8Array(1024);
for (let i = 0; i < 1024; i++) QL[i] = Math.round(31 * Math.sqrt(i / 1023));
const QV = new Float32Array(32);
for (let i = 0; i < 32; i++) QV[i] = (i / 31) * (i / 31);

let mix = null;
function mixCache(pal, n, amount) {
  let sig = n + '|' + amount.toFixed(3);
  for (let i = 0; i < n * 3; i++) sig += '|' + pal[i].toFixed(4);
  if (mix && mix.sig === sig) return mix;
  const lum = [];
  for (let i = 0; i < n; i++) lum.push(0.299 * pal[i * 3] + 0.587 * pal[i * 3 + 1] + 0.114 * pal[i * 3 + 2]);
  const order = lum.map((_, i) => i).sort((a, b) => lum[a] - lum[b]);
  mix = { sig, n, amount, pal: Float32Array.from(pal), order, have: new Uint8Array(32768), cand: new Uint8Array(32768 * N), cnt: new Uint16Array(n) };
  return mix;
}

function fillKey(m, key) {
  const { pal, n, amount, cnt, order, cand } = m;
  const cr = QV[key >> 10], cg = QV[(key >> 5) & 31], cb = QV[key & 31];
  cnt.fill(0);
  let er = 0, eg = 0, eb = 0;
  for (let i = 0; i < N; i++) {
    const tr = cr + er * amount, tg = cg + eg * amount, tb = cb + eb * amount;
    let best = 0, bd = Infinity;
    for (let j = 0; j < n; j++) {
      const dr = tr - pal[j * 3], dg = tg - pal[j * 3 + 1], db = tb - pal[j * 3 + 2];
      const d = WR * dr * dr + WG * dg * dg + WB * db * db;
      if (d < bd) { bd = d; best = j; }
    }
    cnt[best]++;
    er += cr - pal[best * 3];
    eg += cg - pal[best * 3 + 1];
    eb += cb - pal[best * 3 + 2];
  }
  let p = key * N;
  for (let o = 0; o < n; o++) {
    const j = order[o];
    for (let c = cnt[j]; c > 0; c--) cand[p++] = j;
  }
  m.have[key] = 1;
}

function nearest(pal, n, r, g, b) {
  let best = 0, bd = Infinity;
  for (let j = 0; j < n; j++) {
    const dr = r - pal[j * 3], dg = g - pal[j * 3 + 1], db = b - pal[j * 3 + 2];
    const d = WR * dr * dr + WG * dg * dg + WB * db * db;
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

/**
 * o: { R, G, B: Float32Array (scratch, may be modified), w, h,
 *      pal: Float32Array(n*3) 0..1, n, out: Uint8Array,
 *      algo, mode: 'match' | 'ramp', amount 0..1, bias -0.5..0.5,
 *      pscale 1..6, serp bool, shimmer 0..1, tick int, dx, dy int }
 */
export function dither(o) {
  const { R, G, B, w, h, pal, n, out, algo, mode } = o;
  const amount = o.amount;
  const bias = o.bias;
  const shim = o.shimmer;
  const tick = o.tick | 0;
  const total = w * h;

  if (n < 2) { out.fill(0, 0, total); return; }

  if (algo === 'none') {
    if (mode === 'ramp') {
      for (let i = 0; i < total; i++) {
        let v = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i] + bias * 0.5;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        out[i] = Math.round(v * (n - 1));
      }
    } else {
      for (let i = 0; i < total; i++) out[i] = nearest(pal, n, R[i] + bias * 0.3, G[i] + bias * 0.3, B[i] + bias * 0.3);
    }
    return;
  }

  const kern = KERNELS[algo];
  if (kern) {
    const tdx = kern.dx, tdy = kern.dy, twt = kern.wt;
    const nt = tdx.length;
    const noiseAmp = shim * 0.6;
    if (mode === 'ramp') {
      const V = R;
      for (let i = 0; i < total; i++) {
        let v = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i] + bias * 0.5;
        V[i] = (v < 0 ? 0 : v > 1 ? 1 : v) * (n - 1);
      }
      for (let y = 0; y < h; y++) {
        const ltr = !o.serp || (y & 1) === 0;
        for (let xi = 0; xi < w; xi++) {
          const x = ltr ? xi : w - 1 - xi;
          const i = y * w + x;
          let v = V[i];
          if (noiseAmp > 0 && v > 0.02) v += (hash(x, y, tick) - 0.5) * noiseAmp;
          let q = Math.round(v);
          q = q < 0 ? 0 : q > n - 1 ? n - 1 : q;
          out[i] = q;
          const e = (v - q) * amount;
          if (e !== 0) {
            for (let t = 0; t < nt; t++) {
              const xx = ltr ? x + tdx[t] : x - tdx[t];
              const yy = y + tdy[t];
              if (xx >= 0 && xx < w && yy < h) V[yy * w + xx] += e * twt[t];
            }
          }
        }
      }
      return;
    }
    const b3 = bias * 0.3;
    for (let y = 0; y < h; y++) {
      const ltr = !o.serp || (y & 1) === 0;
      for (let xi = 0; xi < w; xi++) {
        const x = ltr ? xi : w - 1 - xi;
        const i = y * w + x;
        let r = R[i] + b3, g = G[i] + b3, b = B[i] + b3;
        if (noiseAmp > 0 && r + g + b > 0.03) {
          const nz = (hash(x, y, tick) - 0.5) * noiseAmp;
          r += nz; g += nz; b += nz;
        }
        r = r < -0.4 ? -0.4 : r > 1.4 ? 1.4 : r;
        g = g < -0.4 ? -0.4 : g > 1.4 ? 1.4 : g;
        b = b < -0.4 ? -0.4 : b > 1.4 ? 1.4 : b;
        const j = nearest(pal, n, r, g, b);
        out[i] = j;
        const er = (r - pal[j * 3]) * amount;
        const eg = (g - pal[j * 3 + 1]) * amount;
        const eb = (b - pal[j * 3 + 2]) * amount;
        if (er !== 0 || eg !== 0 || eb !== 0) {
          for (let t = 0; t < nt; t++) {
            const xx = ltr ? x + tdx[t] : x - tdx[t];
            const yy = y + tdy[t];
            if (xx >= 0 && xx < w && yy < h) {
              const ii = yy * w + xx;
              const wt = twt[t];
              R[ii] += er * wt; G[ii] += eg * wt; B[ii] += eb * wt;
            }
          }
        }
      }
    }
    return;
  }

  // Ordered (threshold map) dithering.
  const tm = thresholdMap(algo);
  const size = tm.size;
  const mask = size - 1;
  const T = tm.data;
  const ps = Math.max(1, o.pscale | 0);
  const ox = (((o.dx | 0) % (size * ps)) + size * ps) % (size * ps);
  const oy = (((o.dy | 0) % (size * ps)) + size * ps) % (size * ps);

  if (mode === 'ramp') {
    for (let y = 0; y < h; y++) {
      const row = ((((y + oy) / ps) | 0) & mask) * size;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i] + bias * 0.5;
        v = (v < 0 ? 0 : v > 1 ? 1 : v) * (n - 1);
        const i0 = v | 0;
        const f = v - i0;
        let t = 0.5 + (T[row + ((((x + ox) / ps) | 0) & mask)] - 0.5) * amount;
        if (shim > 0) t += (hash(x, y, tick) - 0.5) * shim;
        if (t < 0.004) t = 0.004;
        out[i] = f > t && i0 < n - 1 ? i0 + 1 : i0;
      }
    }
    return;
  }

  const m = mixCache(pal, n, amount);
  const have = m.have;
  const cand = m.cand;
  const b2 = bias;
  for (let y = 0; y < h; y++) {
    const row = ((((y + oy) / ps) | 0) & mask) * size;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = R[i], g = G[i], b = B[i];
      const key = (QL[r <= 0 ? 0 : r >= 1 ? 1023 : (r * 1023) | 0] << 10) | (QL[g <= 0 ? 0 : g >= 1 ? 1023 : (g * 1023) | 0] << 5) | QL[b <= 0 ? 0 : b >= 1 ? 1023 : (b * 1023) | 0];
      if (key === 0 && b2 <= 0) { out[i] = m.order[0] === 0 ? 0 : nearest(pal, n, 0, 0, 0); continue; }
      if (!have[key]) fillKey(m, key);
      let t = T[row + ((((x + ox) / ps) | 0) & mask)] + b2;
      if (shim > 0) t += (hash(x, y, tick) - 0.5) * shim;
      let k = (t * N) | 0;
      k = k < 0 ? 0 : k > N - 1 ? N - 1 : k;
      out[i] = cand[key * N + k];
    }
  }
}
