// More ways to save: animated PNG, SVG, sprite sheet, Telegram sticker, and a ZIP for batches.

import { Engine, paintShape, isShaped, livePalette } from './engine.js';
import { exportScale } from './export.js';
import { sleep } from './util.js';
import { encodeSticker, STICKER_LIMIT } from './sticker.js';

const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image.'))), type, q));

function frameCount(app) {
  return Math.max(1, Math.min(900, Math.round(app.loopLen() * app.P.fps)));
}

// ---------- CRC32 (PNG chunks and ZIP entries) ----------

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return crc;
}

// ---------- ZIP without compression (the files inside are compressed already) ----------

export function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = (crc32(f.data) ^ 0xffffffff) >>> 0;
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);
    head.setUint16(8, 0, true);
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, f.data.length, true);
    head.setUint32(22, f.data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    parts.push(new Uint8Array(head.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ---------- animated PNG ----------

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

function pngParts(bytes) {
  // Returns the IHDR data and every IDAT payload of a PNG file.
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, ihdr = null;
  const idat = [];
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  return { ihdr, idat };
}

export async function exportAPNG(app, onProgress, signal) {
  const P = app.P;
  const engine = app.engine;
  const L = app.loopLen();
  const frames = frameCount(app);
  await app.renderAt(0);
  const k = exportScale(P, engine);
  const { W, H } = engine.outSize(P, k);
  if (W * H * frames > 400e6) throw new Error('That animation would be enormous. Pick a smaller size, a lower frame rate or a shorter loop.');
  const canvas = document.createElement('canvas');
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  let seq = 0, head = null;
  const u32 = (dv, o, v) => dv.setUint32(o, v);
  for (let f = 0; f < frames; f++) {
    if (signal.cancelled) return null;
    await app.renderAt((f / frames) * L);
    engine.compose(canvas, k, app.live(), { transparent: P.transparent });
    const bytes = new Uint8Array(await (await toBlob(canvas, 'image/png')).arrayBuffer());
    const { ihdr, idat } = pngParts(bytes);
    if (!ihdr || !idat.length) throw new Error('This browser produced a PNG that could not be read back.');
    if (f === 0) {
      head = Array.from(ihdr).join(',');
      chunks.push(pngChunk('IHDR', ihdr));
      const ac = new DataView(new ArrayBuffer(8));
      u32(ac, 0, frames);
      u32(ac, 4, 0);
      chunks.push(pngChunk('acTL', new Uint8Array(ac.buffer)));
    } else if (Array.from(ihdr).join(',') !== head) throw new Error('The frames came out in different formats, so they cannot be joined.');
    const fc = new DataView(new ArrayBuffer(26));
    u32(fc, 0, seq++);
    u32(fc, 4, W);
    u32(fc, 8, H);
    fc.setUint16(20, 1);
    fc.setUint16(22, P.fps);
    chunks.push(pngChunk('fcTL', new Uint8Array(fc.buffer)));
    for (const part of idat) {
      if (f === 0) chunks.push(pngChunk('IDAT', part));
      else {
        const fd = new Uint8Array(4 + part.length);
        new DataView(fd.buffer).setUint32(0, seq++);
        fd.set(part, 4);
        chunks.push(pngChunk('fdAT', fd));
      }
    }
    onProgress((f + 1) / frames, `Frame ${f + 1} of ${frames}`);
    if (f % 2 === 1) await sleep(0);
  }
  chunks.push(pngChunk('IEND', new Uint8Array(0)));
  return { blob: new Blob(chunks, { type: 'image/apng' }), w: W, h: H, frames, ext: 'png' };
}

// ---------- sprite sheet ----------

export async function exportSheet(app, onProgress, signal) {
  const P = app.P;
  const engine = app.engine;
  const L = app.loopLen();
  const frames = Math.min(frameCount(app), 400);
  await app.renderAt(0);
  const cols = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);
  let k = exportScale(P, engine);
  let size = engine.outSize(P, k);
  while (k > 1 && (size.W * cols > 8192 || size.H * rows > 8192)) { k--; size = engine.outSize(P, k); }
  if (size.W * cols > 16384 || size.H * rows > 16384) throw new Error('Too many frames for one sheet. Lower the frame rate, the resolution or the loop length.');
  const sheet = document.createElement('canvas');
  sheet.width = size.W * cols;
  sheet.height = size.H * rows;
  const sx = sheet.getContext('2d');
  const cell = document.createElement('canvas');
  for (let f = 0; f < frames; f++) {
    if (signal.cancelled) return null;
    await app.renderAt((f / frames) * L);
    engine.compose(cell, k, app.live(), { transparent: P.transparent });
    sx.drawImage(cell, (f % cols) * size.W, Math.floor(f / cols) * size.H);
    onProgress((f + 1) / frames, `Frame ${f + 1} of ${frames}`);
    if (f % 4 === 3) await sleep(0);
  }
  return { blob: await toBlob(sheet, 'image/png'), w: sheet.width, h: sheet.height, frames, cols, rows, cellW: size.W, cellH: size.H, ext: 'png' };
}

// ---------- Telegram video sticker: WebM, 512 px, up to 3 s, up to 256 KB ----------

export async function exportSticker(app, onProgress, signal) {
  // Frame by frame where the browser can; recording the screen in real time otherwise.
  const exact = await encodeSticker(app, onProgress, signal);
  if (exact !== undefined) return exact;
  const P = app.P;
  const engine = app.engine;
  const L = app.loopLen();
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('This browser cannot record WebM video, which stickers need.');
  await app.renderAt(0);
  const cells = engine.outSize(P, 1);
  const k = Math.max(1, Math.round(512 / Math.max(cells.W, cells.H)));
  const art = document.createElement('canvas');
  const out = document.createElement('canvas');
  const f512 = 512 / Math.max(cells.W, cells.H);
  out.width = Math.max(2, Math.round(cells.W * f512));
  out.height = Math.max(2, Math.round(cells.H * f512));
  const ox = out.getContext('2d');
  const paintFrame = async (tt) => {
    await app.renderAt(tt);
    engine.compose(art, k, app.live(), { transparent: true });
    ox.clearRect(0, 0, out.width, out.height);
    ox.imageSmoothingEnabled = art.width !== out.width;
    ox.imageSmoothingQuality = 'high';
    ox.drawImage(art, 0, 0, out.width, out.height);
  };
  const seconds = Math.min(2.9, L);
  const LIMIT = STICKER_LIMIT;
  let blob = null;
  const rates = [560e3, 380e3, 240e3, 150e3];
  // A recorder drops its first frames while the encoder starts up. Run a short recording
  // and throw it away, so the real one starts on the first frame.
  {
    await paintFrame(0);
    const stream = out.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: rates[0] });
    let got = 0;
    rec.ondataavailable = (e) => { got += e.data.size; };
    const stopped = new Promise((res) => (rec.onstop = res));
    rec.start(100);
    const t0 = performance.now();
    while (got < 2000 && performance.now() - t0 < 4000 && !signal.cancelled) {
      await paintFrame(((performance.now() - t0) / 1000) % L);
      onProgress(0, 'Getting ready');
      await new Promise((r) => requestAnimationFrame(r));
    }
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    if (signal.cancelled) return null;
  }
  for (let attempt = 0; attempt < rates.length; attempt++) {
    await paintFrame(0);
    const stream = out.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: rates[attempt] });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((res) => (rec.onstop = res));
    rec.start();
    const t0 = performance.now();
    for (;;) {
      const el = (performance.now() - t0) / 1000;
      if (el >= seconds || signal.cancelled) break;
      // A loop longer than three seconds is played faster to fit.
      await paintFrame((el / seconds) * L);
      onProgress(el / seconds, attempt ? 'Recording again, smaller' : 'Recording');
      await new Promise((r) => requestAnimationFrame(r));
    }
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    if (signal.cancelled) return null;
    blob = new Blob(chunks, { type: 'video/webm' });
    if (blob.size <= LIMIT) break;
  }
  return { blob, w: out.width, h: out.height, seconds, fits: blob.size <= LIMIT, ext: 'webm' };
}

// ---------- SVG ----------

/** Stands in for a canvas context and writes down the paths a shape draws. */
class PathRecorder {
  constructor() {
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.d = '';
    this.out = [];
    this.globalCompositeOperation = 'source-over';
  }
  pt(x, y) {
    const m = this.m;
    return (m[0] * x + m[2] * y + m[4]).toFixed(2) + ' ' + (m[1] * x + m[3] * y + m[5]).toFixed(2);
  }
  save() { this.stack.push({ m: [...this.m], op: this.globalCompositeOperation }); }
  restore() { const s = this.stack.pop(); if (s) { this.m = s.m; this.globalCompositeOperation = s.op; } }
  translate(x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
  rotate(a) {
    const m = this.m, c = Math.cos(a), s = Math.sin(a);
    this.m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[2] * c - m[0] * s, m[3] * c - m[1] * s, m[4], m[5]];
  }
  beginPath() { this.d = ''; }
  moveTo(x, y) { this.d += 'M' + this.pt(x, y); }
  lineTo(x, y) { this.d += 'L' + this.pt(x, y); }
  quadraticCurveTo(a, b, x, y) { this.d += 'Q' + this.pt(a, b) + ' ' + this.pt(x, y); }
  bezierCurveTo(a, b, c, d, x, y) { this.d += 'C' + this.pt(a, b) + ' ' + this.pt(c, d) + ' ' + this.pt(x, y); }
  closePath() { this.d += 'Z'; }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  arc(cx, cy, r) {
    // Only whole circles are ever drawn; rotation leaves them circles.
    const rr = r.toFixed(2);
    this.d += 'M' + this.pt(cx + r, cy) + 'A' + rr + ' ' + rr + ' 0 1 0 ' + this.pt(cx - r, cy) + 'A' + rr + ' ' + rr + ' 0 1 0 ' + this.pt(cx + r, cy) + 'Z';
  }
  clip() { this.d = ''; }
  fill(rule) {
    if (this.d) this.out.push({ d: this.d, rule: rule === 'evenodd' ? 'evenodd' : 'nonzero', cut: this.globalCompositeOperation === 'destination-out' });
  }
  fillRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.fill(); }
  drawImage() {}
}

function symbolFor(id, shape, P, scale) {
  const rec = new PathRecorder();
  paintShape(rec, shape === 'custom' ? 'square' : shape, 100, P.gap, P.shapeRot, scale);
  const solid = rec.out.filter((p) => !p.cut);
  const cuts = rec.out.filter((p) => p.cut);
  const path = (p, extra = '') => `<path d="${p.d}"${p.rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${extra}/>`;
  if (!cuts.length) return `<symbol id="${id}" viewBox="0 0 100 100">${solid.map((p) => path(p)).join('')}</symbol>`;
  return `<mask id="${id}m">${solid.map((p) => path(p, ' fill="#fff"')).join('')}${cuts.map((p) => path(p, ' fill="#000"')).join('')}</mask>`
    + `<symbol id="${id}" viewBox="0 0 100 100"><rect width="100" height="100" mask="url(#${id}m)"/></symbol>`;
}

/** The frame you see as vector shapes. Glow, scanlines and colour fringe are left out. */
export async function exportSVG(app) {
  const P = app.P;
  const engine = app.engine;
  await app.renderAt(app.time());
  const Pe = app.live();
  const { w, h, idx } = engine;
  const { pad } = engine.outSize(Pe, 1);
  const W = w + 2 * pad, H = h + 2 * pad;
  const cols = livePalette(Pe);
  const size = P.exSize || 1024;
  const sc = size / Math.max(W, H);
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W * sc)}" height="${Math.round(H * sc)}">`;
  const parts = [head, '<title>Made with Nightgrain</title>'];
  if (!P.transparent) parts.push(`<rect width="${W}" height="${H}" fill="${cols[0]}"/>`);
  if (!isShaped(Pe)) {
    // Plain squares: one path per colour, with runs of pixels joined into bars.
    const d = cols.map(() => '');
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const v = idx[y * w + x];
        if (!v) { x++; continue; }
        let n = 1;
        while (x + n < w && idx[y * w + x + n] === v) n++;
        d[v] += `M${x + pad} ${y + pad}h${n}v1h${-n}z`;
        x += n;
      }
    }
    parts.push('<g shape-rendering="crispEdges">');
    for (let i = 1; i < cols.length; i++) if (d[i]) parts.push(`<path fill="${cols[i]}" d="${d[i]}"/>`);
    parts.push('</g>');
  } else {
    const plan = engine.shapePlan(Pe);
    const ids = new Map();
    const defs = [];
    const uses = cols.map(() => '');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = idx[y * w + x];
        if (!v || v >= plan.n) continue;
        const shape = plan.shapes[v * plan.slots + (plan.random ? Engine.slotOf(x, y, plan.slots) : 0)];
        const key = shape + '|' + plan.scale[v];
        let id = ids.get(key);
        if (!id) {
          id = 's' + ids.size;
          ids.set(key, id);
          defs.push(symbolFor(id, shape, Pe, plan.scale[v]));
        }
        uses[v] += `<use href="#${id}" x="${x + pad}" y="${y + pad}" width="1" height="1"/>`;
      }
    }
    parts.push('<defs>' + defs.join('') + '</defs>');
    for (let i = 1; i < cols.length; i++) if (uses[i]) parts.push(`<g fill="${cols[i]}">${uses[i]}</g>`);
  }
  parts.push('</svg>');
  return { blob: new Blob([parts.join('\n')], { type: 'image/svg+xml' }), w: Math.round(W * sc), h: Math.round(H * sc), ext: 'svg' };
}
