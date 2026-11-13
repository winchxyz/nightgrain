// Headless check: node tools/shot.mjs <outDir> [name=shot] [file=path] [sample=moon] [look=id] [tab=id]
//   [t=1.2] [size=1500x950] [p.key=value ...] [art=1] [export=gif|video|png] [mobile=1]
// Needs playwright-core: set PLAYWRIGHT_CORE to its index.mjs, and start `node tools/serve.mjs` first.
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const core = process.env.PLAYWRIGHT_CORE;
if (!core) throw new Error('Set PLAYWRIGHT_CORE to playwright-core/index.mjs');
const { chromium } = await import(pathToFileURL(core).href);

const [outDir, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
await mkdir(outDir, { recursive: true });
const name = args.name || 'shot';
const [vw, vh] = (args.size || (args.mobile ? '390x844' : '1500x950')).split('x').map(Number);

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: args.mobile ? 2 : 1, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto((args.url || 'http://localhost:8930/') + (args.hash ? '#' + args.hash : ''));
await page.waitForFunction(() => window.NG && window.NG.engine.w > 0);
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

if (args.file) {
  const buf = await readFile(args.file);
  const type = { gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }[args.file.split('.').pop().toLowerCase()] || '';
  await page.evaluate(async ({ b64, type, fname }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    await NG.open(new File([u8], fname, { type }));
  }, { b64: buf.toString('base64'), type, fname: basename(args.file) });
  await page.waitForTimeout(600);
}
if (args.sample) await page.evaluate((id) => NG.sample(id), args.sample);
if (args.look) await page.evaluate((id) => NG.look(id), args.look);
for (const k in args) {
  if (!k.startsWith('p.')) continue;
  await page.evaluate(({ k, v }) => {
    const cur = NG.P[k];
    NG.set(k, typeof cur === 'number' ? Number(v) : typeof cur === 'boolean' ? v === 'true' || v === '1' : v);
  }, { k: k.slice(2), v: args[k] });
}
if (args.pal) await page.evaluate((p) => { NG.P.pal = p.split(',').map((c) => '#' + c); }, args.pal);
if (args.tab) await page.evaluate((id) => NG.tab(id), args.tab);
if (args.t !== undefined) await page.evaluate((t) => { NG.play(false); NG.seek(t); }, Number(args.t));
await page.waitForTimeout(Number(args.wait || 700));

const info = await page.evaluate(() => ({ grid: NG.engine.w + 'x' + NG.engine.h, src: NG.source() && { kind: NG.source().kind, w: NG.source().w, h: NG.source().h, d: NG.source().duration }, loop: NG.app.loopLen() }));
await page.screenshot({ path: join(outDir, name + '.png') });
if (args.art) {
  const data = await page.evaluate(async (size) => {
    NG.set('exSize', Number(size));
    await NG.app.renderAt(NG.app.time());
    const c = document.createElement('canvas');
    const k = Math.max(1, Math.round(Number(size) / Math.max(NG.engine.w, NG.engine.h))) || 1;
    NG.engine.compose(c, k, NG.P);
    return c.toDataURL('image/png');
  }, args.art === '1' ? 1024 : args.art);
  await writeFile(join(outDir, name + '-art.png'), Buffer.from(data.split(',')[1], 'base64'));
}
if (args.export) {
  const t0 = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300000 }).catch(() => null),
    page.evaluate((kind) => NG.export(kind), args.export),
  ]);
  if (download) {
    const p = join(outDir, name + '-' + download.suggestedFilename().replace(/nightgrain-[\d-]+/, 'export'));
    await download.saveAs(p);
    info.export = { file: p, ms: Date.now() - t0 };
  }
  info.last = await page.evaluate(() => { const r = NG.app.lastExport; return r && { w: r.w, h: r.h, frames: r.frames, size: r.blob && r.blob.size, error: r.error, ext: r.ext }; });
}
console.log(JSON.stringify({ info, errors }, null, 1));
await browser.close();
