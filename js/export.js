// Saving: PNG, GIF, MP4 (frame by frame), WebM (fallback).

import { GifWriter, buildPalette, paletteMapper } from './gif.js';
import { hexToRgb, sleep } from './util.js';

const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm';

export function exportScale(P, engine) {
  const { W, H } = engine.outSize(P, 1);
  if (!P.exSize) return 1;
  return Math.max(1, Math.round(P.exSize / Math.max(W, H)));
}

// True when the finished picture contains only palette colours.
const isPure = (P, k) => (P.shape === 'square' || k < 3) && P.glow <= 0 && (P.scan <= 0 || k < 2) && P.aberr <= 0;

const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image.'))), type, q));

export async function exportPNG(app) {
  const P = app.P;
  await app.renderAt(app.time());
  const k = exportScale(P, app.engine);
  const c = document.createElement('canvas');
  app.engine.compose(c, k, P, { transparent: P.transparent });
  return { blob: await toBlob(c, 'image/png'), w: c.width, h: c.height };
}

function frameCount(app) {
  const L = app.loopLen();
  return Math.max(1, Math.min(900, Math.round(L * app.P.fps)));
}

function indexFrame(engine, P, k) {
  // Scale the palette indices up by k without touching colours.
  const { pad, W, H } = engine.outSize(P, k);
  const out = new Uint8Array(W * H);
  const { w, h, idx } = engine;
  const row = new Uint8Array(W);
  for (let y = 0; y < h; y++) {
    row.fill(0);
    let o = pad * k;
    for (let x = 0; x < w; x++) {
      const v = idx[y * w + x];
      for (let r = 0; r < k; r++) row[o++] = v;
    }
    const base = (pad + y) * k * W;
    for (let r = 0; r < k; r++) out.set(row, base + r * W);
  }
  return out;
}

export async function exportGIF(app, onProgress, signal) {
  const P = app.P;
  const engine = app.engine;
  const L = app.loopLen();
  const frames = frameCount(app);
  await app.renderAt(0);
  const k = exportScale(P, engine);
  const { W, H } = engine.outSize(P, k);
  if (W * H * frames > 900e6) throw new Error('That GIF would be enormous. Pick a smaller size, a lower frame rate or a shorter loop.');
  const pure = isPure(P, k);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let writer, mapper;
  const palBytes = new Uint8Array(P.pal.slice(0, 256).flatMap((c) => hexToRgb(c)));

  if (pure) {
    writer = new GifWriter(W, H, palBytes);
  } else {
    // Sample a few frames to build one shared 256-colour table.
    const samples = [];
    const picks = Math.min(frames, 5);
    for (let i = 0; i < picks; i++) {
      await app.renderAt((Math.floor((i * frames) / picks) / frames) * L);
      engine.compose(canvas, k, P);
      samples.push(ctx.getImageData(0, 0, W, H).data);
      onProgress(0.1 * ((i + 1) / picks), 'Reading colours');
      if (signal.cancelled) return null;
    }
    const fixed = P.pal.slice(0, 48).map((c) => hexToRgb(c));
    const table = buildPalette(samples, 256, fixed);
    writer = new GifWriter(W, H, table);
    mapper = paletteMapper(table);
  }

  let carry = 0;
  for (let f = 0; f < frames; f++) {
    if (signal.cancelled) return null;
    await app.renderAt((f / frames) * L);
    const want = 100 / P.fps + carry;
    const delay = Math.max(2, Math.round(want));
    carry = want - delay;
    if (pure) {
      writer.addFrame(indexFrame(engine, P, k), delay, { transparent: P.transparent ? 0 : -1 });
    } else {
      engine.compose(canvas, k, P);
      writer.addFrame(mapper(ctx.getImageData(0, 0, W, H).data), delay);
    }
    onProgress((pure ? 0 : 0.1) + (pure ? 1 : 0.9) * ((f + 1) / frames), `Frame ${f + 1} of ${frames}`);
    if (f % 2 === 1) await sleep(0);
  }
  return { blob: writer.finish(), w: W, h: H, frames };
}

async function pickCodec(W, H, fps, bitrate) {
  const tries = [
    ['avc1.640034', 'avc'], ['avc1.640033', 'avc'], ['avc1.64002a', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.42003e', 'avc'],
    ['vp09.00.51.08', 'vp9'], ['vp09.00.40.08', 'vp9'], ['av01.0.08M.08', 'av1'],
  ];
  for (const [codec, kind] of tries) {
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps };
    if (kind === 'avc') cfg.avc = { format: 'avc' };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r && r.supported) return { cfg, kind };
    } catch (e) { /* try the next one */ }
  }
  return null;
}

export const canMP4 = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

export async function exportMP4(app, onProgress, signal) {
  const P = app.P;
  const engine = app.engine;
  const L = app.loopLen();
  const fps = P.fps;
  const frames = frameCount(app);
  await app.renderAt(0);
  let k = exportScale(P, engine);
  let size = engine.outSize(P, k);
  // Most hardware encoders stop at 4096 on a side.
  while (k > 1 && Math.max(size.W, size.H) > 4096) { k--; size = engine.outSize(P, k); }
  const W = size.W + (size.W & 1), H = size.H + (size.H & 1);
  // Dither grain is hard on video codecs, so give it a lot of bits.
  const bitrate = Math.round(Math.min(80e6, Math.max(6e6, W * H * fps * 0.35)));
  const picked = await pickCodec(W, H, fps, bitrate);
  if (!picked) throw new Error('This browser cannot encode video at that size. Try a smaller size or save a GIF.');
  onProgress(0, 'Loading the video writer');
  const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: picked.kind, width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
  let failure = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  enc.configure(picked.cfg);
  const art = document.createElement('canvas');
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ox = out.getContext('2d');
  try {
    for (let f = 0; f < frames; f++) {
      if (signal.cancelled) { enc.close(); return null; }
      if (failure) throw failure;
      await app.renderAt((f / frames) * L);
      engine.compose(art, k, P);
      ox.fillStyle = P.pal[0];
      ox.fillRect(0, 0, W, H);
      ox.drawImage(art, 0, 0);
      const vf = new VideoFrame(out, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: f % Math.max(1, Math.round(fps * 2)) === 0 });
      vf.close();
      while (enc.encodeQueueSize > 3) await sleep(4);
      onProgress((f + 1) / frames, `Frame ${f + 1} of ${frames}`);
    }
    await enc.flush();
    if (failure) throw failure;
    enc.close();
  } catch (e) {
    try { enc.close(); } catch (e2) { /* already closed */ }
    throw e;
  }
  muxer.finalize();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), w: W, h: H, frames, ext: 'mp4' };
}

/** Real-time recording for browsers without WebCodecs. */
export async function exportWebM(app, onProgress, signal) {
  const P = app.P;
  const engine = app.engine;
  const L = app.loopLen();
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video. Save a GIF instead.');
  await app.renderAt(0);
  const k = Math.min(exportScale(P, engine), Math.max(1, Math.floor(1920 / Math.max(engine.w, engine.h))));
  const canvas = document.createElement('canvas');
  engine.compose(canvas, k, P);
  const stream = canvas.captureStream(P.fps);
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('This browser cannot record video. Save a GIF instead.');
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 24e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));
  rec.start();
  const t0 = performance.now();
  for (;;) {
    const t = (performance.now() - t0) / 1000;
    if (t >= L || signal.cancelled) break;
    await app.renderAt(t);
    engine.compose(canvas, k, P);
    onProgress(t / L, 'Recording');
    await new Promise((r) => requestAnimationFrame(r));
  }
  rec.stop();
  await stopped;
  if (signal.cancelled) return null;
  return { blob: new Blob(chunks, { type }), w: canvas.width, h: canvas.height, ext: type.includes('mp4') ? 'mp4' : 'webm' };
}
