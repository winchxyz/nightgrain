// GIF89a writer and reader, plus a small colour quantizer.

class Bytes {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.len = 0;
  }
  need(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  u8(v) { this.need(1); this.buf[this.len++] = v; }
  u16(v) { this.need(2); this.buf[this.len++] = v & 255; this.buf[this.len++] = (v >> 8) & 255; }
  str(s) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  set(arr, n = arr.length) { this.need(n); this.buf.set(arr.subarray(0, n), this.len); this.len += n; }
}

// Shared LZW dictionary: value = generation * 4096 + code, so a reset is one increment.
const DICT = new Float64Array(4096 * 256);
let gen = 1;

function lzw(minCode, px, out) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let next = eoi + 1;
  let cur = 0, bits = 0;
  const block = new Uint8Array(255);
  let bl = 0;
  const emit = (code) => {
    cur |= code << bits;
    bits += size;
    while (bits >= 8) {
      block[bl++] = cur & 255;
      cur >>>= 8;
      bits -= 8;
      if (bl === 255) { out.u8(255); out.set(block, 255); bl = 0; }
    }
  };
  gen++;
  let base = gen * 4096;
  out.u8(minCode);
  emit(clear);
  let prefix = px[0];
  for (let i = 1; i < px.length; i++) {
    const k = px[i];
    const key = (prefix << 8) | k;
    const hit = DICT[key];
    if (hit >= base && hit < base + 4096) {
      prefix = hit - base;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      size = minCode + 1;
      gen++;
      base = gen * 4096;
    } else {
      if (next >= 1 << size) size++;
      DICT[key] = base + next++;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) {
    block[bl++] = cur & 255;
    if (bl === 255) { out.u8(255); out.set(block, 255); bl = 0; }
  }
  if (bl > 0) { out.u8(bl); out.set(block, bl); }
  out.u8(0);
}

export class GifWriter {
  /** palette: Uint8Array of r,g,b triples (2..256 colours). */
  constructor(width, height, palette, { loop = 0 } = {}) {
    this.w = width;
    this.h = height;
    const count = palette.length / 3;
    let bitsN = 1;
    while (1 << bitsN < count) bitsN++;
    this.bits = bitsN;
    this.minCode = Math.max(2, bitsN);
    const o = (this.out = new Bytes());
    o.str('GIF89a');
    o.u16(width);
    o.u16(height);
    o.u8(0x80 | ((bitsN - 1) << 4) | (bitsN - 1));
    o.u8(0);
    o.u8(0);
    const table = new Uint8Array(3 << bitsN);
    table.set(palette);
    o.set(table);
    o.u8(0x21); o.u8(0xff); o.u8(11); o.str('NETSCAPE2.0'); o.u8(3); o.u8(1); o.u16(loop); o.u8(0);
  }

  /** indices: Uint8Array(w*h); delay in hundredths of a second. */
  addFrame(indices, delay, { transparent = -1 } = {}) {
    const o = this.out;
    o.u8(0x21); o.u8(0xf9); o.u8(4);
    o.u8(transparent >= 0 ? 0x09 : 0x04);
    o.u16(Math.max(2, Math.round(delay)));
    o.u8(transparent >= 0 ? transparent : 0);
    o.u8(0);
    o.u8(0x2c);
    o.u16(0); o.u16(0); o.u16(this.w); o.u16(this.h);
    o.u8(0);
    lzw(this.minCode, indices, o);
  }

  finish() {
    this.out.u8(0x3b);
    return new Blob([this.out.buf.subarray(0, this.out.len)], { type: 'image/gif' });
  }
}

// ---------- quantizer ----------

/** Median cut over a 15-bit histogram. `fixed` colours are always kept. */
export function buildPalette(samples, max, fixed = []) {
  const hist = new Uint32Array(32768);
  for (const d of samples) {
    for (let i = 0; i < d.length; i += 4) hist[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)]++;
  }
  let cells = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) cells.push([k >> 10, (k >> 5) & 31, k & 31, hist[k]]);
  const budget = Math.max(1, max - fixed.length);
  let boxes = [cells];
  while (boxes.length < budget) {
    let bi = -1, score = 0, axis = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      let wsum = 0;
      for (const c of box) wsum += c[3];
      for (let a = 0; a < 3; a++) {
        let lo = 31, hi = 0;
        for (const c of box) { if (c[a] < lo) lo = c[a]; if (c[a] > hi) hi = c[a]; }
        const sc = (hi - lo) * Math.sqrt(wsum);
        if (sc > score) { score = sc; bi = i; axis = a; }
      }
    });
    if (bi < 0) break;
    const box = boxes[bi];
    box.sort((p, q) => p[axis] - q[axis]);
    let total = 0;
    for (const c of box) total += c[3];
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i][3];
      if (acc >= total / 2) { cut = i + 1; break; }
      cut = i + 1;
    }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  const out = [];
  for (const f of fixed) out.push(f[0], f[1], f[2]);
  for (const box of boxes) {
    if (!box.length) continue;
    let r = 0, g = 0, b = 0, wsum = 0;
    for (const c of box) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; wsum += c[3]; }
    out.push(Math.round((r / wsum) * 8.226), Math.round((g / wsum) * 8.226), Math.round((b / wsum) * 8.226));
  }
  return new Uint8Array(out);
}

/** Returns fn(rgba) -> Uint8Array of palette indices. */
export function paletteMapper(palette) {
  const count = palette.length / 3;
  const exact = new Map();
  for (let i = count - 1; i >= 0; i--) exact.set((palette[i * 3] << 16) | (palette[i * 3 + 1] << 8) | palette[i * 3 + 2], i);
  const lut = new Int16Array(262144).fill(-1);
  return (d, alphaIndex = -1) => {
    const n = d.length >> 2;
    const out = new Uint8Array(n);
    let lastKey = -1, lastIdx = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (alphaIndex >= 0 && d[j + 3] < 128) { out[i] = alphaIndex; continue; }
      const key = (d[j] << 16) | (d[j + 1] << 8) | d[j + 2];
      if (key === lastKey) { out[i] = lastIdx; continue; }
      let idx = exact.get(key);
      if (idx === undefined) {
        const q = ((d[j] >> 2) << 12) | ((d[j + 1] >> 2) << 6) | (d[j + 2] >> 2);
        idx = lut[q];
        if (idx < 0) {
          let bd = Infinity;
          for (let p = 0; p < count; p++) {
            const dr = d[j] - palette[p * 3], dg = d[j + 1] - palette[p * 3 + 1], db = d[j + 2] - palette[p * 3 + 2];
            const dist = dr * dr * 3 + dg * dg * 4 + db * db * 2;
            if (dist < bd) { bd = dist; idx = p; }
          }
          lut[q] = idx;
        }
      }
      lastKey = key;
      lastIdx = idx;
      out[i] = idx;
    }
    return out;
  };
}

// ---------- reader (used when the browser has no ImageDecoder) ----------

export function decodeGif(buffer) {
  const d = new Uint8Array(buffer);
  let p = 0;
  const u16 = () => { const v = d[p] | (d[p + 1] << 8); p += 2; return v; };
  const sig = String.fromCharCode(...d.subarray(0, 6));
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('Not a GIF file');
  p = 6;
  const W = u16(), H = u16();
  const flags = d[p++];
  const bgIndex = d[p++];
  p++;
  let gct = null;
  if (flags & 0x80) { const n = 3 << ((flags & 7) + 1); gct = d.subarray(p, p + n); p += n; }
  void bgIndex;
  const frames = [];
  const canvas = new Uint8ClampedArray(W * H * 4);
  let gce = { delay: 10, transparent: -1, dispose: 0 };
  let prev = null;
  const skipBlocks = () => { while (p < d.length) { const n = d[p++]; if (!n) break; p += n; } };
  while (p < d.length) {
    const b = d[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = d[p++];
      if (label === 0xf9) {
        p++;
        const f = d[p++];
        const delay = u16();
        const tr = d[p++];
        p++;
        gce = { delay: delay || 10, transparent: f & 1 ? tr : -1, dispose: (f >> 2) & 7 };
      } else skipBlocks();
      continue;
    }
    if (b !== 0x2c) break;
    const x0 = u16(), y0 = u16(), fw = u16(), fh = u16();
    const lf = d[p++];
    let ct = gct;
    if (lf & 0x80) { const n = 3 << ((lf & 7) + 1); ct = d.subarray(p, p + n); p += n; }
    const interlaced = !!(lf & 0x40);
    const minCode = d[p++];
    // Gather the sub-blocks into one stream.
    let total = 0, q = p;
    while (q < d.length) { const n = d[q++]; if (!n) break; total += n; q += n; }
    const data = new Uint8Array(total);
    let o = 0;
    while (p < d.length) { const n = d[p++]; if (!n) break; data.set(d.subarray(p, p + n), o); o += n; p += n; }
    const px = new Uint8Array(fw * fh);
    unlzw(minCode, data, px);
    if (gce.dispose === 3) prev = canvas.slice();
    const rowOf = interlaced ? interlaceRows(fh) : null;
    for (let y = 0; y < fh; y++) {
      const sy = rowOf ? rowOf[y] : y;
      const ty = y0 + sy;
      if (ty >= H) continue;
      for (let x = 0; x < fw; x++) {
        const tx = x0 + x;
        if (tx >= W) continue;
        const k = px[y * fw + x];
        if (k === gce.transparent || !ct) continue;
        const j = (ty * W + tx) * 4;
        canvas[j] = ct[k * 3]; canvas[j + 1] = ct[k * 3 + 1]; canvas[j + 2] = ct[k * 3 + 2]; canvas[j + 3] = 255;
      }
    }
    frames.push({ data: canvas.slice(), delay: gce.delay * 10 });
    if (gce.dispose === 2) {
      for (let y = y0; y < Math.min(H, y0 + fh); y++) canvas.fill(0, (y * W + x0) * 4, (y * W + Math.min(W, x0 + fw)) * 4);
    } else if (gce.dispose === 3 && prev) canvas.set(prev);
    gce = { delay: 10, transparent: -1, dispose: 0 };
    if (frames.length >= 400) break;
  }
  return { width: W, height: H, frames };
}

function interlaceRows(h) {
  const rows = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y);
  return rows;
}

function unlzw(minCode, data, out) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let size = minCode + 1, next = eoi + 1, mask = (1 << size) - 1;
  let cur = 0, bits = 0, p = 0, op = 0, prevCode = -1, first = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (op < out.length) {
    while (bits < size && p < data.length) { cur |= data[p++] << bits; bits += 8; }
    if (bits < size) break;
    let code = cur & mask;
    cur >>>= size;
    bits -= size;
    if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; prevCode = -1; continue; }
    if (code === eoi) break;
    if (prevCode < 0) { out[op++] = suffix[code]; prevCode = code; first = code; continue; }
    const inCode = code;
    let sp = 0;
    if (code >= next) { stack[sp++] = first; code = prevCode; }
    while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
    first = suffix[code];
    stack[sp++] = first;
    while (sp > 0 && op < out.length) out[op++] = stack[--sp];
    if (next < 4096) {
      prefix[next] = prevCode;
      suffix[next] = first;
      next++;
      if ((next & mask) === 0 && next < 4096) { size++; mask = (1 << size) - 1; }
    }
    prevCode = inCode;
  }
}
