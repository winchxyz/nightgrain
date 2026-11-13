// Every setting, its default, its control, and the ready-made looks.

import { ALGOS } from './dither.js';
import { PALETTES, paletteById } from './palettes.js';

const pct = (v) => Math.round(v * 100) + '%';
const num = (d) => (v) => (+v).toFixed(d);
const signed = (d) => (v) => (v > 0 ? '+' : '') + (+v).toFixed(d);

/**
 * type: range | chips | select | toggle | color
 * keep: true -> not part of a look (framing, clip, export); survives look changes.
 */
export const CONTROLS = [
  // ---- Source: framing ----
  { tab: 'source', group: 'Frame', k: 'aspect', type: 'chips', label: 'Shape', def: 'source', keep: true,
    options: [['source', 'Original'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:4', '3:4'], ['9:16', '9:16'], ['16:9', '16:9'], ['3:2', '3:2']],
    hint: 'The shape of the finished picture.' },
  { tab: 'source', group: 'Frame', k: 'fit', type: 'chips', label: 'Fit', def: 'cover', keep: true,
    options: [['cover', 'Fill'], ['contain', 'Whole picture']], hint: 'Fill crops to the shape. Whole picture keeps everything and pads with the backdrop.' },
  { tab: 'source', group: 'Frame', k: 'zoom', type: 'range', label: 'Zoom', min: 0.4, max: 5, step: 0.01, def: 1, keep: true, fmt: (v) => v.toFixed(2) + '×',
    hint: 'Zoom into the source. You can also scroll over the picture.' },
  { tab: 'source', group: 'Frame', k: 'panX', type: 'range', label: 'Move sideways', min: -1, max: 1, step: 0.01, def: 0, keep: true, fmt: signed(2),
    hint: 'Slide the source left or right. You can also drag the picture.' },
  { tab: 'source', group: 'Frame', k: 'panY', type: 'range', label: 'Move up or down', min: -1, max: 1, step: 0.01, def: 0, keep: true, fmt: signed(2),
    hint: 'Slide the source up or down. You can also drag the picture.' },
  { tab: 'source', group: 'Frame', k: 'rot', type: 'chips', label: 'Turn', def: 0, keep: true,
    options: [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']], hint: 'Turn the source in quarter steps.' },
  { tab: 'source', group: 'Frame', k: 'flipX', type: 'toggle', label: 'Mirror', def: false, keep: true, hint: 'Flip the source left to right.' },
  { tab: 'source', group: 'Frame', k: 'flipY', type: 'toggle', label: 'Upside down', def: false, keep: true, hint: 'Flip the source top to bottom.' },

  // ---- Source: clip ----
  { tab: 'source', group: 'Clip', k: 'trimA', type: 'range', label: 'Start', min: 0, max: 0.98, step: 0.001, def: 0, keep: true, fmt: pct, show: (P, S) => S.clip,
    hint: 'Where the clip starts, as a share of the whole video or GIF.' },
  { tab: 'source', group: 'Clip', k: 'trimB', type: 'range', label: 'End', min: 0.02, max: 1, step: 0.001, def: 1, keep: true, fmt: pct, show: (P, S) => S.clip,
    hint: 'Where the clip ends.' },
  { tab: 'source', group: 'Clip', k: 'speed', type: 'range', label: 'Speed', min: 0.25, max: 4, step: 0.05, def: 1, keep: true, fmt: (v) => v.toFixed(2) + '×', show: (P, S) => S.clip,
    hint: 'Play the clip slower or faster.' },
  { tab: 'source', group: 'Clip', k: 'loop', type: 'range', label: 'Loop length', min: 1, max: 12, step: 0.1, def: 4.8, keep: true, fmt: (v) => v.toFixed(1) + ' s', show: (P, S) => !S.clip,
    hint: 'How long one loop of the animation lasts. Exports use this length.' },

  // ---- Tone ----
  { tab: 'tone', group: 'Light', k: 'auto', type: 'toggle', label: 'Prepare automatically', def: true, keep: true,
    hint: 'Darkens and balances each picture first, so only its brighter parts light up, like the reference art. Turn off to work from the raw picture.' },
  { tab: 'tone', group: 'Light', k: 'exposure', type: 'range', label: 'Exposure', min: -3, max: 3, step: 0.01, def: 0, fmt: signed(2), hint: 'Overall brightness before dithering. Brighter means more pixels lit.' },
  { tab: 'tone', group: 'Light', k: 'contrast', type: 'range', label: 'Contrast', min: -1, max: 1, step: 0.01, def: 0.15, fmt: signed(2), hint: 'Push lights and darks apart. High contrast gives a punchier, sparser picture.' },
  { tab: 'tone', group: 'Light', k: 'black', type: 'range', label: 'Shadows cut', min: 0, max: 0.9, step: 0.005, def: 0.08, fmt: pct, hint: 'Everything darker than this falls into the backdrop. This is what makes the subject float in the dark.' },
  { tab: 'tone', group: 'Light', k: 'white', type: 'range', label: 'Highlights cut', min: 0.1, max: 1, step: 0.005, def: 1, fmt: pct, hint: 'Everything brighter than this becomes full brightness.' },
  { tab: 'tone', group: 'Light', k: 'gamma', type: 'range', label: 'Midtones', min: 0.3, max: 3, step: 0.01, def: 1.15, fmt: num(2), hint: 'Above 1 thins out the middle tones, below 1 fills them in.' },
  { tab: 'tone', group: 'Light', k: 'invert', type: 'toggle', label: 'Invert', def: false, hint: 'Swap light and dark. Useful for subjects on a white background.' },

  { tab: 'tone', group: 'Colour', k: 'sat', type: 'range', label: 'Saturation', min: 0, max: 3, step: 0.01, def: 1.2, fmt: num(2), hint: 'Stronger source colour makes the palette colours separate more clearly.' },
  { tab: 'tone', group: 'Colour', k: 'hue', type: 'range', label: 'Hue shift', min: -180, max: 180, step: 1, def: 0, fmt: (v) => signed(0)(v) + '°', hint: 'Rotate the source colours, which changes which palette colours get used.' },
  { tab: 'tone', group: 'Colour', k: 'temp', type: 'range', label: 'Warmth', min: -1, max: 1, step: 0.01, def: 0, fmt: signed(2), hint: 'Warmer leans on oranges, cooler leans on blues.' },

  { tab: 'tone', group: 'Detail', k: 'edge', type: 'range', label: 'Outline', min: 0, max: 3, step: 0.01, def: 0.35, fmt: num(2), hint: 'Trace bright lines along edges, like the rim light in the reference art.' },
  { tab: 'tone', group: 'Detail', k: 'edgeFill', type: 'range', label: 'Fill', min: 0, max: 1, step: 0.01, def: 1, fmt: pct, hint: 'How much of the picture stays inside the outlines. At 0 only the outlines remain.' },
  { tab: 'tone', group: 'Detail', k: 'sharpen', type: 'range', label: 'Sharpen', min: 0, max: 3, step: 0.01, def: 0.5, fmt: num(2), hint: 'Crisper small detail.' },
  { tab: 'tone', group: 'Detail', k: 'blur', type: 'range', label: 'Soften', min: 0, max: 8, step: 1, def: 0, fmt: num(0), hint: 'Blur the source first, for smoother, simpler shapes.' },

  { tab: 'tone', group: 'Isolate', k: 'key', type: 'chips', label: 'Remove background', def: 'none', keep: true,
    options: [['none', 'Off'], ['luma', 'Dark parts'], ['auto', 'Edge colour'], ['pick', 'Picked colour']],
    hint: 'Drop the background: by darkness, by the colour at the picture edges, or by a colour you pick.' },
  { tab: 'tone', group: 'Isolate', k: 'keyColor', type: 'color', label: 'Colour to remove', def: '#00b140', keep: true, show: (P) => P.key === 'pick', pick: true, hint: 'The background colour to remove. Use the dropper to pick it from the picture.' },
  { tab: 'tone', group: 'Isolate', k: 'keyTh', type: 'range', label: 'Reach', min: 0, max: 1, step: 0.005, def: 0.18, keep: true, fmt: pct, show: (P) => P.key !== 'none', hint: 'How much gets removed.' },
  { tab: 'tone', group: 'Isolate', k: 'keySoft', type: 'range', label: 'Soft edge', min: 0, max: 0.6, step: 0.005, def: 0.12, keep: true, fmt: pct, show: (P) => P.key !== 'none', hint: 'A soft edge fades out into scattered pixels instead of a hard cut.' },
  { tab: 'tone', group: 'Isolate', k: 'vig', type: 'range', label: 'Fade the corners', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'Let the picture dissolve into the backdrop toward the corners.' },
  { tab: 'tone', group: 'Isolate', k: 'vigSize', type: 'range', label: 'Fade starts at', min: 0, max: 1.4, step: 0.01, def: 0.6, fmt: num(2), show: (P) => P.vig > 0, hint: 'How far from the centre the fade begins.' },

  { tab: 'tone', group: 'Trails', k: 'wind', type: 'range', label: 'Dust trails', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'Bright parts smear to one side and break up into dust.' },
  { tab: 'tone', group: 'Trails', k: 'windDir', type: 'chips', label: 'Direction', def: 'left', show: (P) => P.wind > 0,
    options: [['left', 'Left'], ['right', 'Right'], ['up', 'Up'], ['down', 'Down']], hint: 'Which way the dust blows.' },
  { tab: 'tone', group: 'Trails', k: 'windLen', type: 'range', label: 'Length', min: 0.5, max: 0.99, step: 0.005, def: 0.93, fmt: num(2), show: (P) => P.wind > 0, hint: 'How far the trails reach.' },
  { tab: 'tone', group: 'Trails', k: 'windRows', type: 'range', label: 'How many rows', min: 0.05, max: 1, step: 0.01, def: 0.45, fmt: pct, show: (P) => P.wind > 0, hint: 'Only some rows get a trail, which keeps it looking like scattered dust.' },

  // ---- Dither ----
  { tab: 'dither', group: 'Pixels', k: 'grid', type: 'range', label: 'Resolution', min: 32, max: 640, step: 1, def: 256, fmt: (v) => Math.round(v) + ' px', hint: 'Pixels along the longer side. Fewer pixels means a chunkier picture.' },
  { tab: 'dither', group: 'Pattern', k: 'algo', type: 'algo', label: 'Dither', def: 'bayer8', hint: 'How the few palette colours are mixed into smooth tones.' },
  { tab: 'dither', group: 'Pattern', k: 'mode', type: 'chips', label: 'Colour from', def: 'match',
    options: [['match', 'Source colours'], ['ramp', 'Brightness']],
    hint: 'Source colours picks the nearest palette colours. Brightness walks through the palette from dark to light.' },
  { tab: 'dither', group: 'Pattern', k: 'amount', type: 'range', label: 'Mixing', min: 0, max: 1, step: 0.01, def: 1, fmt: pct, hint: 'How strongly colours are blended by dithering. At 0 you get flat poster shapes.' },
  { tab: 'dither', group: 'Pattern', k: 'bias', type: 'range', label: 'Density', min: -0.5, max: 0.5, step: 0.005, def: 0, fmt: signed(2), hint: 'Fewer or more lit pixels overall, without changing the source.' },
  { tab: 'dither', group: 'Pattern', k: 'pscale', type: 'range', label: 'Pattern size', min: 1, max: 6, step: 1, def: 1, fmt: (v) => Math.round(v) + '×', show: (P) => !isDiff(P.algo) && P.algo !== 'none', hint: 'Enlarge the dither pattern itself.' },
  { tab: 'dither', group: 'Pattern', k: 'serp', type: 'toggle', label: 'Alternate row direction', def: true, show: (P) => isDiff(P.algo), hint: 'Runs every other row backwards, which removes diagonal streaks.' },

  // ---- Motion ----
  { tab: 'motion', group: 'Grain', k: 'shimmer', type: 'range', label: 'Shimmer', min: 0, max: 1, step: 0.01, def: 0.35, fmt: pct, hint: 'The grain keeps reshuffling, so even a still picture feels alive.' },
  { tab: 'motion', group: 'Grain', k: 'rate', type: 'range', label: 'Shimmer speed', min: 1, max: 30, step: 1, def: 10, fmt: (v) => Math.round(v) + ' / s', hint: 'How many times per second the grain changes.' },
  { tab: 'motion', group: 'Grain', k: 'sparkle', type: 'range', label: 'Sparkles', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'Random pixels flash in the brightest colour.' },
  { tab: 'motion', group: 'Grain', k: 'driftX', type: 'range', label: 'Pattern drift sideways', min: -3, max: 3, step: 1, def: 0, fmt: signed(0), show: (P) => !isDiff(P.algo) && P.algo !== 'none', hint: 'The dither pattern slides sideways over the picture.' },
  { tab: 'motion', group: 'Grain', k: 'driftY', type: 'range', label: 'Pattern drift up or down', min: -3, max: 3, step: 1, def: 0, fmt: signed(0), show: (P) => !isDiff(P.algo) && P.algo !== 'none', hint: 'The dither pattern slides vertically over the picture.' },

  { tab: 'motion', group: 'Light', k: 'glint', type: 'range', label: 'Glint', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'A streak of light sweeps across the subject once per loop.' },
  { tab: 'motion', group: 'Light', k: 'glintAngle', type: 'range', label: 'Glint angle', min: -90, max: 90, step: 1, def: 25, fmt: (v) => Math.round(v) + '°', show: (P) => P.glint > 0, hint: 'The direction the streak travels.' },
  { tab: 'motion', group: 'Light', k: 'glintWidth', type: 'range', label: 'Glint width', min: 0.02, max: 0.4, step: 0.005, def: 0.1, fmt: num(2), show: (P) => P.glint > 0, hint: 'How wide the streak is.' },
  { tab: 'motion', group: 'Light', k: 'glintN', type: 'range', label: 'Sweeps per loop', min: 1, max: 4, step: 1, def: 1, fmt: num(0), show: (P) => P.glint > 0, hint: 'How many times the streak passes in one loop.' },
  { tab: 'motion', group: 'Light', k: 'pulse', type: 'range', label: 'Breathing', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'Brightness slowly rises and falls.' },
  { tab: 'motion', group: 'Light', k: 'pulseN', type: 'range', label: 'Breaths per loop', min: 1, max: 6, step: 1, def: 1, fmt: num(0), show: (P) => P.pulse > 0, hint: 'How many times it breathes in one loop.' },

  { tab: 'motion', group: 'Entrance', k: 'intro', type: 'chips', label: 'Appear', def: 'none',
    options: [['none', 'Off'], ['fade', 'Thicken'], ['dissolve', 'Dissolve'], ['up', 'Rise'], ['down', 'Fall'], ['side', 'Wipe'], ['radial', 'Bloom']],
    hint: 'How the picture assembles itself at the start of the loop.' },
  { tab: 'motion', group: 'Entrance', k: 'introLen', type: 'range', label: 'Takes', min: 0.05, max: 0.5, step: 0.01, def: 0.3, fmt: (v) => pct(v) + ' of loop', show: (P) => P.intro !== 'none', hint: 'How much of the loop the entrance takes.' },
  { tab: 'motion', group: 'Entrance', k: 'outro', type: 'toggle', label: 'Leave the same way', def: true, show: (P) => P.intro !== 'none', hint: 'The picture disappears at the end, so the loop closes cleanly.' },

  // ---- Finish ----
  { tab: 'finish', group: 'Pixel shape', k: 'shape', type: 'chips', label: 'Shape', def: 'square',
    options: [['square', 'Square'], ['gap', 'Tiles'], ['dot', 'Dots'], ['diamond', 'Diamonds'], ['rows', 'Rows'], ['cols', 'Columns']],
    hint: 'What each pixel looks like up close.' },
  { tab: 'finish', group: 'Pixel shape', k: 'gap', type: 'range', label: 'Gap', min: 0.05, max: 0.6, step: 0.01, def: 0.18, fmt: pct, show: (P) => P.shape !== 'square', hint: 'The space between pixels.' },
  { tab: 'finish', group: 'Screen', k: 'glow', type: 'range', label: 'Glow', min: 0, max: 1.5, step: 0.01, def: 0, fmt: num(2), hint: 'Lit pixels bleed light into the dark around them.' },
  { tab: 'finish', group: 'Screen', k: 'glowSize', type: 'range', label: 'Glow reach', min: 0.3, max: 4, step: 0.05, def: 1, fmt: num(2), show: (P) => P.glow > 0, hint: 'How far the glow spreads.' },
  { tab: 'finish', group: 'Screen', k: 'scan', type: 'range', label: 'Scanlines', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'Dark lines between rows, like an old monitor.' },
  { tab: 'finish', group: 'Screen', k: 'aberr', type: 'range', label: 'Colour fringe', min: 0, max: 3, step: 0.05, def: 0, fmt: num(2), hint: 'Red and blue split apart sideways, like a misaligned screen.' },
  { tab: 'finish', group: 'Canvas', k: 'pad', type: 'range', label: 'Margin', min: 0, max: 0.3, step: 0.005, def: 0, fmt: pct, hint: 'Empty backdrop around the picture.' },

  // ---- Export ----
  { tab: 'export', group: 'Size', k: 'exSize', type: 'chips', label: 'Longer side', def: 1024, keep: true,
    options: [[0, 'Pixel perfect'], [512, '512'], [1024, '1024'], [2048, '2048'], [4096, '4096']],
    hint: 'Pixel perfect saves one image pixel per art pixel. The others scale it up cleanly.' },
  { tab: 'export', group: 'Size', k: 'transparent', type: 'toggle', label: 'Transparent backdrop', def: false, keep: true, hint: 'Leave the backdrop empty in PNG and GIF files.' },
  { tab: 'export', group: 'Animation', k: 'fps', type: 'chips', label: 'Frames per second', def: 20, keep: true,
    options: [[10, '10'], [15, '15'], [20, '20'], [25, '25'], [30, '30'], [50, '50']], hint: 'Smoothness of GIF and video exports. GIFs play reliably up to 50.' },
];

function isDiff(a) {
  const d = ALGOS.find((x) => x.id === a);
  return !!d && d.group === 'Diffusion';
}

export const TABS = [
  { id: 'looks', name: 'Looks' },
  { id: 'source', name: 'Source' },
  { id: 'tone', name: 'Tone' },
  { id: 'dither', name: 'Dither' },
  { id: 'colour', name: 'Colour' },
  { id: 'motion', name: 'Motion' },
  { id: 'finish', name: 'Finish' },
  { id: 'export', name: 'Export' },
];

export function defaults() {
  const P = {};
  for (const c of CONTROLS) P[c.k] = c.def;
  P.pal = [...paletteById('relic').colors];
  return P;
}

export const KEEP = new Set(CONTROLS.filter((c) => c.keep).map((c) => c.k));
export const CONTROL = Object.fromEntries(CONTROLS.map((c) => [c.k, c]));

const pal = (id) => [...paletteById(id).colors];

/** Ready-made looks. Each lists only what differs from the defaults. */
export const LOOKS = [
  { id: 'relic', name: 'Relic', p: { pal: pal('relic') } },
  { id: 'vigil', name: 'Vigil', p: { pal: pal('vigil'), grid: 400, algo: 'floyd', black: 0.12, gamma: 1.3, shimmer: 0.3, edge: 0.5 } },
  { id: 'moonsteel', name: 'Moonsteel', p: { pal: pal('moonsteel'), algo: 'blue', mode: 'ramp', grid: 300, shimmer: 0.25, edge: 0.2, glow: 0.35 } },
  { id: 'forge', name: 'Forge', p: { pal: pal('forge'), algo: 'atkinson', mode: 'ramp', grid: 220, contrast: 0.3, glow: 0.7, glowSize: 1.4, shimmer: 0.45, sparkle: 0.15 } },
  { id: 'dust', name: 'Dust', p: { pal: pal('relic'), grid: 220, wind: 0.8, windLen: 0.95, windRows: 0.4, black: 0.14, shimmer: 0.5, intro: 'dissolve', introLen: 0.3 } },
  { id: 'stained', name: 'Stained glass', p: { pal: pal('rosewindow'), algo: 'bayer4', grid: 120, shape: 'gap', gap: 0.14, sat: 1.7, edge: 0.6, shimmer: 0.2 } },
  { id: 'phosphor', name: 'Phosphor', p: { pal: pal('phosphor'), algo: 'linesh', mode: 'ramp', grid: 200, scan: 0.45, glow: 0.8, glowSize: 1.2, shimmer: 0.15, edge: 0.5 } },
  { id: 'ultraviolet', name: 'Ultraviolet', p: { pal: pal('ultraviolet'), algo: 'blue', grid: 280, sparkle: 0.35, glow: 0.5, hue: -20, shimmer: 0.4, glint: 0.5 } },
  { id: 'onebit', name: 'One bit', p: { pal: pal('onebit'), algo: 'atkinson', grid: 320, contrast: 0.25, shimmer: 0.2, edge: 0.3, sat: 0 } },
  { id: 'goldleaf', name: 'Gold leaf', p: { pal: pal('goldleaf'), algo: 'stucki', mode: 'ramp', grid: 300, edge: 0.9, edgeFill: 0.75, shimmer: 0.25, glint: 0.6, glintWidth: 0.07 } },
  { id: 'etching', name: 'Etching', p: { pal: pal('bone'), algo: 'linesd', mode: 'ramp', grid: 280, edge: 1.2, edgeFill: 0.6, shimmer: 0.08, sharpen: 1 } },
  { id: 'ledwall', name: 'LED wall', p: { pal: pal('primaries'), algo: 'bayer4', grid: 96, shape: 'dot', gap: 0.2, glow: 0.9, glowSize: 1.1, sat: 1.6, shimmer: 0.15 } },
  { id: 'frost', name: 'Frost', p: { pal: pal('frost'), algo: 'white', mode: 'ramp', grid: 260, shimmer: 0.6, rate: 14, sparkle: 0.25, vig: 0.5 } },
  { id: 'signal', name: 'Signal', p: { pal: pal('cga'), algo: 'bayer2', grid: 160, aberr: 0.8, scan: 0.3, shimmer: 0.3, driftY: 1, sat: 1.5 } },
  { id: 'bloodmoon', name: 'Blood moon', p: { pal: pal('bloodmoon'), algo: 'sierra', mode: 'ramp', grid: 240, contrast: 0.35, glow: 0.4, pulse: 0.35, shimmer: 0.3 } },
  { id: 'pocket', name: 'Pocket', p: { pal: pal('gameboy'), algo: 'bayer4', mode: 'ramp', grid: 160, black: 0, gamma: 1, shimmer: 0, edge: 0.15 } },
  { id: 'riso', name: 'Riso print', p: { pal: pal('riso'), algo: 'cluster', grid: 240, black: 0, gamma: 1, contrast: 0.1, shimmer: 0.1, edge: 0, pscale: 1 } },
  { id: 'halo', name: 'Halo', p: { pal: pal('aurora'), algo: 'bayer8', grid: 200, edge: 1.6, edgeFill: 0.25, glow: 0.6, shimmer: 0.45, intro: 'radial', introLen: 0.25 } },
];

export { PALETTES, ALGOS, isDiff };
