// Characters as pixels: which character every cell shows, how it is drawn,
// and the picture written out as plain text, terminal colours or a web page.

import { hash, hexToRgb } from './util.js';

export const CHAR_SETS = [
  ['letters', 'Letters'], ['ascii', 'Classic'], ['blocks', 'Blocks'], ['braille', 'Braille'],
  ['lines', 'Line art'], ['binary', '0 and 1'], ['custom', 'My text'],
];

const SETS = {
  letters: '.,:;\'"-_~^=+*<>/\\|()[]{}!?%&$#@0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  ascii: '.:-=+*#%@',
  binary: '01',
};
const BLOCKS = ['░', '▒', '▓', '█'];
const LINES = ['.', ':', '|', '-', '/', '\\'];

/** A cell bright enough to turn into a solid block. */
export const HOT = 0xffff;

export const charsOn = (P) => !!P.chars && P.chars !== 'off';
export const charFont = (P, px) => `${P.charBold ? 700 : 500} ${px.toFixed(1)}px "SF Mono", ui-monospace, "Geist Mono", Menlo, monospace`;

const scratch = document.createElement('canvas');
function cellCanvas(k) {
  if (scratch.width !== k || scratch.height !== k) { scratch.width = k; scratch.height = k; }
  const x = scratch.getContext('2d', { willReadFrequently: true });
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, k, k);
  x.fillStyle = '#fff';
  return x;
}
function coverage(x, k) {
  const d = x.getImageData(0, 0, k, k).data;
  const t = new Uint8Array(k * k);
  for (let i = 0; i < t.length; i++) t[i] = d[i * 4 + 3];
  return t;
}

/** Coverage (0..255) of one typed character in a k x k cell. */
export function glyphTile(ch, k, P) {
  const x = cellCanvas(k);
  const fs = k * 0.8 * P.charSize;
  x.font = charFont(P, fs);
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  x.fillText(ch, k / 2, k / 2 + fs * 0.36);
  return coverage(x, k);
}

/** The four shades of the old PC character set: light, medium, dark, solid. */
export function blockTile(level, k) {
  const x = cellCanvas(k);
  if (level >= 3) { x.fillRect(0, 0, k, k); return coverage(x, k); }
  const u = Math.max(1, Math.round(k / 8));
  for (let y = 0, r = 0; y < k; y += u, r++) {
    for (let cx = 0, c = 0; cx < k; cx += u, c++) {
      const sparse = (c + 2 * (r & 1)) % 4 === 0;
      const on = level === 0 ? sparse : level === 1 ? (c + r) % 2 === 0 : !sparse;
      if (on) x.fillRect(cx, y, u, u);
    }
  }
  return coverage(x, k);
}

/** Braille: two columns of four dots. bits follows the Unicode order (dots 1-8). */
export function brailleTile(bits, k) {
  const x = cellCanvas(k);
  const r = Math.max(0.6, k * 0.085);
  const pos = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];
  x.beginPath();
  for (let i = 0; i < 8; i++) {
    if (!(bits & (1 << i))) continue;
    const cx = k * (0.3 + 0.4 * pos[i][0]), cy = k * (0.14 + 0.24 * pos[i][1]);
    x.moveTo(cx + r, cy);
    x.arc(cx, cy, r, 0, Math.PI * 2);
  }
  x.fill();
  return coverage(x, k);
}

/** The solid block a very bright cell turns into. */
export function hotTile(k) {
  const x = cellCanvas(k);
  const g = Math.max(0.5, k * 0.07), s = k - 2 * g, c = s * 0.22;
  x.beginPath();
  x.moveTo(g + c, g);
  x.lineTo(g + s - c, g); x.quadraticCurveTo(g + s, g, g + s, g + c);
  x.lineTo(g + s, g + s - c); x.quadraticCurveTo(g + s, g + s, g + s - c, g + s);
  x.lineTo(g + c, g + s); x.quadraticCurveTo(g, g + s, g, g + s - c);
  x.lineTo(g, g + c); x.quadraticCurveTo(g, g, g + c, g);
  x.fill();
  return coverage(x, k);
}

const graphemes = (s) => {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);
  return Array.from(s);
};

const inkCache = new Map();
function inkOf(ch, P) {
  const key = (P.charBold ? 'b' : 'r') + ch;
  let v = inkCache.get(key);
  if (v === undefined) {
    const t = glyphTile(ch, 24, { charBold: P.charBold, charSize: 1 });
    v = 0;
    for (let i = 0; i < t.length; i++) v += t[i];
    if (inkCache.size > 4000) inkCache.clear();
    inkCache.set(key, v);
  }
  return v;
}
/** Fonts arrive late; forget what was measured with the stand-in font. */
export function forgetInk() { inkCache.clear(); planSig = ''; }

let planSig = '';
let planOut = null;
/** mode: ramp | typed | braille | lines | blocks, and the characters in use. */
export function charPlan(P) {
  const sig = [P.chars, P.chars === 'custom' ? P.charText : '', P.charOrder, P.charBold].join('\u0001');
  if (sig === planSig) return planOut;
  let mode = 'ramp', list;
  if (P.chars === 'blocks') { mode = 'blocks'; list = BLOCKS; }
  else if (P.chars === 'braille') { mode = 'braille'; list = []; }
  else if (P.chars === 'lines') { mode = 'lines'; list = LINES; }
  else {
    const typedText = P.chars === 'custom' ? String(P.charText || '').trim() || 'NIGHTGRAIN' : '';
    if (typedText && P.charOrder === 'typed') {
      mode = 'typed';
      list = graphemes(typedText.replace(/\s+/g, ' ') + ' ');
    } else {
      const seen = new Set();
      list = [];
      for (const g of graphemes(typedText || SETS[P.chars] || SETS.ascii)) {
        if (!g.trim() || seen.has(g)) continue;
        seen.add(g);
        list.push(g);
      }
      if (!list.length) list = ['#'];
      // Lightest character first, so brightness walks up through them.
      list.sort((a, b) => inkOf(a, P) - inkOf(b, P));
    }
  }
  planSig = sig;
  planOut = { mode, list };
  return planOut;
}

// Which dots light up first. Four different orders, so neighbouring cells do not repeat.
const DOT_ORDERS = [
  [0, 4, 2, 6, 3, 1, 7, 5],
  [4, 1, 7, 2, 0, 5, 3, 6],
  [2, 3, 5, 0, 6, 4, 1, 7],
  [5, 0, 6, 3, 1, 7, 2, 4],
];

/**
 * Decide the character and the strength of every lit cell.
 * Fills E.cg (character index, or dot bits for braille, or HOT) and E.ca (0..255).
 */
export function charCells(E, P) {
  const { w, h, idx, lv } = E;
  const n = w * h;
  if (!E.cg || E.cg.length !== n) { E.cg = new Uint16Array(n); E.ca = new Uint8Array(n); }
  const cg = E.cg, ca = E.ca;
  const plan = charPlan(P);
  const N = plan.list.length;
  const hot = P.hotBlock ? Math.max(1, Math.round(P.hot * 255)) : 256;
  const top = Math.min(255, hot);
  const fade = P.charFade;
  const tick = E.tick | 0;
  const vary = P.charShuffle, flick = P.charFlicker;
  const mode = plan.mode;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!idx[i]) { ca[i] = 0; continue; }
      const l = lv[i];
      if (l >= hot) { cg[i] = HOT; ca[i] = 255; continue; }
      const ln = l / top;
      let a = 255 * (1 - fade * (1 - Math.pow(ln, 0.75)));
      // Characters change now and then, each cell at its own pace.
      let seed = 0;
      if (flick > 0) {
        const h1 = hash(x, y, 5);
        seed = Math.floor((tick + h1 * 97) / (1 + (1 - flick) * (1 + h1 * 24)));
      }
      let g = 0;
      if (mode === 'ramp' || mode === 'blocks') {
        let p = ln * (N - 1);
        if (vary > 0 && mode === 'ramp') p += (hash(x, y, 211 + seed) - 0.5) * vary * N * 0.6;
        g = p <= 0 ? 0 : p >= N - 1 ? N - 1 : Math.round(p);
      } else if (mode === 'typed') {
        g = i % N;
        if (plan.list[g] === ' ') a = 0;
      } else if (mode === 'braille') {
        const count = 1 + Math.min(7, Math.round(ln * 7));
        const order = DOT_ORDERS[(hash(x, y, 17 + seed) * 4) | 0];
        for (let d = 0; d < count; d++) g |= 1 << order[d];
      } else {
        // Line art: a stroke that follows the edge passing through the cell.
        const x0 = x > 0 ? x - 1 : x, x2 = x < w - 1 ? x + 1 : x;
        const r0 = (y > 0 ? y - 1 : y) * w, r1 = y * w, r2 = (y < h - 1 ? y + 1 : y) * w;
        const gx = lv[r0 + x2] + 2 * lv[r1 + x2] + lv[r2 + x2] - lv[r0 + x0] - 2 * lv[r1 + x0] - lv[r2 + x0];
        const gy = lv[r2 + x0] + 2 * lv[r2 + x] + lv[r2 + x2] - lv[r0 + x0] - 2 * lv[r0 + x] - lv[r0 + x2];
        const ax = Math.abs(gx), ay = Math.abs(gy);
        if (ax + ay > 150) {
          g = ax > ay * 2.4 ? 2 : ay > ax * 2.4 ? 3 : (gx > 0) === (gy > 0) ? 4 : 5;
          a = Math.max(a, 200);
        } else {
          g = ln > 0.55 ? 1 : 0;
          a *= 0.7;
        }
      }
      cg[i] = g;
      ca[i] = a < 22 ? (a <= 0 ? 0 : 22) : a > 255 ? 255 : a;
    }
  }
  return plan;
}

/** The character a cell holds, as text. */
export function glyphText(plan, g) {
  if (g === HOT) return '█';
  if (plan.mode === 'braille') return String.fromCharCode(0x2800 + g);
  return plan.list[g] || ' ';
}

// ---------- the picture as text ----------

const rgbOf = (u8, v) => [u8[v * 3], u8[v * 3 + 1], u8[v * 3 + 2]];
const mix = (bg, c, a) => [0, 1, 2].map((j) => Math.round(bg[j] + (c[j] - bg[j]) * a));

/**
 * One entry per character of the text version: { ch, rgb } or null for an empty place.
 * With characters on, rows are taken in pairs, because a letter is twice as tall as it is
 * wide. Without them, every 2 x 4 block of pixels becomes one braille character.
 */
function textGrid(E, P, square) {
  const { w, h, idx } = E;
  const pal = E.palette(P);
  const bg = hexToRgb(P.pal[0]);
  const rows = [];
  if (charsOn(P)) {
    const plan = charCells(E, P);
    const step = square ? 1 : 2;
    for (let y = 0; y < h; y += step) {
      const row = [];
      for (let x = 0; x < w; x++) {
        let i = y * w + x;
        if (step === 2 && y + 1 < h && E.ca[i + w] > E.ca[i]) i += w;
        if (!idx[i] || !E.ca[i]) { row.push(null); continue; }
        const ch = glyphText(plan, E.cg[i]);
        row.push(ch === ' ' ? null : { ch, rgb: mix(bg, rgbOf(pal.u8, idx[i]), E.ca[i] / 255) });
      }
      rows.push(row);
    }
    return { rows, bg, kind: 'chars' };
  }
  const bit = [[0, 3], [1, 4], [2, 5], [6, 7]];
  for (let y = 0; y < h; y += 4) {
    const row = [];
    for (let x = 0; x < w; x += 2) {
      let bits = 0, r = 0, g = 0, b = 0, c = 0;
      for (let dy = 0; dy < 4 && y + dy < h; dy++) {
        for (let dx = 0; dx < 2 && x + dx < w; dx++) {
          const v = idx[(y + dy) * w + x + dx];
          if (!v) continue;
          bits |= 1 << bit[dy][dx];
          r += pal.u8[v * 3]; g += pal.u8[v * 3 + 1]; b += pal.u8[v * 3 + 2]; c++;
        }
      }
      row.push(bits ? { ch: String.fromCharCode(0x2800 + bits), rgb: [Math.round(r / c), Math.round(g / c), Math.round(b / c)] } : null);
    }
    rows.push(row);
  }
  return { rows, bg, kind: 'braille' };
}

/** Plain text. An empty braille cell is written as the blank braille character so columns line up. */
export function asText(E, P) {
  const { rows, kind } = textGrid(E, P, false);
  const blank = kind === 'braille' || P.chars === 'braille' ? '⠀' : ' ';
  const lines = rows.map((row) => row.map((c) => (c ? c.ch : blank)).join('').replace(/[ ⠀]+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  return { text: lines.join('\n') + '\n', cols: rows[0] ? rows[0].length : 0, rows: lines.length };
}

/** Text with colour for a terminal (24-bit ANSI escape codes). */
export function asANSI(E, P) {
  const ESC = '\u001b[';
  const { w, h, idx } = E;
  const out = [];
  if (charsOn(P)) {
    const { rows, bg } = textGrid(E, P, false);
    for (const row of rows) {
      let line = `${ESC}48;2;${bg.join(';')}m`, last = '';
      for (const c of row) {
        if (!c) { line += ' '; continue; }
        const key = c.rgb.join(';');
        if (key !== last) { line += `${ESC}38;2;${key}m`; last = key; }
        line += c.ch;
      }
      out.push(line + `${ESC}0m`);
    }
    return { text: out.join('\n') + '\n', cols: rows[0] ? rows[0].length : 0, rows: rows.length };
  }
  // Pixels: each character is two of them, the upper half block over a coloured ground.
  const pal = E.palette(P);
  const bg = hexToRgb(P.pal[0]).join(';');
  const col = (v) => (v ? rgbOf(pal.u8, v).join(';') : bg);
  for (let y = 0; y < h; y += 2) {
    let line = '', lastF = '', lastB = '';
    for (let x = 0; x < w; x++) {
      const a = idx[y * w + x], b = y + 1 < h ? idx[(y + 1) * w + x] : 0;
      const f = col(a), g = col(b);
      if (g !== lastB) { line += `${ESC}48;2;${g}m`; lastB = g; }
      if (a === b) { line += ' '; continue; }
      if (f !== lastF) { line += `${ESC}38;2;${f}m`; lastF = f; }
      line += '▀';
    }
    out.push(line + `${ESC}0m`);
  }
  return { text: out.join('\n') + '\n', cols: w, rows: out.length };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** A web page: real, selectable text in colour. Cells are square, so nothing is stretched. */
export function asHTML(E, P) {
  const { w, h, idx } = E;
  const bgHex = hex(hexToRgb(P.pal[0]));
  const body = [];
  let lineHeight = '1ch';
  if (charsOn(P)) {
    const { rows } = textGrid(E, P, true);
    for (const row of rows) {
      let line = '', run = '', last = null;
      const flush = () => { if (run) line += last ? `<span style="color:${last}">${esc(run)}</span>` : run; run = ''; };
      for (const c of row) {
        const key = c ? hex(c.rgb) : null;
        if (key !== last) { flush(); last = key; }
        run += c ? c.ch : ' ';
      }
      flush();
      body.push(line);
    }
  } else {
    // Pixels: two spaces on a coloured ground make one square.
    const pal = E.palette(P);
    lineHeight = '2ch';
    for (let y = 0; y < h; y++) {
      let line = '', x = 0;
      while (x < w) {
        const v = idx[y * w + x];
        let n = 1;
        while (x + n < w && idx[y * w + x + n] === v) n++;
        const sp = '  '.repeat(n);
        line += v ? `<span style="background:${hex(rgbOf(pal.u8, v))}">${sp}</span>` : sp;
        x += n;
      }
      body.push(line);
    }
  }
  const text = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Made with Nightgrain</title>\n'
    + `<style>html{background:${bgHex}}body{margin:0;display:grid;place-items:center;min-height:100vh}`
    + `pre{margin:0;padding:2ch;font:${P.charBold ? 700 : 500} 10px/${lineHeight} "SF Mono",ui-monospace,Menlo,Consolas,monospace;line-height:${lineHeight};color:#fff;white-space:pre}</style>\n</head>\n<body>\n<pre>`
    + body.join('\n') + '</pre>\n</body>\n</html>\n';
  return { text, cols: w, rows: body.length };
}
