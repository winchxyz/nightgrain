// The maker's tag: a small, faint mark in the bottom right corner of every picture.

import { hexToRgb, luma } from './util.js';

export const TAG = '@winchxyz';

// Five rows per glyph, drawn as pixels like everything else.
const GLYPHS = {
  '@': ['.###.', '#.#.#', '#.###', '#....', '.###.'],
  w: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  i: ['###', '.#.', '.#.', '.#.', '###'],
  n: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  c: ['.##', '#..', '#..', '#..', '.##'],
  h: ['#.#', '#.#', '###', '#.#', '#.#'],
  x: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  z: ['###', '..#', '.#.', '#..', '###'],
};
const ROWS = 5;

// Horizontal runs of lit tag pixels, in tag units: [x, y, length].
const RUNS = [];
let COLS = 0;
for (const ch of TAG) {
  const g = GLYPHS[ch];
  if (!g) continue;
  for (let y = 0; y < ROWS; y++) {
    let x = 0;
    while (x < g[y].length) {
      if (g[y][x] !== '#') { x++; continue; }
      let n = 1;
      while (g[y][x + n] === '#') n++;
      RUNS.push([COLS + x, y, n]);
      x += n;
    }
  }
  COLS += g[0].length + 1;
}
COLS -= 1;

/** Where the tag sits in a picture of W by H: unit size and top left corner. */
export function tagPlace(W, H, whole = true) {
  const side = Math.min(W, H);
  let u = side / 420;
  if (whole) u = Math.max(1, Math.round(u));
  // A picture too small to hold the tag is left alone.
  if (COLS * u > W * 0.6 || ROWS * u > H * 0.3) return null;
  const m = Math.max(2 * u, side * 0.02);
  const x = W - m - COLS * u, y = H - m - ROWS * u;
  return { u, x: whole ? Math.round(x) : x, y: whole ? Math.round(y) : y };
}

/** What lies under the tag: the average colour of those cells and how uneven they are. */
export function tagUnder(engine, P, k) {
  const { pad, W, H } = engine.outSize(P, k);
  const p = tagPlace(W, H);
  if (!p) return null;
  const u8 = engine.palette(P).u8;
  const { w, h, idx } = engine;
  const x0 = Math.floor(p.x / k) - pad, x1 = Math.ceil((p.x + COLS * p.u) / k) - pad;
  const y0 = Math.floor(p.y / k) - pad, y1 = Math.ceil((p.y + ROWS * p.u) / k) - pad;
  let r = 0, g = 0, b = 0, n = 0, s1 = 0, s2 = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = x >= 0 && x < w && y >= 0 && y < h ? idx[y * w + x] * 3 : 0;
      const l = luma(u8[v], u8[v + 1], u8[v + 2]);
      r += u8[v]; g += u8[v + 1]; b += u8[v + 2];
      s1 += l; s2 += l * l; n++;
    }
  }
  if (!n) return null;
  const mean = s1 / n;
  return { rgb: [r / n, g / n, b / n], spread: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

/** Light on dark ground, dark on light ground; a little stronger where the ground is busy. Always faint. */
export function tagInk(under) {
  const [r, g, b] = under.rgb;
  const light = luma(r, g, b) > 140;
  const a = (light ? 0.06 : 0.075) + Math.min(0.06, (under.spread || 0) / 900);
  return { rgb: light ? [0, 0, 0] : [255, 255, 255], a: +a.toFixed(3) };
}

const flat = (bgHex) => ({ rgb: hexToRgb(bgHex), spread: 0 });

/** Draw the tag on a finished canvas. `under` comes from tagUnder; without it the background colour decides. */
export function paintTag(ctx, W, H, bgHex, under) {
  const p = tagPlace(W, H);
  if (!p) return;
  const ink = tagInk(under || flat(bgHex));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.globalAlpha = ink.a;
  ctx.fillStyle = `rgb(${ink.rgb.join(',')})`;
  for (const [x, y, n] of RUNS) ctx.fillRect(p.x + x * p.u, p.y + y * p.u, n * p.u, p.u);
  ctx.restore();
}

/** The tag's colour once it lies on its ground, as r, g, b. */
export function tagColour(bgHex, under) {
  const u = under || flat(bgHex);
  const ink = tagInk(u);
  return u.rgb.map((v, i) => Math.round(v + (ink.rgb[i] - v) * ink.a));
}

/** Write the tag into a frame of palette indices. */
export function stampTag(out, W, H, value) {
  const p = tagPlace(W, H);
  if (!p) return;
  for (const [x, y, n] of RUNS) {
    const x0 = p.x + x * p.u, x1 = x0 + n * p.u;
    for (let r = 0; r < p.u; r++) out.fill(value, (p.y + y * p.u + r) * W + x0, (p.y + y * p.u + r) * W + x1);
  }
}

/** The tag as one SVG path, in the picture's own units. */
export function tagSVG(W, H, bgHex) {
  const p = tagPlace(W, H, false);
  if (!p) return '';
  const ink = tagInk(flat(bgHex));
  const f = (v) => +v.toFixed(3);
  let d = '';
  for (const [x, y, n] of RUNS) d += `M${f(p.x + x * p.u)} ${f(p.y + y * p.u)}h${f(n * p.u)}v${f(p.u)}h${f(-n * p.u)}z`;
  return `<path fill="${ink.rgb[0] ? '#fff' : '#000'}" fill-opacity="${ink.a}" d="${d}"/>`;
}
