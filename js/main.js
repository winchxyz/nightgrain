// Nightgrain: app shell. Wires the engine to the stage, the panel and the exports.

import { clamp, el, debounce, downloadBlob, store, hslToHex, sleep } from './util.js';
import { Engine, drawFrame, analyse, SHAPES, paintShape, isShaped, shapeSet, livePalette } from './engine.js';
import { CONTROLS, CONTROL, TABS, LOOKS, KEEP, defaults, PALETTES, ALGOS } from './schema.js';
import { extractPalette, sortByLuma } from './palettes.js';
import { loadFile, sampleSource, SAMPLES } from './sources.js';
import { exportPNG, exportGIF, exportMP4, exportWebM, exportScale, canMP4 } from './export.js';

const $ = (s) => document.querySelector(s);
const view = $('#view');
const viewport = $('#viewport');
const panel = $('#panel');
const rail = $('#rail');
const help = $('#help');
const HELP_DEFAULT = 'Hover any control to see what it does. Double-click a slider name to reset it.';

const P = defaults();
const engine = new Engine();
const thumbEngine = new Engine();
let src = null;
let t = 0;
let playing = true;
let busy = false;
let dirty = true;
let compare = false;
let picking = false;
let lookId = 'relic';
let activeTab = 'looks';
let lastSig = '';
let lastNow = 0;
let savedLooks = store('ng.looks') || [];
let exportSignal = null;

const isClip = () => !!src && (src.kind === 'video' || src.kind === 'gif');
const showState = () => ({ clip: isClip() });

function loopLen() {
  if (isClip()) return Math.max(0.1, ((P.trimB - P.trimA) * src.duration) / P.speed);
  return P.loop;
}
const srcTime = (tt) => (isClip() ? P.trimA * src.duration + tt * P.speed : tt);

const app = {
  P,
  engine,
  loopLen,
  time: () => t,
  async renderAt(tt) {
    const L = loopLen();
    const st = srcTime(tt);
    if (src.kind === 'video') await src.seek(st);
    engine.render(P, src.frame(st, L > 0 ? (tt / L) % 1 : 0), src.w, src.h, tt, L);
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
const hist = [];
let hi = -1;
const snapshot = () => JSON.stringify({ P, lookId });
function commit() {
  const s = snapshot();
  if (hist[hi] === s) return;
  hist.length = hi + 1;
  hist.push(s);
  if (hist.length > 150) hist.shift();
  hi = hist.length - 1;
  store('ng.state', { P, lookId, tab: activeTab });
  syncHistoryButtons();
}
const commitSoon = debounce(commit, 350);
function restore(s) {
  const o = JSON.parse(s);
  Object.assign(P, o.P);
  P.pal = [...o.P.pal];
  lookId = o.lookId;
  refreshAll();
}
function undo() { if (hi > 0) { hi--; restore(hist[hi]); syncHistoryButtons(); } }
function redo() { if (hi < hist.length - 1) { hi++; restore(hist[hi]); syncHistoryButtons(); } }
function syncHistoryButtons() {
  $('#btnUndo').disabled = hi <= 0;
  $('#btnRedo').disabled = hi >= hist.length - 1;
}

// ---------- settings ----------
function setP(k, v, { silent = false } = {}) {
  if (k === 'trimA') v = Math.min(v, P.trimB - 0.02);
  if (k === 'trimB') v = Math.max(v, P.trimA + 0.02);
  if (P[k] === v) return;
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
  if (!silent) {
    updateControls(k);
    if (k === 'palHue' || k === 'palSat' || k === 'palLight') renderSwatches();
    refreshVisibility();
    if (KEEP.has(k) || k === 'invert') thumbsSoon();
    updateExportInfo();
    markLook();
  }
  commitSoon();
}

function applyLook(look) {
  const keep = {};
  for (const k of KEEP) keep[k] = P[k];
  const base = defaults();
  Object.assign(P, base, keep, look.p);
  P.pal = [...(look.p.pal || base.pal)];
  lookId = look.id;
  refreshAll();
  commit();
}

function surprise() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const r = (a, b) => a + Math.random() * (b - a);
  const chance = (p) => Math.random() < p;
  const keep = {};
  for (const k of KEEP) keep[k] = P[k];
  Object.assign(P, defaults(), keep);
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
  lookId = '~surprise';
  refreshAll();
  commit();
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
  export: '<path d="M12 4v11"/><path d="M7.500 10.500L12 15l4.500-4.500"/><path d="M5 19.500h14"/>',
};

function buildRail() {
  for (const tab of TABS) {
    const b = el('button', { type: 'button', 'data-tab': tab.id, html: `<svg viewBox="0 0 24 24">${ICONS[tab.id]}</svg><span>${tab.name}</span>`, onclick: () => showTab(tab.id) });
    rail.append(b);
  }
}

function showTab(id) {
  activeTab = id;
  for (const b of rail.children) b.classList.toggle('on', b.dataset.tab === id);
  for (const k in tabEls) tabEls[k].classList.toggle('on', k === id);
  panel.scrollTop = 0;
  if (id === 'looks') renderThumbs();
  if (id === 'export') updateExportInfo();
  store('ng.state', { P, lookId, tab: activeTab });
}

function pctOf(c, v) { return ((v - c.min) / (c.max - c.min)) * 100 + '%'; }

function buildControl(c) {
  let root;
  const id = c.id || c.k;
  const same = (a, b) => String(a) === String(b);
  if (c.type === 'range') {
    const out = el('output');
    const input = el('input', { type: 'range', min: c.min, max: c.max, step: c.step, 'aria-label': c.label });
    const head = el('div.ctl-head', { title: 'Double-click to reset' }, el('label', { text: c.label }), out);
    root = el('div.ctl', null, head, input);
    input.addEventListener('input', () => setP(c.k, +input.value));
    head.addEventListener('dblclick', () => setP(c.k, c.def));
    ui[id] = {
      root,
      update() {
        input.value = P[c.k];
        input.style.setProperty('--p', pctOf(c, P[c.k]));
        out.textContent = c.fmt ? c.fmt(P[c.k]) : P[c.k];
        root.classList.toggle('changed', P[c.k] !== c.def);
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
  } else if (c.type === 'shape') {
    // A grid of drawn shapes. One is picked, or several when shapes are mixed.
    const box = el('div.shape-grid');
    const label = el('label', { text: c.label });
    const btns = [];
    const dpr = Math.min(3, Math.ceil(window.devicePixelRatio || 1));
    for (const [sid, sname] of SHAPES) {
      const cv = el('canvas', { width: 22 * dpr, height: 22 * dpr });
      paintShape(cv.getContext('2d'), sid, 22 * dpr, 0.2, 0, 1);
      const b = el('button.shape-btn', { type: 'button', title: sname, 'aria-label': sname, onclick: () => pickShape(sid) }, cv);
      b._v = sid;
      btns.push(b);
      box.append(b);
    }
    root = el('div.ctl', null, el('div.ctl-head', null, label), box);
    ui[id] = {
      root,
      update() {
        const many = P.shapeMix !== 'none';
        const set = many ? shapeSet(P) : [P.shape];
        label.textContent = many ? 'Shapes in use' : 'Shape';
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
  for (const k in ui) {
    const c = ui[k].def;
    ui[k].root.hidden = c.show ? !c.show(P, S) : false;
  }
  for (const g of groups) g.hidden = g._ctls.every((k) => ui[k].root.hidden);
}

function refreshAll() {
  for (const k in ui) ui[k].update();
  refreshVisibility();
  renderSwatches();
  markPalette();
  markLook();
  updateExportInfo();
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

function saveLook() {
  const p = {};
  const base = defaults();
  for (const c of CONTROLS) if (!c.keep && P[c.k] !== base[c.k]) p[c.k] = P[c.k];
  p.pal = [...P.pal];
  const look = { id: 'my' + Date.now().toString(36), name: 'My look ' + (savedLooks.length + 1), p, saved: true };
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
    const lp = Object.assign({}, base, keep, look.p, { aspect: '1:1', pad: 0, intro: 'none' });
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
let fileName, fileSub;
function buildSourceHead(node) {
  fileName = el('div.name');
  fileSub = el('div.sub');
  const g = el('section.group', null, el('h3', { text: 'Picture' }),
    el('div.file-card', null, el('div.meta', null, fileName, fileSub), el('button.btn.small', { type: 'button', text: 'Open', onclick: () => $('#file').click() })),
    el('p.note', { text: 'Drop a file anywhere, or paste an image from the clipboard. Images, GIFs, animated WebP and video all work. Nothing leaves your computer.' }));
  const chips = el('div.chips');
  for (const s of SAMPLES) chips.append(el('button.chip', { type: 'button', text: s.name, 'data-hint': 'Try the editor with a built-in scene.', onclick: () => openSource(sampleSource(s.id)) }));
  g.append(el('div.ctl', null, el('div.ctl-head', null, el('label', { text: 'Or try a built-in scene' })), chips));
  node.append(g);
}
function buildSourceFoot(node) {
  node.append(el('section.group', null, el('div.row', null, el('button.btn', { type: 'button', text: 'Reset framing', 'data-hint': 'Put zoom, position, turn and mirror back to normal.', onclick: () => {
    for (const k of ['zoom', 'panX', 'panY', 'rot', 'flipX', 'flipY', 'fit', 'aspect']) setP(k, CONTROL[k].def);
  } }))));
}
function updateFileCard() {
  if (!src) return;
  fileName.textContent = src.name;
  const kind = { image: 'Image', gif: 'Animation', video: 'Video', sample: 'Built-in scene' }[src.kind];
  fileSub.textContent = `${kind} · ${src.w} × ${src.h}` + (isClip() ? ` · ${src.duration.toFixed(1)} s` : '');
}

// ---------- colour tab ----------
let swatchBox, palList, palCount = 5;
function buildColourTab(node) {
  swatchBox = el('div.swatches');
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
  if (lookId && !lookId.startsWith('~')) lookId = '~' + lookId;
  renderSwatches();
  markPalette();
  markLook();
  dirty = true;
  commitSoon();
}

function renderSwatches() {
  if (!swatchBox) return;
  swatchBox.textContent = '';
  // Swatches show the colours as drawn, with the "adjust all" sliders applied.
  livePalette(P).forEach((c, i) => {
    const input = el('input', { type: 'color', value: c, 'aria-label': i === 0 ? 'Backdrop colour' : 'Colour ' + i });
    const sw = el('div.swatch' + (i === 0 ? '.bg' : ''), { style: { background: c }, 'data-hint': i === 0 ? 'The backdrop. Everything dark falls into this colour.' : 'Click to change this colour.' }, input);
    input.addEventListener('input', () => {
      if (P.palHue || P.palSat !== 1 || P.palLight) {
        // Editing one colour by hand: make the adjusted colours the real palette first.
        P.pal = [...livePalette(P)];
        P.palHue = 0; P.palSat = 1; P.palLight = 0;
        for (const k of ['palHue', 'palSat', 'palLight']) updateControls(k);
      }
      P.pal[i] = input.value;
      sw.style.background = input.value;
      if (lookId && !lookId.startsWith('~')) lookId = '~' + lookId;
      markPalette();
      dirty = true;
      commitSoon();
    });
    if (i > 0 && P.pal.length > 2) {
      sw.append(el('button.x', { type: 'button', text: '×', title: 'Remove', onclick: () => setPal(P.pal.filter((_, j) => j !== i)) }));
    }
    swatchBox.append(sw);
  });
  if (P.pal.length < 32) {
    swatchBox.append(el('button.swatch.add', { type: 'button', text: '+', 'data-hint': 'Add a colour.', onclick: () => setPal([...P.pal, hslToHex(Math.random() * 360, 0.75, 0.6)]) }));
  }
}

function markPalette() {
  if (!palList) return;
  const sig = P.pal.join(',').toLowerCase();
  for (const b of palList.children) b.classList.toggle('on', PALETTES.find((p) => p.id === b._id).colors.join(',') === sig);
}

function shiftHues() {
  const turn = 40 + Math.random() * 280;
  const out = P.pal.map((hex, i) => {
    if (i === 0) return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d < 0.02) return hex;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return hslToHex(h * 60 + turn, Math.min(1, s), l);
  });
  setPal(out);
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

// ---------- export tab ----------
let exInfo, exBar, exStatus, exProgress, exButtons = [], exCancel;
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

async function runExport(kind) {
  if (busy || !src) return;
  busy = true;
  exportSignal = { cancelled: false };
  const wasPlaying = playing;
  const tKeep = t;
  if (src.kind === 'video') src.el.pause();
  for (const b of exButtons) b.disabled = true;
  const animated = kind === 'gif' || kind === 'video';
  exProgress.hidden = !animated;
  const progress = (f, label) => { exBar.style.width = Math.round(f * 100) + '%'; exStatus.textContent = label || ''; };
  progress(0, 'Starting');
  try {
    let res = null;
    if (kind === 'png' || kind === 'copy') {
      res = await exportPNG(app);
      if (kind === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': res.blob })]);
        toast('Copied to the clipboard');
      } else {
        downloadBlob(res.blob, `nightgrain-${stamp()}.png`);
        toast(`Saved PNG · ${res.w} × ${res.h} · ${sizeText(res.blob.size)}`);
      }
    } else if (kind === 'gif') {
      res = await exportGIF(app, progress, exportSignal);
      if (res) {
        downloadBlob(res.blob, `nightgrain-${stamp()}.gif`);
        toast(`Saved GIF · ${res.w} × ${res.h} · ${res.frames} frames · ${sizeText(res.blob.size)}`, 4200);
      }
    } else if (kind === 'video') {
      res = canMP4() ? await exportMP4(app, progress, exportSignal) : await exportWebM(app, progress, exportSignal);
      if (res) {
        downloadBlob(res.blob, `nightgrain-${stamp()}.${res.ext}`);
        toast(`Saved video · ${res.w} × ${res.h} · ${sizeText(res.blob.size)}`, 4200);
      }
    }
    if (!res && animated) toast('Cancelled');
    app.lastExport = res;
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : 'Something went wrong while saving.', 5000);
    app.lastExport = { error: String(e && e.message) };
  } finally {
    exProgress.hidden = true;
    for (const b of exButtons) b.disabled = false;
    busy = false;
    exportSignal = null;
    t = tKeep;
    playing = wasPlaying;
    if (src.kind === 'video') { src.el.currentTime = srcTime(t); if (playing) src.el.play().catch(() => {}); }
    dirty = true;
  }
}

function lookDiff() {
  const base = defaults();
  const d = {};
  for (const c of CONTROLS) if (!c.keep && P[c.k] !== base[c.k]) d[c.k] = P[c.k];
  d.pal = P.pal;
  return d;
}
async function copyLink() {
  const json = JSON.stringify(lookDiff());
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
function readLink() {
  const m = /look=([\w-]+)/.exec(location.hash);
  if (!m) return false;
  try {
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    const d = JSON.parse(json);
    for (const k in d) {
      if (k === 'pal' && Array.isArray(d.pal) && d.pal.length >= 2) P.pal = d.pal.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 32);
      else if (CONTROL[k] && typeof d[k] === typeof CONTROL[k].def) P[k] = d[k];
    }
    if (P.pal.length < 2) P.pal = defaults().pal;
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

async function openSource(next) {
  let probe;
  if (next.kind === 'video') { await next.seek(next.duration * 0.35); probe = next.el; }
  else if (next.kind === 'gif') probe = next.frame(next.duration * 0.4);
  else probe = next.frame(0, 0.25);
  if (src && src !== next) { try { src.dispose(); } catch (e) { /* nothing to free */ } }
  src = next;
  t = 0;
  for (const k of ['trimA', 'trimB', 'zoom', 'panX', 'panY', 'rot', 'flipX', 'flipY']) P[k] = CONTROL[k].def;
  const nm = renorm(probe);
  P.key = nm.lightBg ? 'auto' : 'none';
  if (src.kind === 'video') { src.el.currentTime = 0; if (playing) src.el.play().catch(() => {}); }
  updateFileCard();
  refreshAll();
  lastSig = '';
  setTimeout(renderThumbs, 60);
}

async function openFile(file) {
  if (!file || busy) return;
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
  engine.render(P, drawable, src.w, src.h, t, L);
  const { k, aw, ah, dpr } = viewScale();
  if (compare) {
    const { pad, W, H } = engine.outSize(P, k);
    if (view.width !== W || view.height !== H) { view.width = W; view.height = H; }
    cmp.width = engine.w * k;
    cmp.height = engine.h * k;
    drawFrame(cmp.getContext('2d'), cmp.width, cmp.height, drawable, src.w, src.h, P);
    const ctx = view.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(cmp, pad * k, pad * k);
  } else {
    engine.compose(view, k, P, { transparent: P.transparent });
  }
  if (shapeNote) shapeNote.hidden = !(k < 3 && isShaped(P));
  view.classList.toggle('checker', P.transparent && !compare);
  view.style.imageRendering = view.width / dpr > aw / dpr + 1 || view.height / dpr > ah / dpr + 1 ? 'auto' : 'pixelated';
  const cw = view.width / dpr, ch = view.height / dpr;
  const f = Math.min(1, aw / dpr / cw, ah / dpr / ch);
  const sw = Math.round(cw * f * 100) / 100 + 'px', sh = Math.round(ch * f * 100) / 100 + 'px';
  if (view.style.width !== sw) view.style.width = sw;
  if (view.style.height !== sh) view.style.height = sh;
  $('#infoLabel').textContent = `${engine.w} × ${engine.h} px · ${P.pal.length} colours`;
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

  const timeLive = src.animated || P.pulse > 0 || P.glint > 0 || P.intro !== 'none' || (P.tint !== 'none' && P.tint !== 'solid' && P.tintMove !== 0);
  const sig = Math.floor(t * P.rate + 1e-6) + '|' + (timeLive ? Math.round(t * 40) : 0) + '|' + viewport.clientWidth + 'x' + viewport.clientHeight;
  if (!dirty && sig === lastSig) return;
  lastSig = sig;
  dirty = false;
  try { draw(); } catch (e) { console.error(e); }
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
  const s = base * P.zoom;
  return { ox: Math.abs(rw * s - W) / 2, oy: Math.abs(rh * s - H) / 2 };
}

function bindStage() {
  let drag = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !src) return;
    if (picking) {
      const r = view.getBoundingClientRect();
      const { pad } = engine.outSize(P, 1);
      const cellsW = engine.w + 2 * pad, cellsH = engine.h + 2 * pad;
      const x = Math.floor(((e.clientX - r.left) / r.width) * cellsW) - pad;
      const y = Math.floor(((e.clientY - r.top) / r.height) * cellsH) - pad;
      if (x >= 0 && y >= 0 && x < engine.w && y < engine.h && engine.raw) {
        const j = (y * engine.w + x) * 4;
        const hex = '#' + [0, 1, 2].map((i) => engine.raw[j + i].toString(16).padStart(2, '0')).join('');
        setP('keyColor', hex);
      }
      stopPicking();
      return;
    }
    drag = { x: e.clientX, y: e.clientY, px: P.panX, py: P.panY };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = view.getBoundingClientRect();
    const { pad } = engine.outSize(P, 1);
    const perCss = (engine.w + 2 * pad) / r.width;
    const { ox, oy } = panRange();
    if (ox > 0.5) setP('panX', clamp(drag.px + ((e.clientX - drag.x) * perCss) / ox, -1, 1));
    if (oy > 0.5) setP('panY', clamp(drag.py + ((e.clientY - drag.y) * perCss) / oy, -1, 1));
  });
  const end = () => { drag = null; viewport.classList.remove('dragging'); };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    setP('zoom', clamp(Math.round(P.zoom * Math.exp(-e.deltaY * 0.0015) * 100) / 100, 0.4, 5));
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
    const L = loopLen();
    t = clamp(+scrub.value, 0, 0.9999) * L;
    scrub.style.setProperty('--p', +scrub.value * 100 + '%');
    if (src && src.kind === 'video') src.el.currentTime = srcTime(t);
    dirty = true;
  });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' && !['range', 'color'].includes(e.target.type);
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
    for (const k in saved.P) {
      if (k === 'pal' && Array.isArray(saved.P.pal) && saved.P.pal.length >= 2) P.pal = saved.P.pal;
      else if (CONTROL[k] && typeof saved.P[k] === typeof CONTROL[k].def) P[k] = saved.P[k];
    }
    lookId = saved.lookId || lookId;
  }
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
  P, app, engine,
  set: (k, v) => setP(k, v),
  look: (id) => applyLook([...LOOKS, ...savedLooks].find((l) => l.id === id)),
  tab: showTab,
  open: openFile,
  sample: (id) => openSource(sampleSource(id)),
  seek: (tt) => { t = tt; dirty = true; },
  play: setPlaying,
  source: () => src,
  export: runExport,
  busy: () => busy,
  surprise,
  sleep,
};
