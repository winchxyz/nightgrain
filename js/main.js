// Nightgrain: app shell. Wires the engine to the stage, the panel and the exports.

import { clamp, smooth, el, debounce, downloadBlob, store, hslToHex, sleep, hexOf, adjustHex } from './util.js';
import { Engine, drawFrame, analyse, SHAPES, paintShape, isShaped, shapeSet, livePalette, setCustomShape, setFrameImage, hasCustomShape } from './engine.js';
import { CONTROLS, CONTROL, TABS, LOOKS, KEEP, CAN_ANIMATE, defaults, PALETTES, ALGOS } from './schema.js';
import { extractPalette, sortByLuma } from './palettes.js';
import { loadFile, sampleSource, SAMPLES, cameraSource, recordClip } from './sources.js';
import { exportPNG, exportGIF, exportMP4, exportWebM, exportScale, canMP4 } from './export.js';
import { exportAPNG, exportSheet, exportSticker, exportSVG, zipStore } from './more-export.js';
import { keyAt, setKey, removeKey, valueAt, cleanKeys } from './keys.js';
import { Painter } from './paint.js';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const viewport = $('#viewport');
const panel = $('#panel');
const rail = $('#rail');
const help = $('#help');
const HELP_DEFAULT = 'Hover any control to see what it does. Double-click a slider name to reset it.';
const ACCEPT = 'image/*,video/*,.gif,.webp,.apng,.mp4,.mov,.webm,.mkv';
const PAL_HEX = /^!?#[0-9a-f]{6}$/i;

const P = defaults();
const engine = new Engine();
const thumbEngine = new Engine();
const painter = new Painter();
engine.paint = painter.data;
const brush = { tool: 'paint', size: 0.08, soft: 0.4, flow: 1, color: '#ffffff' };
let src = null;
let t = 0;
let playing = true;
let busy = false;
let recording = false;
let dirty = true;
let compare = false;
let picking = false;
let lookId = 'relic';
let activeTab = 'looks';
let lastSig = '';
let lastNow = 0;
let lastKeyPhase = -1;
let savedLooks = store('ng.looks') || [];
let exportSignal = null;

const isClip = () => !!src && (src.kind === 'video' || src.kind === 'gif');
const showState = () => ({ clip: isClip() });

function loopLen() {
  if (isClip()) return Math.max(0.1, ((P.trimB - P.trimA) * src.duration) / P.speed);
  return P.loop;
}
const srcTime = (tt) => (isClip() ? P.trimA * src.duration + tt * P.speed : tt);
const phaseOf = (tt) => {
  const L = loopLen();
  return L > 0 ? (((tt % L) + L) % L) / L : 0;
};
const phaseNow = () => phaseOf(t);

// ---------- keyframes and colour cycling ----------
const hasKeys = () => {
  for (const k in P.keys) return true;
  return false;
};

/** A keyframed setting's value at a moment of the loop. */
function keyedValue(k, ph) {
  const c = CONTROL[k];
  let v = valueAt(P.keys[k], ph);
  if (c.step >= 1) v = Math.round(v / c.step) * c.step;
  return clamp(v, c.min, c.max);
}
/** What a slider shows: the keyframed value now, or the plain setting. */
const shown = (k) => (P.keys[k] ? keyedValue(k, phaseNow()) : P[k]);

/** The settings as they are at one moment: keyframes and colour cycling applied. */
function liveP(tt) {
  if (!hasKeys() && P.cycle === 0) return P;
  const ph = phaseOf(tt);
  const o = Object.create(P);
  for (const k in P.keys) if (CONTROL[k]) o[k] = keyedValue(k, ph);
  if (P.cycle !== 0) {
    if (P.cycleMode === 'hue') o.palHue = o.palHue + ph * 360 * P.cycle;
    else {
      const act = [];
      P.pal.forEach((c, i) => { if (i > 0 && c[0] !== '!') act.push(i); });
      const n = act.length;
      const s = n ? ((Math.floor(ph * P.cycle * n + 1e-6) % n) + n) % n : 0;
      if (s) {
        const pal = [...P.pal];
        act.forEach((idx, j) => { pal[idx] = P.pal[act[(j + s) % n]]; });
        o.pal = pal;
      }
    }
  }
  return o;
}

/** For deciding which controls to show: a keyframed slider counts at its largest value. */
function visP() {
  if (!hasKeys()) return P;
  const o = Object.create(P);
  for (const k in P.keys) o[k] = Math.max(...P.keys[k].map((p) => p[1]));
  return o;
}

const COLOUR_KEYS = ['glow', 'glowSize', 'scan', 'aberr', 'shapeVar', 'palHue', 'palSat', 'palLight', 'gap', 'shapeRot'];

const app = {
  P,
  engine,
  loopLen,
  time: () => t,
  Pe: null,
  /** The settings used for the frame rendered last. */
  live: () => app.Pe || P,
  /** False when the colours on screen change during the loop. */
  steadyColours: () => P.cycle === 0 && !COLOUR_KEYS.some((k) => P.keys[k]),
  async renderAt(tt) {
    const L = loopLen();
    const st = srcTime(tt);
    if (src.kind === 'video') await src.seek(st);
    app.Pe = liveP(tt);
    engine.render(app.Pe, src.frame(st, L > 0 ? (tt / L) % 1 : 0), src.w, src.h, tt, L);
  },
};

// ---------- toast ----------
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const n = $('#toast');
  n.textContent = msg;
  n.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove('show'), ms);
}

// ---------- history ----------
// Pictures inside the settings (your own pixel, the frame image, the painting) are long
// strings. Each is kept once and the history refers to it by a short id.
const blobIds = new Map();
const blobById = new Map();
const intern = (s) => {
  if (!s) return '';
  let id = blobIds.get(s);
  if (!id) {
    id = '@' + (blobIds.size + 1);
    blobIds.set(s, id);
    blobById.set(id, s);
  }
  return id;
};
const outtern = (id) => (id && blobById.get(id)) || '';

const hist = [];
let hi = -1;
const snapshot = () => JSON.stringify({ P: { ...P, customImg: intern(P.customImg), frameImg: intern(P.frameImg) }, lookId, paint: intern(painter.url) });
const saveState = () => store('ng.state', { P, lookId, tab: activeTab });
function commit() {
  const s = snapshot();
  if (hist[hi] === s) return;
  hist.length = hi + 1;
  hist.push(s);
  if (hist.length > 150) hist.shift();
  hi = hist.length - 1;
  saveState();
  syncHistoryButtons();
}
const commitSoon = debounce(commit, 350);
function restore(s) {
  const o = JSON.parse(s);
  o.P.customImg = outtern(o.P.customImg);
  o.P.frameImg = outtern(o.P.frameImg);
  Object.assign(P, o.P);
  P.pal = [...o.P.pal];
  P.keys = o.P.keys || {};
  lookId = o.lookId;
  painter.restore(outtern(o.paint)).then((changed) => { if (changed) dirty = true; });
  refreshAll();
  saveState();
}
function undo() { if (hi > 0) { hi--; restore(hist[hi]); syncHistoryButtons(); } }
function redo() { if (hi < hist.length - 1) { hi++; restore(hist[hi]); syncHistoryButtons(); } }
function syncHistoryButtons() {
  $('#btnUndo').disabled = hi <= 0;
  $('#btnRedo').disabled = hi >= hist.length - 1;
}

// ---------- settings ----------
const touchLook = () => { if (lookId && !lookId.startsWith('~')) lookId = '~' + lookId; };

function setP(k, v, { silent = false } = {}) {
  if (k === 'trimA') v = Math.min(v, P.trimB - 0.02);
  if (k === 'trimB') v = Math.max(v, P.trimA + 0.02);
  if (P.keys[k]) {
    // A keyframed setting: the change belongs to this moment of the loop.
    if (playing) {
      setPlaying(false);
      toast('Paused. This setting has keyframes, so the change is pinned at this moment of the loop.', 4200);
    }
    snapToKey(k);
    setKey(P.keys, k, phaseNow(), v);
    renderKeys();
  } else if (P[k] === v) return;
  P[k] = v;
  if (!KEEP.has(k)) lookId = lookId && lookId.startsWith('~') ? lookId : '~' + (lookId || '');
  dirty = true;
  if (k === 'invert' && src) { const L = loopLen(); renorm(src.frame(srcTime(t), L > 0 ? (t / L) % 1 : 0)); }
  // A tint changes the picture's colours, which only shows when colour comes from the source.
  if (k === 'tint' && v !== 'none' && P.mode === 'ramp') {
    P.mode = 'match';
    updateControls('mode');
    toast('Switched “Colour from” to Source colours so the tint shows');
  }
  if (k === 'customGlyph') {
    if (v) {
      P.customImg = '';
      // An emoji keeps its own colours; a letter or symbol takes the palette's.
      P.customTint = !/\p{Extended_Pictographic}/u.test(v);
      selectCustom();
    }
    sanitize();
    syncAssets();
    for (const x of ['customTint', 'shape', 'grid']) updateControls(x);
  }
  if (k === 'text') syncStageMode();
  if (!silent) {
    updateControls(k);
    if (k === 'palHue' || k === 'palSat' || k === 'palLight') renderSwatches();
    refreshVisibility();
    if (KEEP.has(k) || k === 'invert') thumbsSoon();
    updateExportInfo();
    markLook();
  }
  commitSoon();
  if (k === 'frame' && v === 'custom' && !P.frameImg) pickFrame();
}

/** Keep the settings consistent after they were replaced wholesale. */
function sanitize() {
  if (!P.keys || typeof P.keys !== 'object') P.keys = {};
  if (!P.customImg && !P.customGlyph) {
    if (P.shape === 'custom') P.shape = 'square';
    if (String(P.shapeSet).includes('custom')) P.shapeSet = P.shapeSet.split(',').filter((s) => s !== 'custom').join(',') || 'dot';
  }
  if (P.pal[0][0] === '!') P.pal[0] = hexOf(P.pal[0]);
  if (!P.pal.some((c, i) => i > 0 && c[0] !== '!')) P.pal = P.pal.map(hexOf);
}

// Your own pixel belongs to you rather than to a look, so looks leave it alone.
const OWN = ['customImg', 'customGlyph', 'customTint'];

function keptThrough(look) {
  const keep = {};
  for (const k of KEEP) keep[k] = P[k];
  for (const k of OWN) if (!look || !(k in look.p)) keep[k] = P[k];
  const keys = {};
  for (const k in P.keys) if (KEEP.has(k)) keys[k] = P.keys[k];
  return { keep, keys };
}

function applyLook(look) {
  const { keep, keys } = keptThrough(look);
  const base = defaults();
  Object.assign(P, base, keep, look.p);
  P.pal = [...(look.p.pal || base.pal)];
  P.keys = cleanKeys({ ...keys, ...(look.p.keys || {}) }, CAN_ANIMATE);
  lookId = look.id;
  refreshAll();
  commit();
}

function surprise() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const r = (a, b) => a + Math.random() * (b - a);
  const chance = (p) => Math.random() < p;
  const { keep, keys } = keptThrough(null);
  Object.assign(P, defaults(), keep);
  P.keys = cleanKeys(keys, CAN_ANIMATE);
  const dark = PALETTES.filter((p) => !['riso', 'newsprint', 'blueprint', 'gameboy'].includes(p.id));
  P.pal = [...pick(chance(0.85) ? dark : PALETTES).colors];
  P.algo = pick(ALGOS.filter((a) => a.id !== 'none')).id;
  P.mode = chance(0.6) ? 'match' : 'ramp';
  P.grid = Math.round(pick([96, 128, 160, 200, 256, 256, 320, 400]));
  P.black = r(0.02, 0.2);
  P.gamma = r(0.9, 1.5);
  P.contrast = r(0, 0.4);
  P.sat = r(0.9, 1.8);
  P.edge = chance(0.6) ? r(0, 1.2) : 0;
  if (chance(0.2)) P.edgeFill = r(0.2, 0.8);
  P.shimmer = r(0.1, 0.6);
  P.rate = Math.round(r(6, 16));
  if (chance(0.3)) P.hue = Math.round(r(-60, 60));
  if (chance(0.35)) { P.glow = r(0.3, 0.9); P.glowSize = r(0.7, 1.8); }
  if (chance(0.25)) { P.shape = pick(['gap', 'dot', 'diamond', 'rows', 'round']); P.grid = Math.min(P.grid, 160); }
  else if (chance(0.15)) {
    P.grid = pick([56, 64, 72, 88]);
    P.gap = r(0.06, 0.2);
    if (chance(0.5)) { P.shapeMix = pick(['colour', 'random']); P.shapeSet = pick(['dot,diamond,plus,spark', 'dot,ring,round', 'tri,diamond,hex', 'star,spark,dot', 'heart,dot']); }
    else P.shape = pick(['plus', 'cross', 'star', 'spark', 'heart', 'tri', 'hex', 'ring', 'moon', 'slash']);
    if (chance(0.5)) P.shapeVar = r(0.3, 0.9);
  }
  if (P.mode === 'match' && chance(0.2)) {
    P.tint = pick(['linear', 'radial', 'tone', 'rainbow']);
    P.tintA = hslToHex(Math.random() * 360, 0.85, 0.55);
    P.tintB = hslToHex(Math.random() * 360, 0.85, 0.55);
    P.tintAngle = Math.round(r(-180, 180));
    if (chance(0.5)) P.tintMove = pick([-1, 1]);
  }
  if (chance(0.2)) { P.wind = r(0.4, 0.9); P.windDir = pick(['left', 'right', 'up']); }
  if (chance(0.25)) P.sparkle = r(0.1, 0.5);
  if (chance(0.25)) P.glint = r(0.3, 0.8);
  if (chance(0.15)) P.scan = r(0.2, 0.5);
  if (chance(0.12)) P.aberr = r(0.3, 1);
  if (chance(0.2)) P.pscale = 2;
  if (chance(0.12)) { P.burst = pick(['explode', 'scatter', 'fall', 'rise', 'blow', 'swirl']); P.burstLen = r(0.2, 0.4); }
  if (chance(0.12)) { P.cycle = pick([-1, 1]); P.cycleMode = pick(['hue', 'hue', 'shift']); }
  lookId = '~surprise';
  refreshAll();
  commit();
}

// ---------- keyframe actions ----------
function seekPhase(ph) {
  const L = loopLen();
  t = clamp(ph, 0, 0.9999) * L;
  if (src && src.kind === 'video') src.el.currentTime = srcTime(t);
  dirty = true;
}
/** Editing next to a keyframe means editing that keyframe: move the playhead onto it. */
function snapToKey(k) {
  const list = P.keys[k];
  const i = keyAt(list, phaseNow());
  if (i >= 0) seekPhase(list[i][0]);
}
function afterKeys(k) {
  if (k && !KEEP.has(k)) touchLook();
  if (k) updateControls(k);
  renderKeys();
  refreshVisibility();
  markLook();
  dirty = true;
  commitSoon();
}
function toggleKey(k) {
  if (!CAN_ANIMATE.has(k)) return;
  if (playing) setPlaying(false);
  const ph = phaseNow();
  const list = P.keys[k];
  if (list && keyAt(list, ph) >= 0) {
    const v = keyedValue(k, ph);
    removeKey(P.keys, k, ph);
    if (!P.keys[k]) P[k] = v;
  } else {
    const first = !hasKeys();
    setKey(P.keys, k, ph, shown(k));
    snapToKey(k);
    if (first) toast('Keyframe added. Move along the timeline and change the slider: it will glide between the two values.', 5200);
  }
  afterKeys(k);
}
function dropKeys(k) {
  if (!P.keys[k]) return;
  P[k] = keyedValue(k, phaseNow());
  delete P.keys[k];
  afterKeys(k);
}
function clearKeys() {
  for (const k of Object.keys(P.keys)) {
    P[k] = keyedValue(k, phaseNow());
    delete P.keys[k];
    updateControls(k);
    if (!KEEP.has(k)) touchLook();
  }
  afterKeys(null);
}

let keyList, keyEmpty, keyFoot;
function buildKeysGroup(node) {
  keyList = el('div.key-list');
  keyEmpty = el('p.note', { text: 'Any slider with a ◆ beside its name can change over the loop. Pause, press ◆ to pin the value at this moment, move along the timeline and set another value. The picture glides between them.' });
  keyFoot = el('div.row', null, el('button.btn.small', { type: 'button', text: 'Remove all keyframes', onclick: clearKeys }));
  const g = el('section.group', null, el('h3', { text: 'Keyframes' }), keyEmpty, keyList, keyFoot);
  g.dataset.hint = 'Keyframes make a setting change over the loop. The last one eases back into the first, so the loop has no seam.';
  node.append(g);
}
function renderKeys() {
  const ticks = $('#ticks');
  if (ticks) {
    ticks.textContent = '';
    const seen = new Set();
    for (const k in P.keys) for (const [ph] of P.keys[k]) {
      const id = ph.toFixed(3);
      if (seen.has(id)) continue;
      seen.add(id);
      ticks.append(el('button.tick', { type: 'button', title: 'Go to this keyframe', 'aria-label': 'Keyframe at ' + Math.round(ph * 100) + '%', style: { left: ph * 100 + '%' }, onclick: () => { setPlaying(false); seekPhase(ph); } }));
    }
  }
  if (!keyList) return;
  keyList.textContent = '';
  const ks = Object.keys(P.keys);
  keyFoot.hidden = !ks.length;
  for (const k of ks) {
    const c = CONTROL[k];
    const tab = TABS.find((x) => x.id === c.tab);
    const n = P.keys[k].length;
    keyList.append(el('div.key-row', { 'data-hint': 'Open this setting. Its keyframes are the marks above the timeline.' },
      el('button.key-name', { type: 'button', onclick: () => { showTab(c.tab); const r = ui[c.id || c.k]; if (r) r.root.scrollIntoView({ block: 'center' }); } },
        el('span', { text: c.label }), el('span.muted', { text: ' · ' + tab.name })),
      el('span.mono.muted', { text: n + (n === 1 ? ' keyframe' : ' keyframes') }),
      el('button.key-del', { type: 'button', text: '×', title: 'Remove these keyframes', onclick: () => dropKeys(k) })));
  }
}

// ---------- panel building ----------
// ui is keyed by control id (the setting's key, unless a setting appears twice).
const ui = {};
function updateControls(k) {
  for (const id in ui) {
    const c = ui[id].def;
    if (c.k === k || (c.also && c.also.includes(k))) ui[id].update();
  }
}
const groups = [];
const tabEls = {};

const ICONS = {
  looks: '<path d="M11 3.500l1.800 4.700 4.700 1.800-4.700 1.800L11 16.500l-1.800-4.700L4.500 10l4.700-1.800z"/><path d="M18 15l.900 2.100 2.100.900-2.100.900L18 21l-.900-2.100-2.100-.900 2.100-.900z"/>',
  source: '<rect x="3.500" y="5" width="17" height="14" rx="2.500"/><circle cx="8.500" cy="10" r="1.500"/><path d="M20.500 15.500l-4.500-4.500-8 8"/>',
  tone: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
  dither: '<path d="M5 5h3v3H5zM11 5h3v3h-3zM17 5h2v3h-2zM8 10.500h3v3H8zM14 10.500h3v3h-3zM5 16h3v3H5zM12 16h2v3h-2z" fill="currentColor" stroke="none"/>',
  colour: '<path d="M12 3.500c3 3.600 5.500 6.400 5.500 9.500a5.500 5.500 0 0 1-11 0c0-3.100 2.500-5.900 5.500-9.500z"/>',
  motion: '<path d="M3 12c2.500-5.500 4.500-5.500 6 0s3.500 5.500 6 0 3.500-5.500 6 0"/>',
  finish: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/>',
  shape: '<rect x="4" y="4" width="6.500" height="6.500" rx="1"/><circle cx="16.700" cy="7.200" r="3.300"/><path d="M7.200 13.500l3.500 6.200h-7z"/><path d="M16.700 13.300l3.500 3.500-3.500 3.500-3.500-3.500z"/>',
  paint: '<path d="M4.500 19.500l1-4.200L16.300 4.500l3.200 3.200L8.700 18.500z"/><path d="M13.800 7l3.200 3.200"/>',
  text: '<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9.500 19h5"/>',
  export: '<path d="M12 4v11"/><path d="M7.500 10.500L12 15l4.500-4.500"/><path d="M5 19.500h14"/>',
};

function buildRail() {
  for (const tab of TABS) {
    const b = el('button', { type: 'button', 'data-tab': tab.id, html: `<svg viewBox="0 0 24 24">${ICONS[tab.id]}</svg><span>${tab.name}</span>`, onclick: () => showTab(tab.id) });
    rail.append(b);
  }
  // Fade the edge of the row while more tabs wait beyond it.
  const more = () => rail.classList.toggle('more', rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 6);
  rail.addEventListener('scroll', more, { passive: true });
  window.addEventListener('resize', more);
  requestAnimationFrame(more);
}

function showTab(id) {
  activeTab = id;
  for (const b of rail.children) {
    b.classList.toggle('on', b.dataset.tab === id);
    // On a phone the tabs are one scrolling row: keep the open one in sight.
    if (b.dataset.tab === id && rail.scrollWidth > rail.clientWidth) rail.scrollTo({ left: b.offsetLeft - (rail.clientWidth - b.offsetWidth) / 2 });
  }
  for (const k in tabEls) tabEls[k].classList.toggle('on', k === id);
  panel.scrollTop = 0;
  if (id === 'looks') renderThumbs();
  if (id === 'export') updateExportInfo();
  syncStageMode();
  saveState();
}

function pctOf(c, v) { return ((v - c.min) / (c.max - c.min)) * 100 + '%'; }

// Controls that are not settings (brush, camera, batch) use these two small builders.
function miniRange(label, min, max, step, value, fmt, onInput, hint) {
  const out = el('output', { text: fmt(value) });
  const input = el('input', { type: 'range', min, max, step, 'aria-label': label });
  input.value = value;
  const fill = () => input.style.setProperty('--p', ((+input.value - min) / (max - min)) * 100 + '%');
  fill();
  input.addEventListener('input', () => { out.textContent = fmt(+input.value); fill(); onInput(+input.value); });
  const root = el('div.ctl', null, el('div.ctl-head', null, el('label', { text: label }), out), input);
  root.dataset.hint = hint || '';
  return root;
}
function miniChips(label, options, value, onPick, hint) {
  const box = el('div.chips');
  const mark = (v) => { for (const b of box.children) b.classList.toggle('on', b._v === v); };
  for (const [v, text] of options) {
    const b = el('button.chip', { type: 'button', text, onclick: () => { mark(v); onPick(v); } });
    b._v = v;
    box.append(b);
  }
  mark(value);
  const root = el('div.ctl', null, el('div.ctl-head', null, el('label', { text: label })), box);
  root.dataset.hint = hint || '';
  root._mark = mark;
  return root;
}

function buildControl(c) {
  let root;
  const id = c.id || c.k;
  const same = (a, b) => String(a) === String(b);
  if (c.type === 'range') {
    const out = el('output');
    const input = el('input', { type: 'range', min: c.min, max: c.max, step: c.step, 'aria-label': c.label });
    const keyBtn = CAN_ANIMATE.has(c.k)
      ? el('button.key', { type: 'button', title: 'Keyframe', 'aria-label': 'Keyframe for ' + c.label, html: '<svg viewBox="0 0 12 12"><path d="M6 1.500 10.500 6 6 10.500 1.500 6z"/></svg>',
        'data-hint': 'Keyframe. Pin this value at the current moment of the loop; pin another value at another moment and the setting glides between them.',
        onclick: () => toggleKey(c.k), ondblclick: (e) => e.stopPropagation() })
      : null;
    const head = el('div.ctl-head', { title: 'Double-click to reset' }, el('label', { text: c.label }), el('span.ctl-right', null, keyBtn, out));
    root = el('div.ctl', null, head, input);
    input.addEventListener('input', () => setP(c.k, +input.value));
    input.addEventListener('pointerdown', () => { input._drag = true; });
    for (const ev of ['pointerup', 'pointercancel', 'blur']) input.addEventListener(ev, () => { input._drag = false; });
    head.addEventListener('dblclick', () => setP(c.k, c.def));
    ui[id] = {
      root,
      update() {
        const list = P.keys[c.k];
        const v = list ? keyedValue(c.k, phaseNow()) : P[c.k];
        // While a keyframed slider is being dragged, leave the thumb under the pointer.
        if (!(list && input._drag)) input.value = v;
        input.style.setProperty('--p', pctOf(c, v));
        out.textContent = c.fmt ? c.fmt(v) : v;
        root.classList.toggle('changed', v !== c.def);
        root.classList.toggle('keyed', !!list);
        if (keyBtn) keyBtn.classList.toggle('on', !!list && keyAt(list, phaseNow()) >= 0);
      },
    };
  } else if (c.type === 'chips' || c.type === 'algo') {
    const box = el('div.chips');
    const btns = [];
    const add = (value, label, hint) => {
      const b = el('button.chip', { type: 'button', text: label, 'data-hint': hint || null, onclick: () => setP(c.k, value) });
      b._v = value;
      btns.push(b);
      box.append(b);
    };
    if (c.type === 'algo') {
      let g = '';
      for (const a of ALGOS) {
        if (a.group !== g) { g = a.group; box.append(el('div.chip-caption', { text: g })); }
        add(a.id, a.name, a.hint);
      }
    } else for (const [value, label] of c.options) add(value, label);
    root = el('div.ctl', null, el('div.ctl-head', null, el('label', { text: c.label })), box);
    ui[id] = { root, update() { for (const b of btns) b.classList.toggle('on', same(b._v, P[c.k])); } };
  } else if (c.type === 'toggle') {
    const sw = el('button.switch', { type: 'button', role: 'switch', 'aria-label': c.label, onclick: () => setP(c.k, !P[c.k]) });
    root = el('div.ctl', null, el('div.ctl-row', null, el('label', { text: c.label }), sw));
    ui[id] = { root, update() { sw.setAttribute('aria-checked', P[c.k] ? 'true' : 'false'); } };
  } else if (c.type === 'color') {
    const input = el('input', { type: 'color', 'aria-label': c.label });
    const hex = el('span.mono.muted');
    input.addEventListener('input', () => setP(c.k, input.value));
    const row = el('div.color-row', null, input, hex);
    if (c.pick) row.append(el('span.grow'), el('button.btn.small', { type: 'button', text: 'Pick from picture', onclick: () => startPicking() }));
    root = el('div.ctl', null, el('div.ctl-head', null, el('label', { text: c.label })), row);
    ui[id] = { root, update() { input.value = P[c.k]; hex.textContent = P[c.k]; } };
  } else if (c.type === 'text') {
    const input = c.single
      ? el('input.text', { type: 'text', maxlength: c.max, 'aria-label': c.label, autocomplete: 'off', spellcheck: 'false' })
      : el('textarea.text', { rows: 3, maxlength: c.max, 'aria-label': c.label, placeholder: 'Type here', spellcheck: 'false' });
    input.addEventListener('input', () => setP(c.k, input.value));
    root = el('div.ctl', null, el('div.ctl-head', null, el('label', { text: c.label })), input);
    ui[id] = { root, update() { if (input.value !== P[c.k]) input.value = P[c.k]; } };
  } else if (c.type === 'button') {
    root = el('div.ctl', null, el('button.btn.wide', { type: 'button', text: c.label, onclick: () => ACTIONS[c.action]() }));
    ui[id] = { root, update() {} };
  } else if (c.type === 'shape') {
    // A grid of drawn shapes. One is picked, or several when shapes are mixed.
    const box = el('div.shape-grid');
    const label = el('label', { text: c.label });
    const btns = [];
    const dpr = Math.min(3, Math.ceil(window.devicePixelRatio || 1));
    const add = (sid, sname) => {
      const cv = el('canvas', { width: 22 * dpr, height: 22 * dpr });
      const b = el('button.shape-btn', { type: 'button', title: sname, 'aria-label': sname, onclick: () => pickShape(sid) }, cv);
      b._v = sid;
      btns.push(b);
      box.append(b);
      return { b, cv };
    };
    for (const [sid, sname] of SHAPES) paintShape(add(sid, sname).cv.getContext('2d'), sid, 22 * dpr, 0.2, 0, 1);
    const own = add('custom', 'Your own pixel');
    own.b.classList.add('own');
    let ownSig = null;
    root = el('div.ctl', null, el('div.ctl-head', null, label), box);
    ui[id] = {
      root,
      update() {
        const many = P.shapeMix !== 'none';
        const set = many ? shapeSet(P) : [P.shape];
        label.textContent = many ? 'Shapes in use' : 'Shape';
        own.b.hidden = !hasCustomShape();
        if (hasCustomShape() && ownSig !== customSig) {
          ownSig = customSig;
          const x = own.cv.getContext('2d');
          x.clearRect(0, 0, own.cv.width, own.cv.height);
          paintShape(x, 'custom', 22 * dpr, 0.1, 0, 1);
        }
        for (const b of btns) b.classList.toggle('on', set.includes(b._v));
      },
    };
  }
  root.dataset.hint = c.hint || '';
  ui[id].def = c;
  return root;
}

function pickShape(sid) {
  if (P.shapeMix === 'none') { setP('shape', sid); return; }
  const set = shapeSet(P);
  const next = set.includes(sid) ? set.filter((x) => x !== sid) : [...set, sid];
  if (next.length) setP('shapeSet', next.join(','));
}

let shapeNote;
function buildPanel() {
  for (const tab of TABS) {
    const node = el('div.tab', { 'data-tab': tab.id });
    tabEls[tab.id] = node;
    panel.append(node);
    if (tab.id === 'looks') buildLooksTab(node);
    if (tab.id === 'source') buildSourceHead(node);
    if (tab.id === 'colour') buildColourTab(node);
    if (tab.id === 'paint') buildPaintTab(node);
    if (tab.id === 'motion') buildKeysGroup(node);
    if (tab.id === 'shape') {
      shapeNote = el('p.note.warn', { hidden: true, text: 'The pixels are too small on screen to show a shape. Lower the resolution below.' });
      node.append(shapeNote);
    }
    let group = null, name = '';
    for (const c of CONTROLS) {
      if (c.tab !== tab.id || c.type === 'hidden') continue;
      if (c.group !== name) {
        name = c.group;
        group = el('section.group', null, el('h3', { text: name }));
        group._ctls = [];
        groups.push(group);
        node.append(group);
      }
      group.append(buildControl(c));
      group._ctls.push(c.id || c.k);
    }
    if (tab.id === 'colour') buildColourFoot(node);
    if (tab.id === 'source') buildSourceFoot(node);
    if (tab.id === 'export') buildExportTab(node);
  }
  panel.addEventListener('pointerover', (e) => {
    const n = e.target.closest('[data-hint]');
    help.textContent = n && n.dataset.hint ? n.dataset.hint : HELP_DEFAULT;
  });
  panel.addEventListener('focusin', (e) => {
    const n = e.target.closest('[data-hint]');
    if (n && n.dataset.hint) help.textContent = n.dataset.hint;
  });
  help.textContent = HELP_DEFAULT;
}

function refreshVisibility() {
  const S = showState();
  const V = visP();
  for (const k in ui) {
    const c = ui[k].def;
    ui[k].root.hidden = c.show ? !c.show(V, S) : false;
  }
  for (const g of groups) g.hidden = g._ctls.every((k) => ui[k].root.hidden);
}

function refreshAll() {
  sanitize();
  syncAssets();
  for (const k in ui) ui[k].update();
  refreshVisibility();
  renderSwatches();
  renderKeys();
  markPalette();
  markLook();
  updateExportInfo();
  syncStageMode();
  dirty = true;
}

// ---------- looks tab ----------
let looksGrid;
const lookCards = [];
function buildLooksTab(node) {
  const g = el('section.group');
  looksGrid = el('div.looks');
  g.append(
    el('div.row', null,
      el('button.btn', { type: 'button', text: 'Surprise me', 'data-hint': 'Roll a random combination of pattern, palette and effects.', onclick: surprise }),
      el('button.btn', { type: 'button', text: 'Save this look', 'data-hint': 'Keep the current settings as your own look. It is stored in this browser.', onclick: saveLook })),
    looksGrid);
  node.append(g);
  rebuildLookCards();
}

function rebuildLookCards() {
  looksGrid.textContent = '';
  lookCards.length = 0;
  const all = [...LOOKS, ...savedLooks];
  for (const look of all) {
    const cv = el('canvas', { width: 8, height: 8 });
    const card = el('button.look', { type: 'button', 'data-hint': look.saved ? 'Your saved look.' : 'Apply the ' + look.name + ' look. Your framing and export settings stay.', onclick: () => applyLook(look) }, cv, el('span', { text: look.name }));
    if (look.saved) {
      card.append(el('button.del', { type: 'button', text: '×', title: 'Delete this look', onclick: (e) => {
        e.stopPropagation();
        savedLooks = savedLooks.filter((l) => l.id !== look.id);
        store('ng.looks', savedLooks);
        rebuildLookCards();
        renderThumbs();
      } }));
    }
    looksGrid.append(card);
    lookCards.push({ look, card, cv });
  }
  markLook();
}

function markLook() {
  for (const { look, card } of lookCards) card.classList.toggle('on', look.id === lookId);
}

/** Everything that makes up the look: settings that differ from the defaults, palette, keyframes. */
function lookDiff(withPictures) {
  const base = defaults();
  const d = {};
  for (const c of CONTROLS) {
    if (c.keep || c.type === 'button' || P[c.k] === base[c.k]) continue;
    if (c.k === 'customImg' && !withPictures) continue;
    d[c.k] = P[c.k];
  }
  d.pal = [...P.pal];
  const keys = {};
  for (const k in P.keys) if (!KEEP.has(k)) keys[k] = P.keys[k].map((p) => [p[0], p[1]]);
  for (const k in keys) { d.keys = keys; break; }
  return d;
}

function saveLook() {
  const look = { id: 'my' + Date.now().toString(36), name: 'My look ' + (savedLooks.length + 1), p: lookDiff(true), saved: true };
  savedLooks.push(look);
  store('ng.looks', savedLooks);
  lookId = look.id;
  rebuildLookCards();
  renderThumbs();
  toast('Saved as “' + look.name + '”');
}

function renderThumbs() {
  if (!src || activeTab !== 'looks' || busy) return;
  const L = loopLen();
  let drawable;
  try { drawable = src.frame(srcTime(t), L > 0 ? (t / L) % 1 : 0); } catch (e) { return; }
  const keep = {};
  for (const k of KEEP) keep[k] = P[k];
  const base = defaults();
  for (const { look, cv } of lookCards) {
    const lp = Object.assign({}, base, keep, look.p, { aspect: '1:1', pad: 0, intro: 'none', burst: 'none' });
    if (lp.shape === 'custom' && !hasCustomShape()) lp.shape = 'square';
    const shaped = isShaped(lp);
    const fine = shaped && (lp.shapeMix !== 'none' || !['gap', 'dot', 'diamond', 'rows', 'cols', 'round'].includes(lp.shape));
    lp.grid = fine ? 28 : shaped ? 56 : 96;
    lp.pal = look.p.pal || base.pal;
    thumbEngine.render(lp, drawable, src.w, src.h, t, L);
    thumbEngine.compose(cv, fine ? 8 : shaped ? 4 : 2, lp);
  }
}
const thumbsSoon = debounce(renderThumbs, 250);

// ---------- source tab ----------
let fileName, fileSub, camBox, camButton;
let camLen = 4;
function buildSourceHead(node) {
  fileName = el('div.name');
  fileSub = el('div.sub');
  const g = el('section.group', null, el('h3', { text: 'Picture' }),
    el('div.file-card', null, el('div.meta', null, fileName, fileSub), el('button.btn.small', { type: 'button', text: 'Open', onclick: () => $('#file').click() })),
    el('p.note', { text: 'Drop a file anywhere, or paste an image from the clipboard. Images, GIFs, animated WebP and video all work. Nothing leaves your computer.' }));
  const chips = el('div.chips');
  for (const s of SAMPLES) chips.append(el('button.chip', { type: 'button', text: s.name, 'data-hint': 'Try the editor with a built-in scene.', onclick: () => openSource(sampleSource(s.id)) }));
  g.append(el('div.ctl', null, el('div.ctl-head', null, el('label', { text: 'Or try a built-in scene' })), chips));
  camButton = el('button.btn.wide', { type: 'button', text: 'Use the camera', 'data-hint': 'Use your camera as a live source. The picture stays on this computer.', onclick: useCamera });
  camBox = el('div', { hidden: true },
    miniChips('Clip length', [[2, '2 s'], [4, '4 s'], [8, '8 s']], camLen, (v) => { camLen = v; }, 'How long the recorded clip is.'),
    el('div.ctl', null, el('button.btn.wide.primary', { type: 'button', text: 'Record a clip', 'data-hint': 'Record a few seconds from the camera. The clip can be trimmed and saved as a GIF or video.', onclick: recordCamera })));
  g.append(el('div.ctl', null, camButton), camBox);
  node.append(g);
}
function buildSourceFoot(node) {
  node.append(el('section.group', null, el('div.row', null, el('button.btn', { type: 'button', text: 'Reset framing', 'data-hint': 'Put zoom, position, turn and mirror back to normal.', onclick: () => {
    for (const k of ['zoom', 'panX', 'panY', 'rot', 'flipX', 'flipY', 'fit', 'aspect']) { dropKeys(k); setP(k, CONTROL[k].def); }
  } }))));
}
function updateFileCard() {
  if (!src) return;
  fileName.textContent = src.name;
  const kind = { image: 'Image', gif: 'Animation', video: 'Video', sample: 'Built-in scene', camera: 'Live camera' }[src.kind];
  fileSub.textContent = `${kind} · ${src.w} × ${src.h}` + (isClip() ? ` · ${src.duration.toFixed(1)} s` : '');
  camBox.hidden = src.kind !== 'camera';
  camButton.hidden = src.kind === 'camera';
}

async function useCamera() {
  if (busy || recording) return;
  try {
    const s = await cameraSource();
    await openSource(s);
    setP('flipX', true);
    toast('Camera on. Record a clip to save it as an animation.', 3600);
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : 'The camera could not be opened.', 5000);
  }
}

async function recordCamera() {
  if (!src || src.kind !== 'camera' || recording || busy) return;
  recording = true;
  const framing = {};
  for (const k of ['zoom', 'panX', 'panY', 'rot', 'flipX', 'flipY']) framing[k] = P[k];
  try {
    const clip = await recordClip(src, camLen, 20, (f) => toast(`Recording · ${Math.max(0, camLen * (1 - f)).toFixed(1)} s left`, 1500));
    await openSource(clip);
    Object.assign(P, framing);
    refreshAll();
    commit();
    toast('Clip recorded. Trim it under Clip, then save it as a GIF or video.', 4600);
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : 'The clip could not be recorded.', 5000);
  } finally {
    recording = false;
  }
}

// ---------- colour tab ----------
let swatchBox, palList, palCount = 5;
function buildColourTab(node) {
  swatchBox = el('div.swatches');
  bindSwatchDrag();
  const g1 = el('section.group', null, el('h3', { text: 'Palette' }), swatchBox,
    el('div.row', null,
      el('button.btn.small', { type: 'button', text: 'Sort', 'data-hint': 'Order the colours from dark to light. The order matters when colour comes from brightness.', onclick: () => setPal(sortByLuma(P.pal)) }),
      el('button.btn.small', { type: 'button', text: 'Reverse', 'data-hint': 'Flip the order of every colour except the backdrop.', onclick: () => setPal([P.pal[0], ...P.pal.slice(1).reverse()]) }),
      el('button.btn.small', { type: 'button', text: 'Shift hues', 'data-hint': 'Rotate every colour around the colour wheel by a random amount.', onclick: shiftHues }),
      el('button.btn.small', { type: 'button', text: 'Random', 'data-hint': 'Invent a new palette.', onclick: randomPalette })));
  const counts = el('div.chips');
  for (const n of [3, 4, 5, 6, 8, 12]) {
    const b = el('button.chip', { type: 'button', text: String(n), onclick: () => { palCount = n; for (const x of counts.children) x.classList.toggle('on', x === b); fromPicture(); } });
    counts.append(b);
  }
  const fp = el('div.ctl', null, el('div.ctl-head', null, el('label', { text: 'Take colours from the picture' })), counts);
  fp.dataset.hint = 'Build a palette out of the picture\'s own colours. Pick how many.';
  g1.append(fp);
  node.append(g1);
}

function buildColourFoot(node) {
  palList = el('div.pal-list');
  for (const p of PALETTES) {
    const strip = el('span.strip');
    for (const c of p.colors) strip.append(el('i', { style: { background: c } }));
    const b = el('button.pal', { type: 'button', 'data-hint': `${p.name}: ${p.colors.length} colours.`, onclick: () => setPal([...p.colors]) }, strip, el('span.pname', { text: p.name }));
    b._id = p.id;
    palList.append(b);
  }
  node.append(el('section.group', null, el('h3', { text: 'Ready-made palettes' }), palList));
}

function setPal(colors) {
  P.pal = colors;
  sanitize();
  touchLook();
  renderSwatches();
  markPalette();
  markLook();
  dirty = true;
  commitSoon();
}

const adjusted = () => !!(P.palHue || P.palSat !== 1 || P.palLight);
/** Make the "adjust all" sliders part of the colours themselves and put the sliders back. */
function bakePalette() {
  P.pal = P.pal.map((c, j) => (j === 0 ? c : (c[0] === '!' ? '!' : '') + adjustHex(hexOf(c), P.palHue, P.palSat, P.palLight)));
  P.palHue = 0; P.palSat = 1; P.palLight = 0;
  for (const k of ['palHue', 'palSat', 'palLight']) { delete P.keys[k]; updateControls(k); }
  renderKeys();
}

function renderSwatches() {
  if (!swatchBox) return;
  swatchBox.textContent = '';
  const adj = adjusted();
  // Swatches show the colours as drawn, with the "adjust all" sliders applied.
  P.pal.forEach((raw, i) => {
    const off = raw[0] === '!';
    const base = hexOf(raw);
    const colour = i === 0 || !adj ? base : adjustHex(base, P.palHue, P.palSat, P.palLight);
    const input = el('input', { type: 'color', value: colour, 'aria-label': i === 0 ? 'Backdrop colour' : 'Colour ' + i });
    const sw = el('div.swatch' + (i === 0 ? '.bg' : '') + (off ? '.off' : ''), { style: { background: colour }, 'data-i': i,
      'data-hint': i === 0 ? 'The backdrop. Everything dark falls into this colour.' : 'Click to change this colour. Drag it to another place to reorder. The small circle switches it off without deleting it.' }, input);
    input.addEventListener('input', () => {
      // Editing one colour by hand: make the adjusted colours the real palette first.
      if (adjusted()) bakePalette();
      P.pal[i] = (P.pal[i][0] === '!' ? '!' : '') + input.value;
      sw.style.background = input.value;
      touchLook();
      markPalette();
      renderInk();
      dirty = true;
      commitSoon();
    });
    if (i > 0) {
      if (P.pal.length > 2) sw.append(el('button.x', { type: 'button', text: '×', title: 'Remove', onclick: () => setPal(P.pal.filter((_, j) => j !== i)) }));
      sw.append(el('button.mute', { type: 'button', title: off ? 'Switch this colour back on' : 'Switch this colour off', 'aria-pressed': off ? 'true' : 'false',
        html: '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.600"/><path d="M3.400 8.600 8.600 3.400"/></svg>', onclick: () => toggleMute(i) }));
    }
    swatchBox.append(sw);
  });
  if (P.pal.length < 32) {
    swatchBox.append(el('button.swatch.add', { type: 'button', text: '+', 'data-hint': 'Add a colour.', onclick: () => setPal([...P.pal, hslToHex(Math.random() * 360, 0.75, 0.6)]) }));
  }
  renderInk();
}

function toggleMute(i) {
  const off = P.pal[i][0] === '!';
  if (!off && P.pal.filter((c, j) => j > 0 && c[0] !== '!').length <= 1) { toast('One colour has to stay on'); return; }
  const pal = [...P.pal];
  pal[i] = off ? hexOf(pal[i]) : '!' + pal[i];
  setPal(pal);
}

// Drag a swatch onto another one to move it there.
function bindSwatchDrag() {
  let d = null;
  const clean = () => { for (const n of swatchBox.children) n.classList.remove('drop', 'lifted'); };
  swatchBox.addEventListener('pointerdown', (e) => {
    const sw = e.target.closest('.swatch[data-i]');
    if (!sw || e.button !== 0 || e.target.closest('button')) return;
    const i = +sw.dataset.i;
    if (i > 0) d = { i, to: i, x: e.clientX, y: e.clientY, on: false, id: e.pointerId };
  });
  swatchBox.addEventListener('pointermove', (e) => {
    if (!d) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 7) return;
      d.on = true;
      try { swatchBox.setPointerCapture(d.id); } catch (err) { /* the pointer is already gone */ }
    }
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const sw = hit && hit.closest ? hit.closest('.swatch[data-i]') : null;
    clean();
    if (swatchBox.children[d.i]) swatchBox.children[d.i].classList.add('lifted');
    if (sw && swatchBox.contains(sw) && +sw.dataset.i > 0) {
      d.to = +sw.dataset.i;
      if (d.to !== d.i) sw.classList.add('drop');
    }
  });
  const end = () => {
    if (!d) return;
    const { i, to, on } = d;
    d = null;
    clean();
    if (!on) return;
    // The drag ends with a click on the colour underneath; swallow it so no picker opens.
    const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, true), 150);
    if (to !== i) {
      const pal = [...P.pal];
      const [c] = pal.splice(i, 1);
      pal.splice(to, 0, c);
      setPal(pal);
    }
  };
  swatchBox.addEventListener('pointerup', end);
  swatchBox.addEventListener('pointercancel', end);
}

function markPalette() {
  if (!palList) return;
  const sig = P.pal.join(',').toLowerCase();
  for (const b of palList.children) b.classList.toggle('on', PALETTES.find((p) => p.id === b._id).colors.join(',') === sig);
}

function shiftHues() {
  const turn = 40 + Math.random() * 280;
  setPal(P.pal.map((c, i) => (i === 0 ? c : (c[0] === '!' ? '!' : '') + adjustHex(hexOf(c), turn, 1, 0))));
}

function randomPalette() {
  const n = 3 + Math.floor(Math.random() * 4);
  const h0 = Math.random() * 360;
  const spread = 30 + Math.random() * 150;
  const cols = ['#000000'];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    cols.push(hslToHex(h0 + (f - 0.5) * spread + (Math.random() - 0.5) * 30, 0.6 + Math.random() * 0.35, 0.32 + f * 0.45));
  }
  cols.push(hslToHex(h0 + spread / 2, 0.3, 0.96));
  setPal(cols);
}

function fromPicture() {
  if (!engine.raw) return;
  const cols = extractPalette(engine.raw, palCount);
  setPal([P.pal[0], ...cols.slice(cols.length > 2 ? 1 : 0)]);
}

// ---------- paint tab ----------
let inkBox, inkInput, toolChips, brushEl;
function buildPaintTab(node) {
  const g = el('section.group', null, el('h3', { text: 'Brush' }));
  toolChips = miniChips('Tool', [['paint', 'Paint'], ['erase', 'Erase'], ['restore', 'Restore'], ['move', 'Move picture']], brush.tool,
    (v) => { brush.tool = v; syncStageMode(); },
    'Paint lights pixels up in a colour. Erase hides them. Restore brings the original back. Move picture drags the source as usual.');
  g.append(toolChips,
    miniRange('Size', 0.01, 0.5, 0.005, brush.size, (v) => Math.round(v * 100) + '%', (v) => { brush.size = v; }, 'Brush width as a share of the picture.'),
    miniRange('Soft edge', 0, 1, 0.01, brush.soft, (v) => Math.round(v * 100) + '%', (v) => { brush.soft = v; }, 'A soft brush fades out into scattered pixels at its edge.'),
    miniRange('Strength', 0.05, 1, 0.01, brush.flow, (v) => Math.round(v * 100) + '%', (v) => { brush.flow = v; }, 'How much one pass of the brush changes the picture.'));
  inkInput = el('input', { type: 'color', value: brush.color, 'aria-label': 'Brush colour' });
  inkInput.addEventListener('input', () => { brush.color = inkInput.value; renderInk(); });
  inkBox = el('div.ink');
  const ink = el('div.ctl', null, el('div.ctl-head', null, el('label', { text: 'Colour' })), el('div.color-row', null, inkInput, inkBox));
  ink.dataset.hint = 'The colour you paint with. It is dithered like the rest of the picture, so a palette colour stays exact.';
  g.append(ink);
  node.append(g, el('section.group', null,
    el('p.note', { text: 'Draw straight on the picture. Strokes go through the same dithering as everything else and stay in place when you reframe the source.' }),
    el('div.row', null, el('button.btn', { type: 'button', text: 'Clear the painting', 'data-hint': 'Remove every stroke of the brush and the eraser.', onclick: () => { painter.clear(); dirty = true; commit(); } }))));
}

function renderInk() {
  if (!inkBox) return;
  inkBox.textContent = '';
  livePalette(P).slice(1, 13).forEach((c) => {
    inkBox.append(el('button.ink-dot' + (c.toLowerCase() === brush.color.toLowerCase() ? '.on' : ''), { type: 'button', title: c, 'aria-label': 'Paint with ' + c, style: { background: c },
      onclick: () => { brush.color = c; inkInput.value = c; renderInk(); } }));
  });
}

const paintMode = () => activeTab === 'paint' && brush.tool !== 'move';
const textMode = () => activeTab === 'text' && !!P.text;
function syncStageMode() {
  viewport.classList.toggle('painting', paintMode());
  viewport.classList.toggle('texting', textMode());
  if (brushEl && !paintMode()) brushEl.hidden = true;
}

// ---------- your own pixel, your own frame ----------
function pickFiles(accept, multiple) {
  return new Promise((res) => {
    const input = el('input', { type: 'file', accept, hidden: true });
    if (multiple) input.multiple = true;
    input.addEventListener('change', () => { res([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { res([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

const mkCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

async function fileToCanvas(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const iw = img.naturalWidth || 256, ih = img.naturalHeight || 256;
    const s = Math.min(1, max / Math.max(iw, ih));
    const c = mkCanvas(Math.max(1, Math.round(iw * s)), Math.max(1, Math.round(ih * s)));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } catch (e) {
    throw new Error('That file is not a picture this browser can read.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Find the outline of a picture. One that already has transparency is left alone. One on a
 * plain backdrop has that backdrop removed. Returns 'alpha', 'keyed' or 'photo' (no outline).
 */
function cutOut(c) {
  const w = c.width, h = c.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;
  const n = w * h;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) clear++;
  if (clear > n * 0.01) return 'alpha';
  const edge = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) edge.push(y * w, y * w + w - 1);
  let r = 0, gg = 0, b = 0;
  for (const i of edge) { r += d[i * 4]; gg += d[i * 4 + 1]; b += d[i * 4 + 2]; }
  r /= edge.length; gg /= edge.length; b /= edge.length;
  let spread = 0;
  for (const i of edge) spread += Math.hypot(d[i * 4] - r, d[i * 4 + 1] - gg, d[i * 4 + 2] - b);
  if (spread / edge.length > 38) return 'photo';
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const dist = Math.hypot(d[j] - r, d[j + 1] - gg, d[j + 2] - b) / 441;
    d[j + 3] = Math.round(smooth(0.06, 0.2, dist) * 255);
  }
  g.putImageData(im, 0, 0);
  return 'keyed';
}

function squareStamp(c, size) {
  const o = mkCanvas(size, size);
  const k = Math.min(size / c.width, size / c.height);
  const g = o.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, (size - c.width * k) / 2, (size - c.height * k) / 2, c.width * k, c.height * k);
  return o;
}

function glyphStamp(ch) {
  const S = 96;
  const c = mkCanvas(S, S);
  const g = c.getContext('2d');
  g.font = '700 72px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  const m = g.measureText(ch);
  const bw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, bh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const k = Math.min(1.3, (S * 0.96) / Math.max(bw, bh, 1));
  g.translate(S / 2, S / 2);
  g.scale(k, k);
  g.fillText(ch, (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  return c;
}

const loadImage = (url) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('picture'));
  img.src = url;
});

// What the engine currently holds, so pictures are decoded only when they change.
let customSig = '', frameSig = '';
function afterCustom() {
  updateControls('shape');
  dirty = true;
  thumbsSoon();
}
function syncAssets() {
  const cs = P.customImg || (P.customGlyph ? 'glyph:' + P.customGlyph : '');
  if (cs !== customSig) {
    customSig = cs;
    if (!cs) { setCustomShape(null); afterCustom(); }
    else if (!P.customImg) { setCustomShape(glyphStamp(P.customGlyph)); afterCustom(); }
    else loadImage(cs).then((img) => { if (customSig === cs) { setCustomShape(img); afterCustom(); } }).catch(() => {});
  }
  const fs = P.frameImg;
  if (fs !== frameSig) {
    frameSig = fs;
    if (!fs) { setFrameImage(null); dirty = true; }
    else loadImage(fs).then((img) => { if (frameSig === fs) { setFrameImage(img); dirty = true; thumbsSoon(); } }).catch(() => {});
  }
}

/** Put your own pixel to use: pick it, and make the pixels big enough to see it. */
function selectCustom() {
  if (P.shapeMix === 'none') P.shape = 'custom';
  else if (!shapeSet(P).includes('custom')) P.shapeSet = [...shapeSet(P), 'custom'].join(',');
  if (P.grid > 120) {
    delete P.keys.grid;
    P.grid = 64;
    toast('Resolution lowered to 64 px so your pixel is large enough to see', 4200);
  }
  touchLook();
}

async function customFromFile(file) {
  try {
    const c = await fileToCanvas(file, 256);
    const kind = cutOut(c);
    const stamp = squareStamp(c, 96);
    P.customImg = stamp.toDataURL('image/png');
    P.customGlyph = '';
    P.customTint = kind !== 'photo';
    customSig = P.customImg;
    setCustomShape(stamp);
    selectCustom();
    refreshAll();
    commit();
    if (kind === 'photo') toast('That picture has no outline, so each pixel shows the whole picture in its own colours', 5000);
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : 'That picture could not be used.', 5000);
  }
}
async function pickCustom() {
  const [file] = await pickFiles('image/*', false);
  if (file) await customFromFile(file);
}

async function frameFromFile(file) {
  try {
    const c = await fileToCanvas(file, 320);
    if (cutOut(c) === 'photo') {
      toast('That picture has no clear outline. Use one with a transparent background, or a shape on a plain backdrop.', 6000);
      return false;
    }
    P.frameImg = c.toDataURL('image/png');
    P.frame = 'custom';
    frameSig = P.frameImg;
    setFrameImage(c);
    refreshAll();
    thumbsSoon();
    commit();
    return true;
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : 'That picture could not be used.', 5000);
    return false;
  }
}
async function pickFrame() {
  const [file] = await pickFiles('image/*', false);
  const ok = file ? await frameFromFile(file) : false;
  if (!ok && P.frame === 'custom' && !P.frameImg) setP('frame', 'none');
}

const ACTIONS = { pickCustom, pickFrame };

// ---------- export tab ----------
let exInfo, exBar, exStatus, exProgress, exButtons = [], exCancel;
let batchKind = 'png';
function buildExportTab(node) {
  exInfo = el('p.note');
  exBar = el('i');
  exStatus = el('span');
  exCancel = el('button.btn.small', { type: 'button', text: 'Cancel', onclick: () => { if (exportSignal) exportSignal.cancelled = true; } });
  exProgress = el('div', { hidden: true }, el('div.progress', null, exBar), el('div.export-status', null, exStatus, exCancel));
  const mk = (text, kind, hint, primary) => {
    const b = el('button.btn.wide' + (primary ? '.primary' : ''), { type: 'button', text, 'data-hint': hint, onclick: () => runExport(kind) });
    exButtons.push(b);
    return b;
  };
  node.append(el('section.group', null, el('h3', { text: 'Save' }), exInfo, exProgress,
    el('div.stack', null,
      mk('Save PNG', 'png', 'Save the frame you see now as a picture.', true),
      mk('Save GIF', 'gif', 'Save one full loop as an animated GIF. With no glow or pixel shapes it keeps the exact palette and stays small.'),
      mk('Save video', 'video', 'Save one full loop as an MP4 video, rendered frame by frame at full quality.'),
      mk('Copy picture', 'copy', 'Copy the current frame to the clipboard.')),
    el('div.row', null, el('button.btn.small', { type: 'button', text: 'Copy a link to this look', 'data-hint': 'A link that opens Nightgrain with these exact settings. The picture itself is not included.', onclick: copyLink }))));

  node.append(el('section.group', null, el('h3', { text: 'More formats' }),
    el('div.stack', null,
      mk('Animated PNG', 'apng', 'One full loop as an animated PNG: full colour and real transparency, which a GIF cannot do. The file is larger.'),
      mk('Telegram sticker', 'sticker', 'A video sticker for Telegram: WebM, 512 px, up to 3 seconds, transparent backdrop. Send the file to the @Stickers bot.'),
      mk('Sprite sheet', 'sheet', 'Every frame of the loop laid out in one PNG, for games and web animation.'),
      mk('SVG', 'svg', 'The frame you see now as vector shapes that stay sharp at any size, for print or a plotter. Glow, scanlines and colour fringe are left out.'))));

  const batchBtn = el('button.btn.wide', { type: 'button', text: 'Choose files', 'data-hint': 'Pick several images, GIFs or videos. Each one gets the current look and they are saved together.',
    onclick: async () => { const files = await pickFiles(ACCEPT, true); if (files.length) runBatch(files, batchKind); } });
  exButtons.push(batchBtn);
  node.append(el('section.group', null, el('h3', { text: 'Many files at once' }),
    el('p.note', { text: 'Give a whole set of files the look you have now. Each one is prepared on its own, and they come back together in one ZIP.' }),
    miniChips('Save each as', [['png', 'PNG'], ['gif', 'GIF'], ['video', 'Video']], batchKind, (v) => { batchKind = v; }, 'The format every file is saved in.'),
    el('div.ctl', null, batchBtn)));
}

function updateExportInfo() {
  if (!exInfo || !engine.w) return;
  const k = exportScale(P, engine);
  const { W, H } = engine.outSize(P, k);
  const L = loopLen();
  exInfo.textContent = `${W} × ${H} px. Animations: ${Math.max(1, Math.round(L * P.fps))} frames, ${L.toFixed(1)} s.`;
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const sizeText = (bytes) => (bytes > 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1e3)) + ' KB');
const ANIMATED = new Set(['gif', 'video', 'apng', 'sheet', 'sticker']);

/** Render one file. Returns { blob, ext, tag, text } or null when cancelled. */
async function exportOne(kind, progress, signal) {
  let r;
  if (kind === 'png' || kind === 'copy') {
    r = await exportPNG(app);
    return { ...r, ext: 'png', tag: '', text: `Saved PNG · ${r.w} × ${r.h}` };
  }
  if (kind === 'gif') {
    r = await exportGIF(app, progress, signal);
    return r && { ...r, ext: 'gif', tag: '', text: `Saved GIF · ${r.w} × ${r.h} · ${r.frames} frames` };
  }
  if (kind === 'video') {
    r = canMP4() ? await exportMP4(app, progress, signal) : await exportWebM(app, progress, signal);
    return r && { ...r, tag: '', text: `Saved video · ${r.w} × ${r.h}` };
  }
  if (kind === 'apng') {
    r = await exportAPNG(app, progress, signal);
    return r && { ...r, tag: '-animated', text: `Saved animated PNG · ${r.w} × ${r.h} · ${r.frames} frames` };
  }
  if (kind === 'sheet') {
    r = await exportSheet(app, progress, signal);
    return r && { ...r, tag: '-sheet', text: `Saved sprite sheet · ${r.cols} × ${r.rows} frames of ${r.cellW} × ${r.cellH}` };
  }
  if (kind === 'sticker') {
    r = await exportSticker(app, progress, signal);
    return r && { ...r, tag: '-sticker', text: r.fits ? `Saved sticker · ${r.w} × ${r.h} · ${r.seconds.toFixed(1)} s` + (r.slowed ? ` · ${r.fps} frames a second to fit 256 KB` : '') : 'Saved, but it is over Telegram’s 256 KB limit. Try fewer colours, less shimmer or a shorter loop' };
  }
  if (kind === 'svg') {
    r = await exportSVG(app);
    return { ...r, tag: '', text: `Saved SVG · ${r.w} × ${r.h}` };
  }
  throw new Error('Unknown format.');
}

function exportBegin(showProgress) {
  busy = true;
  exportSignal = { cancelled: false };
  if (src.kind === 'video') src.el.pause();
  for (const b of exButtons) b.disabled = true;
  exProgress.hidden = !showProgress;
  if (showProgress && activeTab === 'export') panel.scrollTop = 0;
  const progress = (f, label) => { exBar.style.width = Math.round(clamp(f) * 100) + '%'; exStatus.textContent = label || ''; };
  progress(0, 'Starting');
  return progress;
}
function exportEnd() {
  exProgress.hidden = true;
  for (const b of exButtons) b.disabled = false;
  busy = false;
  exportSignal = null;
  app.Pe = null;
  if (src.kind === 'video') { src.el.currentTime = srcTime(t); if (playing) src.el.play().catch(() => {}); }
  dirty = true;
}

/** True when the frame on screen has nothing but the backdrop (a break-up at its start, say). */
function emptyFrame() {
  const a = engine.idx;
  if (!a) return false;
  for (let i = 0, n = engine.w * engine.h; i < n; i++) if (a[i]) return false;
  return true;
}

async function runExport(kind) {
  if (busy || recording || !src) return;
  const animated = ANIMATED.has(kind);
  if (animated && src.kind === 'camera') {
    toast('The camera is live. Record a clip first (Source), then save it.', 4600);
    return;
  }
  if (!animated && emptyFrame()) {
    toast('This frame is empty. Move the playhead to a moment with something in it, then save.', 5000);
    app.lastExport = { empty: true };
    return;
  }
  const tKeep = t;
  const progress = exportBegin(animated);
  try {
    const res = await exportOne(kind, progress, exportSignal);
    if (!res) toast('Cancelled');
    else if (kind === 'copy') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': res.blob })]);
      toast('Copied to the clipboard');
    } else {
      downloadBlob(res.blob, `nightgrain-${stamp()}${res.tag}.${res.ext}`);
      toast(`${res.text} · ${sizeText(res.blob.size)}`, 4600);
    }
    app.lastExport = res;
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : 'Something went wrong while saving.', 5000);
    app.lastExport = { error: String(e && e.message) };
  } finally {
    t = tKeep;
    exportEnd();
  }
}

// Settings that belong to one picture and are set afresh for every file.
const PER_FILE = ['trimA', 'trimB', 'zoom', 'panX', 'panY', 'rot', 'flipX', 'flipY'];

async function runBatch(files, kind) {
  if (busy || recording || !src) return;
  files = [...files];
  const skipped = Math.max(0, files.length - 40);
  files = files.slice(0, 40);
  const home = { src, t, playing, norm: engine.norm, paint: painter.url, keep: { key: P.key } };
  for (const k of PER_FILE) home.keep[k] = P[k];
  const progress = exportBegin(true);
  playing = false;
  const out = [], failed = [], used = new Set();
  let cancelled = false;
  try {
    for (let i = 0; i < files.length; i++) {
      if (exportSignal.cancelled) { cancelled = true; break; }
      const file = files[i];
      const head = `${i + 1} of ${files.length}`;
      progress(i / files.length, `${head} · opening ${file.name}`);
      let s = null;
      try {
        s = await loadFile(file);
        await openSource(s, { keepOld: true });
        if (s.kind === 'video') s.el.pause();
        t = kind === 'png' ? loopLen() * 0.5 : 0;
        draw();
        const res = await exportOne(kind, (f, label) => progress((i + f) / files.length, `${head} · ${label || 'rendering'}`), exportSignal);
        if (!res) { cancelled = true; break; }
        let name = (file.name || 'picture').replace(/\.[^.]+$/, '') || 'picture';
        for (let n = 2; used.has(name.toLowerCase()); n++) name = name.replace(/-\d+$/, '') + '-' + n;
        used.add(name.toLowerCase());
        out.push({ name: `${name}.${res.ext}`, data: new Uint8Array(await res.blob.arrayBuffer()) });
      } catch (e) {
        console.error(e);
        failed.push(file.name);
      } finally {
        if (s && s !== home.src) { try { s.dispose(); } catch (e) { /* nothing to free */ } }
      }
    }
    if (out.length === 1) downloadBlob(new Blob([out[0].data]), out[0].name);
    else if (out.length) downloadBlob(zipStore(out), `nightgrain-${stamp()}.zip`);
    const bits = [out.length ? `Saved ${out.length} ${out.length === 1 ? 'file' : 'files'}` : 'Nothing was saved'];
    if (failed.length) bits.push(`${failed.length} could not be opened`);
    if (skipped) bits.push(`${skipped} left out (40 at a time)`);
    if (cancelled) bits.push('cancelled');
    toast(bits.join(' · '), 5200);
    app.lastExport = { batch: out.length, names: out.map((f) => f.name), failed, bytes: out.reduce((a, f) => a + f.data.length, 0) };
  } finally {
    // Put the picture that was open back exactly as it was.
    src = home.src;
    Object.assign(P, home.keep);
    engine.norm = home.norm;
    thumbEngine.norm = home.norm;
    await painter.restore(home.paint);
    t = home.t;
    playing = home.playing;
    updateFileCard();
    refreshAll();
    exportEnd();
    lastSig = '';
  }
}

async function copyLink() {
  const json = JSON.stringify(lookDiff(false));
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = location.origin + location.pathname + '#look=' + b64;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch (e) {
    location.hash = 'look=' + b64;
    toast('The link is in the address bar');
  }
}

/** Take settings from stored or shared data, ignoring anything that does not belong. */
function adopt(d, pictures) {
  for (const k in d) {
    if (k === 'pal') {
      if (Array.isArray(d.pal)) {
        const pal = d.pal.filter((c) => typeof c === 'string' && PAL_HEX.test(c)).slice(0, 32);
        if (pal.length >= 2) P.pal = pal;
      }
    } else if (k === 'keys') P.keys = cleanKeys(d.keys, CAN_ANIMATE);
    else if ((k === 'customImg' || k === 'frameImg') && !(pictures && /^data:image\/png;base64,/.test(d[k]))) continue;
    else if (CONTROL[k] && CONTROL[k].type !== 'button' && typeof d[k] === typeof CONTROL[k].def) P[k] = d[k];
  }
}
function readLink() {
  const m = /look=([\w-]+)/.exec(location.hash);
  if (!m) return false;
  try {
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    adopt(JSON.parse(json), false);
    lookId = '~link';
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- sources ----------
// Read the picture once and decide how to prepare it (see analyse in engine.js).
function renorm(drawable) {
  const nm = analyse(drawable, src.w, src.h, P.invert);
  engine.norm = nm;
  thumbEngine.norm = nm;
  return nm;
}

async function openSource(next, { keepOld = false } = {}) {
  let probe;
  if (next.kind === 'video') { await next.seek(next.duration * 0.35); probe = next.el; }
  else if (next.kind === 'gif') probe = next.frame(next.duration * 0.4);
  else probe = next.frame(0, 0.25);
  if (!keepOld && src && src !== next) { try { src.dispose(); } catch (e) { /* nothing to free */ } }
  src = next;
  t = 0;
  for (const k of PER_FILE) { P[k] = CONTROL[k].def; delete P.keys[k]; }
  painter.clear();
  const nm = renorm(probe);
  P.key = nm.lightBg ? 'auto' : 'none';
  if (src.kind === 'video') { src.el.currentTime = 0; if (playing) src.el.play().catch(() => {}); }
  updateFileCard();
  refreshAll();
  lastSig = '';
  setTimeout(renderThumbs, 60);
}

async function openFile(file) {
  if (!file || busy || recording) return;
  toast('Opening ' + (file.name || 'picture') + '…', 8000);
  try {
    const s = await loadFile(file);
    await openSource(s);
    toast(s.kind === 'video' ? 'Video loaded' : s.kind === 'gif' ? 'Animation loaded' : 'Picture loaded', 1400);
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : 'This file could not be opened.', 5000);
  }
}

// ---------- drawing ----------
const cmp = document.createElement('canvas');

function viewScale() {
  const r = viewport.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const m = r.width < 500 ? 10 : 24;
  const aw = Math.max(60, r.width - 2 * m) * dpr;
  const ah = Math.max(60, r.height - 2 * m) * dpr;
  const { W, H } = engine.outSize(P, 1);
  // Whole pixels per cell when that nearly fills the stage; otherwise render one step
  // larger and let the browser shrink it, so the picture always uses the space.
  const fit = Math.min(aw / W, ah / H);
  let k = Math.max(1, Math.floor(fit));
  if (fit / k > 1.12 && Math.max(W, H) * (k + 1) <= 3200) k += 1;
  return { k, aw, ah, dpr };
}

function draw() {
  const L = loopLen();
  const phase = L > 0 ? (t / L) % 1 : 0;
  const drawable = src.frame(srcTime(t), phase);
  const Pe = liveP(t);
  app.Pe = Pe;
  engine.render(Pe, drawable, src.w, src.h, t, L);
  const { k, aw, ah, dpr } = viewScale();
  if (compare) {
    const { pad, W, H } = engine.outSize(P, k);
    if (view.width !== W || view.height !== H) { view.width = W; view.height = H; }
    cmp.width = engine.w * k;
    cmp.height = engine.h * k;
    drawFrame(cmp.getContext('2d'), cmp.width, cmp.height, drawable, src.w, src.h, Pe);
    const ctx = view.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(cmp, pad * k, pad * k);
  } else {
    engine.compose(view, k, Pe, { transparent: P.transparent });
  }
  if (shapeNote) shapeNote.hidden = !(k < 3 && isShaped(Pe));
  view.classList.toggle('checker', P.transparent && !compare);
  view.style.imageRendering = view.width / dpr > aw / dpr + 1 || view.height / dpr > ah / dpr + 1 ? 'auto' : 'pixelated';
  const cw = view.width / dpr, ch = view.height / dpr;
  const f = Math.min(1, aw / dpr / cw, ah / dpr / ch);
  const sw = Math.round(cw * f * 100) / 100 + 'px', sh = Math.round(ch * f * 100) / 100 + 'px';
  if (view.style.width !== sw) view.style.width = sw;
  if (view.style.height !== sh) view.style.height = sh;
  $('#infoLabel').textContent = `${engine.w} × ${engine.h} px · ${livePalette(P).length} colours`;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastNow) / 1000 || 0);
  lastNow = now;
  if (busy || !src) return;
  const L = loopLen();
  if (src.kind === 'video') {
    const v = src.el;
    const a = P.trimA * src.duration, b = P.trimB * src.duration;
    if (playing) {
      if (v.playbackRate !== P.speed) v.playbackRate = P.speed;
      if (v.currentTime < a - 0.08 || v.currentTime >= b - 0.03) v.currentTime = a;
      if (v.paused && !v.seeking) v.play().catch(() => {});
    } else if (!v.paused) v.pause();
    t = clamp((v.currentTime - a) / P.speed, 0, L);
  } else if (playing) {
    t = (t + dt) % L;
  } else if (t >= L) t = 0;

  const moving = hasKeys() || P.cycle !== 0 || P.burst !== 'none';
  const timeLive = src.animated || moving || P.pulse > 0 || P.glint > 0 || P.intro !== 'none' || (P.tint !== 'none' && P.tint !== 'solid' && P.tintMove !== 0);
  const sig = Math.floor(t * P.rate + 1e-6) + '|' + (timeLive ? Math.round(t * 40) : 0) + '|' + viewport.clientWidth + 'x' + viewport.clientHeight;
  if (!dirty && sig === lastSig) return;
  lastSig = sig;
  dirty = false;
  try { draw(); } catch (e) { console.error(e); }
  // Keyframed sliders follow the playhead.
  const ph = L > 0 ? (t / L) % 1 : 0;
  if (ph !== lastKeyPhase) {
    lastKeyPhase = ph;
    for (const k in P.keys) updateControls(k);
  }
  const scrub = $('#scrub');
  if (document.activeElement !== scrub || playing) {
    scrub.value = L > 0 ? t / L : 0;
    scrub.style.setProperty('--p', (L > 0 ? (t / L) * 100 : 0) + '%');
  }
  $('#timeLabel').textContent = `${t.toFixed(1)} / ${L.toFixed(1)} s`;
}

// ---------- stage interaction ----------
function startPicking() {
  picking = true;
  viewport.classList.add('picking');
  $('#pickNote').hidden = false;
}
function stopPicking() {
  picking = false;
  viewport.classList.remove('picking');
  $('#pickNote').hidden = true;
}

function panRange() {
  // How far (in cells) the picture can slide, matching drawFrame.
  const W = engine.w, H = engine.h;
  const quarter = P.rot === 90 || P.rot === 270;
  const rw = quarter ? src.h : src.w, rh = quarter ? src.w : src.h;
  const base = P.fit === 'contain' ? Math.min(W / rw, H / rh) : Math.max(W / rw, H / rh);
  const s = base * shown('zoom');
  return { ox: Math.abs(rw * s - W) / 2, oy: Math.abs(rh * s - H) / 2 };
}

/** A pointer position as 0..1 across the picture (the margin is outside that range). */
function stagePoint(e) {
  const r = view.getBoundingClientRect();
  const { pad } = engine.outSize(P, 1);
  const cw = engine.w + 2 * pad, ch = engine.h + 2 * pad;
  return {
    x: (((e.clientX - r.left) / r.width) * cw - pad) / engine.w,
    y: (((e.clientY - r.top) / r.height) * ch - pad) / engine.h,
    perCss: cw / r.width,
  };
}

function strokeTo(stroke, p) {
  const aspect = engine.w / engine.h;
  // Dabs overlap along a stroke, so one pass at a low strength stays light.
  const flow = brush.flow >= 1 ? 1 : 1 - Math.pow(1 - brush.flow, 0.3);
  if (stroke.fresh) painter.dab(brush.tool, p.x, p.y, brush.size / 2, brush.soft, brush.color, flow, aspect);
  else painter.line(brush.tool, stroke.x, stroke.y, p.x, p.y, brush.size / 2, brush.soft, brush.color, flow, aspect);
  stroke.fresh = false;
  stroke.x = p.x;
  stroke.y = p.y;
  painter.sync();
  dirty = true;
}

function moveBrush(e) {
  if (!paintMode()) { brushEl.hidden = true; return; }
  const v = viewport.getBoundingClientRect();
  const p = stagePoint(e);
  const d = Math.max(4, (brush.size * Math.max(engine.w, engine.h)) / p.perCss);
  brushEl.hidden = false;
  brushEl.style.width = brushEl.style.height = d + 'px';
  brushEl.style.transform = `translate(${e.clientX - v.left - d / 2}px, ${e.clientY - v.top - d / 2}px)`;
}

function bindStage() {
  let drag = null;
  let stroke = null;
  brushEl = el('div.brush', { hidden: true });
  viewport.append(brushEl);
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !src || busy) return;
    if (picking) {
      const p = stagePoint(e);
      const x = Math.floor(p.x * engine.w), y = Math.floor(p.y * engine.h);
      if (x >= 0 && y >= 0 && x < engine.w && y < engine.h && engine.raw) {
        const j = (y * engine.w + x) * 4;
        const hex = '#' + [0, 1, 2].map((i) => engine.raw[j + i].toString(16).padStart(2, '0')).join('');
        setP('keyColor', hex);
      }
      stopPicking();
      return;
    }
    viewport.setPointerCapture(e.pointerId);
    if (paintMode()) {
      stroke = { x: 0, y: 0, fresh: true };
      strokeTo(stroke, stagePoint(e));
      return;
    }
    drag = { text: textMode(), x: e.clientX, y: e.clientY, px: shown('panX'), py: shown('panY'), tx: shown('textX'), ty: shown('textY') };
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || stroke) moveBrush(e);
    if (stroke) { strokeTo(stroke, stagePoint(e)); return; }
    if (!drag) return;
    const r = view.getBoundingClientRect();
    const { pad } = engine.outSize(P, 1);
    const perCss = (engine.w + 2 * pad) / r.width;
    if (drag.text) {
      setP('textX', clamp(Math.round((drag.tx + ((e.clientX - drag.x) * perCss) / engine.w) * 200) / 200, 0, 1));
      setP('textY', clamp(Math.round((drag.ty + ((e.clientY - drag.y) * perCss) / engine.h) * 200) / 200, 0, 1));
      return;
    }
    const { ox, oy } = panRange();
    if (ox > 0.5) setP('panX', clamp(drag.px + ((e.clientX - drag.x) * perCss) / ox, -1, 1));
    if (oy > 0.5) setP('panY', clamp(drag.py + ((e.clientY - drag.y) * perCss) / oy, -1, 1));
  });
  const end = () => {
    if (stroke) {
      stroke = null;
      painter.snapshot();
      commit();
    }
    drag = null;
    viewport.classList.remove('dragging');
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
  viewport.addEventListener('pointerleave', () => { if (!stroke) brushEl.hidden = true; });
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    setP('zoom', clamp(Math.round(shown('zoom') * Math.exp(-e.deltaY * 0.0015) * 100) / 100, 0.4, 5));
  }, { passive: false });

  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; $('#drop').hidden = false; e.preventDefault(); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#drop').hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    $('#drop').hidden = true;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });
  window.addEventListener('paste', (e) => {
    const f = e.clipboardData && [...e.clipboardData.files][0];
    if (f) { e.preventDefault(); openFile(f); }
  });
}

function setPlaying(on) {
  playing = on;
  $('#icoPlay').innerHTML = on ? '<path d="M7 5h3.500v14H7zM13.500 5H17v14h-3.500z"/>' : '<path d="M8 5.500v13l11-6.500z"/>';
  dirty = true;
}

function bindChrome() {
  $('#btnOpen').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnPlay').addEventListener('click', () => setPlaying(!playing));
  const cmpBtn = $('#btnCompare');
  const setCompare = (on) => { if (compare === on) return; compare = on; cmpBtn.classList.toggle('on', on); dirty = true; };
  cmpBtn.addEventListener('pointerdown', (e) => { cmpBtn.setPointerCapture(e.pointerId); setCompare(true); });
  cmpBtn.addEventListener('pointerup', () => setCompare(false));
  cmpBtn.addEventListener('pointercancel', () => setCompare(false));
  cmpBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') setCompare(true); });
  cmpBtn.addEventListener('keyup', () => setCompare(false));
  cmpBtn.addEventListener('blur', () => setCompare(false));

  const scrub = $('#scrub');
  scrub.addEventListener('input', () => {
    seekPhase(+scrub.value);
    scrub.style.setProperty('--p', +scrub.value * 100 + '%');
  });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'textarea' || (tag === 'input' && !['range', 'color', 'file'].includes(e.target.type));
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); runExport('png'); }
    else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#file').click(); }
    else if (e.key === ' ' && tag !== 'button') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'Escape' && picking) stopPicking();
  });
  window.addEventListener('resize', () => { dirty = true; });
  if (window.ResizeObserver) new ResizeObserver(() => { dirty = true; }).observe(viewport);
}

// ---------- start ----------
function start() {
  const saved = store('ng.state');
  if (!readLink() && saved && saved.P) {
    adopt(saved.P, true);
    lookId = saved.lookId || lookId;
  }
  sanitize();
  buildRail();
  buildPanel();
  bindStage();
  bindChrome();
  setPlaying(true);
  openSource(sampleSource('moon'));
  showTab(saved && saved.tab && tabEls[saved.tab] ? saved.tab : 'looks');
  commit();
  requestAnimationFrame(frame);
  setInterval(() => { if (activeTab === 'looks' && playing && src && src.animated) renderThumbs(); }, 2500);
}

start();

// Hooks for automated checks.
window.NG = {
  P, app, engine, painter, brush,
  set: (k, v) => setP(k, v),
  look: (id) => applyLook([...LOOKS, ...savedLooks].find((l) => l.id === id)),
  tab: showTab,
  open: openFile,
  sample: (id) => openSource(sampleSource(id)),
  seek: (tt) => { t = tt; dirty = true; },
  seekPhase,
  play: setPlaying,
  source: () => src,
  export: runExport,
  batch: runBatch,
  busy: () => busy || recording,
  key: toggleKey,
  customFromFile,
  frameFromFile,
  camera: useCamera,
  record: recordCamera,
  undo, redo,
  surprise,
  sleep,
};
