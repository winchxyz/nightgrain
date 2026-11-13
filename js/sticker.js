// Telegram video sticker, written frame by frame: VP9 for the colour, a second VP9 stream
// for the transparency, both in one WebM file (the layout ffmpeg and Chrome use for alpha).

import { livePalette } from './engine.js';
import { sleep } from './util.js';

const CODEC = 'vp09.00.10.08';
export const STICKER_LIMIT = 256 * 1024;

// ---------- a very small WebM writer ----------

function cat(list) {
  let n = 0;
  for (const a of list) n += a.length;
  const out = new Uint8Array(n);
  let p = 0;
  for (const a of list) { out.set(a, p); p += a.length; }
  return out;
}
function sizeOf(n) {
  if (n < 0x7f) return Uint8Array.of(0x80 | n);
  if (n < 0x3fff) return Uint8Array.of(0x40 | (n >> 8), n & 255);
  if (n < 0x1fffff) return Uint8Array.of(0x20 | (n >> 16), (n >> 8) & 255, n & 255);
  if (n < 0xfffffff) return Uint8Array.of(0x10 | (n >>> 24), (n >> 16) & 255, (n >> 8) & 255, n & 255);
  throw new Error('The sticker came out far too large.');
}
const E = (id, ...body) => {
  const b = cat(body);
  return cat([Uint8Array.from(id), sizeOf(b.length), b]);
};
const uint = (v) => {
  const out = [];
  do { out.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0);
  return Uint8Array.from(out);
};
const int16 = (v) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setInt16(0, v);
  return b;
};
const float64 = (v) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return b;
};
const text = (s) => new TextEncoder().encode(s);

/**
 * colour, alpha: one encoded VP9 frame each per picture ({ key, data }).
 * Returns the bytes of a WebM file with transparency.
 */
export function webmWithAlpha(colour, alpha, W, H, fps) {
  const at = (i) => Math.round((i * 1000) / fps);
  const head = E([0x1a, 0x45, 0xdf, 0xa3],
    E([0x42, 0x86], uint(1)), E([0x42, 0xf7], uint(1)), E([0x42, 0xf2], uint(4)), E([0x42, 0xf3], uint(8)),
    E([0x42, 0x82], text('webm')), E([0x42, 0x87], uint(4)), E([0x42, 0x85], uint(2)));
  const info = E([0x15, 0x49, 0xa9, 0x66],
    E([0x2a, 0xd7, 0xb1], uint(1000000)),
    E([0x4d, 0x80], text('Nightgrain')), E([0x57, 0x41], text('Nightgrain')),
    E([0x44, 0x89], float64(at(colour.length))));
  const tracks = E([0x16, 0x54, 0xae, 0x6b], E([0xae],
    E([0xd7], uint(1)), E([0x73, 0xc5], uint(1)), E([0x9c], uint(0)), E([0x22, 0xb5, 0x9c], text('und')),
    E([0x86], text('V_VP9')), E([0x83], uint(1)), E([0x23, 0xe3, 0x83], uint(Math.round(1e9 / fps))),
    E([0x55, 0xee], uint(1)),
    E([0xe0], E([0xb0], uint(W)), E([0xba], uint(H)), E([0x53, 0xc0], uint(1)))));
  const groups = [E([0xe7], uint(0))];
  colour.forEach((c, i) => {
    const block = E([0xa1], Uint8Array.of(0x81), int16(at(i)), Uint8Array.of(0), c.data);
    const extra = E([0x75, 0xa1], E([0xa6], E([0xee], uint(1)), E([0xa5], alpha[i].data)));
    // A frame that needs the one before it says so; a key frame says nothing.
    groups.push(c.key ? E([0xa0], block, extra) : E([0xa0], block, extra, E([0xfb], int16(at(i - 1) - at(i)))));
  });
  const cluster = E([0x1f, 0x43, 0xb6, 0x75], ...groups);
  const cues = E([0x1c, 0x53, 0xbb, 0x6b], E([0xbb], E([0xb3], uint(0)),
    E([0xb7], E([0xf7], uint(1)), E([0xf1], uint(info.length + tracks.length)))));
  return cat([head, E([0x18, 0x53, 0x80, 0x67], info, tracks, cluster, cues)]);
}

// ---------- encoding ----------

/**
 * Returns { blob, w, h, seconds, frames, fits, ext } or null when cancelled,
 * or undefined when this browser cannot encode VP9 frame by frame.
 */
export async function encodeSticker(app, onProgress, signal) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return undefined;
  const P = app.P;
  const engine = app.engine;
  const L = app.loopLen();
  await app.renderAt(0);
  const cells = engine.outSize(P, 1);
  const f = 512 / Math.max(cells.W, cells.H);
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const W = cells.W >= cells.H ? 512 : even(cells.W * f);
  const H = cells.H >= cells.W ? 512 : even(cells.H * f);
  const fps0 = Math.min(30, P.fps);
  try {
    const sup = await VideoEncoder.isConfigSupported({ codec: CODEC, width: W, height: H, bitrate: 400e3, framerate: fps0 });
    if (!sup || !sup.supported) return undefined;
  } catch (e) {
    return undefined;
  }
  // A loop longer than three seconds is played faster to fit.
  const seconds = Math.min(2.9, L);
  const k = Math.max(1, Math.round(f));
  const art = document.createElement('canvas');
  const col = document.createElement('canvas');
  const alp = document.createElement('canvas');
  col.width = alp.width = W;
  col.height = alp.height = H;
  const low = document.createElement('canvas');
  low.width = Math.max(2, Math.round(W / 16));
  low.height = Math.max(2, Math.round(H / 16));
  const cx = col.getContext('2d');
  const ax = alp.getContext('2d', { willReadFrequently: true });
  const lx = low.getContext('2d');
  const plane = new Uint8Array(W * H + 2 * (W / 2) * (H / 2)).fill(128);

  const attempt = async (bits, fps, label) => {
    const frames = Math.max(1, Math.round(seconds * fps));
    const colour = [], alpha = [];
    let failure = null;
    const open = (list, bitrate) => {
      const e = new VideoEncoder({
        output: (chunk) => {
          const b = new Uint8Array(chunk.byteLength);
          chunk.copyTo(b);
          list.push({ key: chunk.type === 'key', data: b });
        },
        error: (err) => { failure = err; },
      });
      e.configure({ codec: CODEC, width: W, height: H, bitrate: Math.round(bitrate), framerate: fps });
      return e;
    };
    const ec = open(colour, bits * 0.4);
    const ea = open(alpha, bits * 0.6);
    try {
      for (let i = 0; i < frames; i++) {
        if (signal.cancelled) return null;
        if (failure) throw failure;
        await app.renderAt((i / frames) * L);
        const Pe = app.live();
        engine.compose(art, k, Pe, { transparent: true });
        const smoothIt = art.width !== W || art.height !== H;
        cx.imageSmoothingQuality = ax.imageSmoothingQuality = lx.imageSmoothingQuality = 'high';
        // What lies under a see-through pixel is never shown, so it takes the colour of the
        // lit pixels around it: edges keep their colour, and the colour stream turns into
        // soft patches that cost almost nothing. The fine detail lives in the alpha stream.
        const pal = livePalette(Pe);
        lx.clearRect(0, 0, low.width, low.height);
        lx.drawImage(art, 0, 0, low.width, low.height);
        cx.imageSmoothingEnabled = true;
        cx.fillStyle = pal[1] || pal[0];
        cx.fillRect(0, 0, W, H);
        for (let r = 0; r < 4; r++) cx.drawImage(low, 0, 0, W, H);
        cx.imageSmoothingEnabled = ax.imageSmoothingEnabled = smoothIt;
        cx.drawImage(art, 0, 0, W, H);
        ax.clearRect(0, 0, W, H);
        ax.drawImage(art, 0, 0, W, H);
        const d = ax.getImageData(0, 0, W, H).data;
        for (let p = 0, q = 3; p < W * H; p++, q += 4) plane[p] = d[q];
        const ts = Math.round((i * 1e6) / fps), dur = Math.round(1e6 / fps);
        const fc = new VideoFrame(col, { timestamp: ts, duration: dur, alpha: 'discard' });
        const fa = new VideoFrame(plane, { format: 'I420', codedWidth: W, codedHeight: H, timestamp: ts, duration: dur });
        ec.encode(fc, { keyFrame: i === 0 });
        ea.encode(fa, { keyFrame: i === 0 });
        fc.close();
        fa.close();
        while (ec.encodeQueueSize > 3 || ea.encodeQueueSize > 3) await sleep(4);
        onProgress((i + 1) / frames, label);
      }
      await Promise.all([ec.flush(), ea.flush()]);
      if (failure) throw failure;
    } finally {
      for (const e of [ec, ea]) { try { e.close(); } catch (err) { /* already closed */ } }
    }
    if (colour.length !== frames || alpha.length !== frames) throw new Error('The video encoder lost some frames. Try again.');
    return { bytes: webmWithAlpha(colour, alpha, W, H, fps), frames };
  };

  // Aim under the limit. Grain is hard to compress, so measure how far off the file is and
  // try again with fewer bits. The encoder will not go below a certain size per frame, so
  // once fewer bits stop helping, drop frames per second instead.
  let bits = (STICKER_LIMIT * 8 * 0.8) / seconds;
  let fps = fps0;
  let got = null;
  let before = 0;
  const tries = [];
  for (let n = 0; n < 8; n++) {
    got = await attempt(bits, fps, n ? 'Encoding again, smaller' : 'Encoding');
    if (!got) return null;
    const size = got.bytes.length;
    tries.push([fps, Math.round(bits / 1000), size]);
    if (size <= STICKER_LIMIT) break;
    const need = (STICKER_LIMIT * 0.88) / size;
    const stuck = before > 0 && size > before * 0.82;
    before = size;
    if ((stuck || n >= 2) && fps > 5) {
      fps = Math.max(5, Math.round(fps * Math.min(0.7, need)));
      before = 0;
    }
    bits = Math.max(30e3, bits * Math.min(0.7, need));
  }
  return { blob: new Blob([got.bytes], { type: 'video/webm' }), w: W, h: H, seconds, frames: got.frames, fits: got.bytes.length <= STICKER_LIMIT, fps, slowed: fps < fps0, tries, ext: 'webm' };
}
