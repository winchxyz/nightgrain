// Every setting, its default, its control, and the ready-made looks.

import { ALGOS } from './dither.js';
import { PALETTES, paletteById } from './palettes.js';
import { TOUCH_MODES } from './touch.js';

const pct = (v) => Math.round(v * 100) + '%';
const num = (d) => (v) => (+v).toFixed(d);
const signed = (d) => (v) => (v > 0 ? '+' : '') + (+v).toFixed(d);

/**
 * type: range | chips | algo | shape | toggle | color | text | button | hidden
 * keep: true -> not part of a look (framing, clip, words, export); survives look changes.
 * noAnim: true -> a slider that cannot be keyframed (it would resize the picture or the loop).
 * id: only when one setting appears in two tabs.
 */
export const CONTROLS = [
  // ---- Source: framing ----
  { tab: 'source', group: 'Frame', k: 'aspect', type: 'chips', label: 'Format', def: 'source', keep: true,
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

  // ---- Source: symmetry ----
  { tab: 'source', group: 'Mirror', k: 'sym', type: 'chips', label: 'Mirror', def: 'none', keep: true,
    options: [['none', 'Off'], ['h', 'Left to right'], ['v', 'Top to bottom'], ['quad', 'Four ways'], ['kal', 'Kaleidoscope']],
    hint: 'Mirror one half of the picture onto the other, or fold it into a kaleidoscope.' },
  { tab: 'source', group: 'Mirror', k: 'symN', type: 'range', label: 'Segments', min: 2, max: 16, step: 1, def: 6, keep: true, fmt: num(0), show: (P) => P.sym === 'kal',
    hint: 'How many mirrored pairs of wedges the kaleidoscope has.' },
  { tab: 'source', group: 'Mirror', k: 'symTurn', type: 'range', label: 'Turn', min: -180, max: 180, step: 1, def: 0, keep: true, fmt: (v) => signed(0)(v) + '°', show: (P) => P.sym === 'kal',
    hint: 'Which slice of the picture the kaleidoscope repeats. Give it keyframes and the pattern keeps changing.' },

  // ---- Source: frame shape ----
  { tab: 'source', group: 'Frame shape', k: 'frame', type: 'chips', label: 'Cut the picture to', def: 'none', keep: true,
    options: [['none', 'Rectangle'], ['round', 'Rounded'], ['circle', 'Circle'], ['diamond', 'Diamond'], ['hex', 'Hexagon'], ['star', 'Star'], ['heart', 'Heart'], ['custom', 'My image']],
    hint: 'Keep only the part of the picture inside a shape. My image uses the outline of a picture you choose.' },
  { k: 'frameImg', type: 'hidden', def: '', keep: true },
  { tab: 'source', group: 'Frame shape', k: 'frameSize', type: 'range', label: 'Size', min: 0.3, max: 1, step: 0.01, def: 1, keep: true, fmt: pct, show: (P) => P.frame !== 'none',
    hint: 'How much of the frame the shape fills.' },
  { tab: 'source', group: 'Frame shape', k: 'frameRound', type: 'range', label: 'Corner radius', min: 0.02, max: 0.5, step: 0.01, def: 0.16, keep: true, fmt: pct, show: (P) => P.frame === 'round',
    hint: 'How round the corners are.' },
  { tab: 'source', group: 'Frame shape', k: 'frameSoft', type: 'range', label: 'Soft edge', min: 0, max: 0.3, step: 0.005, def: 0.01, keep: true, fmt: pct, show: (P) => P.frame !== 'none',
    hint: 'A soft edge dissolves into scattered pixels instead of a clean cut.' },
  { tab: 'source', group: 'Frame shape', k: 'frameBtn', type: 'button', label: 'Choose another image', action: 'pickFrame', show: (P) => P.frame === 'custom',
    hint: 'Pick a picture with a transparent background, or a dark shape on white. Its outline becomes the frame.' },

  // ---- Source: clip ----
  { tab: 'source', group: 'Clip', k: 'trimA', type: 'range', label: 'Start', min: 0, max: 0.98, step: 0.001, def: 0, keep: true, noAnim: true, fmt: pct, show: (P, S) => S.clip,
    hint: 'Where the clip starts, as a share of the whole video or GIF.' },
  { tab: 'source', group: 'Clip', k: 'trimB', type: 'range', label: 'End', min: 0.02, max: 1, step: 0.001, def: 1, keep: true, noAnim: true, fmt: pct, show: (P, S) => S.clip,
    hint: 'Where the clip ends.' },
  { tab: 'source', group: 'Clip', k: 'speed', type: 'range', label: 'Speed', min: 0.25, max: 4, step: 0.05, def: 1, keep: true, noAnim: true, fmt: (v) => v.toFixed(2) + '×', show: (P, S) => S.clip,
    hint: 'Play the clip slower or faster.' },
  { tab: 'source', group: 'Clip', k: 'loop', type: 'range', label: 'Loop length', min: 1, max: 12, step: 0.1, def: 4.8, keep: true, noAnim: true, fmt: (v) => v.toFixed(1) + ' s', show: (P, S) => !S.clip,
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
  { tab: 'dither', group: 'Pixels', k: 'grid', type: 'range', label: 'Resolution', min: 32, max: 640, step: 1, def: 256, noAnim: true, fmt: (v) => Math.round(v) + ' px', hint: 'Pixels along the longer side. Fewer pixels means a chunkier picture.' },
  { tab: 'dither', group: 'Pattern', k: 'algo', type: 'algo', label: 'Dither', def: 'bayer8', hint: 'How the few palette colours are mixed into smooth tones.' },
  { tab: 'dither', group: 'Pattern', k: 'mode', type: 'chips', label: 'Colour from', def: 'match',
    options: [['match', 'Source colours'], ['ramp', 'Brightness']],
    hint: 'Source colours picks the nearest palette colours. Brightness walks through the palette from dark to light.' },
  { tab: 'dither', group: 'Pattern', k: 'amount', type: 'range', label: 'Mixing', min: 0, max: 1, step: 0.01, def: 1, fmt: pct, hint: 'How strongly colours are blended by dithering. At 0 you get flat poster shapes.' },
  { tab: 'dither', group: 'Pattern', k: 'bias', type: 'range', label: 'Density', min: -0.5, max: 0.5, step: 0.005, def: 0, fmt: signed(2), hint: 'Fewer or more lit pixels overall, without changing the source.' },
  { tab: 'dither', group: 'Pattern', k: 'pscale', type: 'range', label: 'Pattern size', min: 1, max: 6, step: 1, def: 1, fmt: (v) => Math.round(v) + '×', show: (P) => !isDiff(P.algo) && P.algo !== 'none', hint: 'Enlarge the dither pattern itself.' },
  { tab: 'dither', group: 'Pattern', k: 'serp', type: 'toggle', label: 'Alternate row direction', def: true, show: (P) => isDiff(P.algo), hint: 'Runs every other row backwards, which removes diagonal streaks.' },

  // ---- Motion ----
  { tab: 'motion', group: 'Touch', k: 'touch', type: 'chips', label: 'The picture reacts to the pointer', options: TOUCH_MODES, def: 'off', keep: true,
    hint: 'Move the mouse or a finger over the picture. Glow: light follows it. Water: ripples spread. Smear: the picture drags like wet paint. Repel: pixels move out of the way. While this is on, dragging plays with the picture instead of moving it.' },
  { tab: 'motion', group: 'Touch', k: 'touchAmt', type: 'range', label: 'Strength', min: 0.2, max: 2.5, step: 0.05, def: 1, keep: true, noAnim: true, fmt: pct, show: (P) => P.touch !== 'off',
    hint: 'How strongly the picture answers.' },
  { tab: 'motion', group: 'Touch', k: 'touchSize', type: 'range', label: 'Size', min: 0.4, max: 3, step: 0.05, def: 1, keep: true, noAnim: true, fmt: pct, show: (P) => P.touch !== 'off',
    hint: 'How wide the pointer reaches.' },
  { tab: 'motion', group: 'Touch', k: 'touchLast', type: 'range', label: 'Lasts', min: 0.3, max: 4, step: 0.05, def: 1, keep: true, noAnim: true, fmt: pct, show: (P) => P.touch !== 'off',
    hint: 'How long the trace stays after the pointer has moved on.' },
  { tab: 'motion', group: 'Touch', id: 'touchRec', type: 'button', label: 'Record what I do', action: 'recordStage', show: (P) => P.touch !== 'off',
    hint: 'Record the picture live while you play with it, up to a minute, and save it as a video. Saved pictures, GIFs and rendered videos do not include the touch effect; this recording does.' },
  { tab: 'motion', group: 'Grain', k: 'shimmer', type: 'range', label: 'Shimmer', min: 0, max: 1, step: 0.01, def: 0.35, fmt: pct, hint: 'The grain keeps reshuffling, so even a still picture feels alive.' },
  { tab: 'motion', group: 'Grain', k: 'rate', type: 'range', label: 'Shimmer speed', min: 1, max: 30, step: 1, def: 10, noAnim: true, fmt: (v) => Math.round(v) + ' / s', hint: 'How many times per second the grain changes.' },
  { tab: 'motion', group: 'Grain', k: 'sparkle', type: 'range', label: 'Sparkles', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'Random pixels flash in the brightest colour.' },
  { tab: 'motion', group: 'Grain', k: 'driftX', type: 'range', label: 'Pattern drift sideways', min: -3, max: 3, step: 1, def: 0, fmt: signed(0), show: (P) => !isDiff(P.algo) && P.algo !== 'none', hint: 'The dither pattern slides sideways over the picture.' },
  { tab: 'motion', group: 'Grain', k: 'driftY', type: 'range', label: 'Pattern drift up or down', min: -3, max: 3, step: 1, def: 0, fmt: signed(0), show: (P) => !isDiff(P.algo) && P.algo !== 'none', hint: 'The dither pattern slides vertically over the picture.' },

  { tab: 'motion', group: 'Light', k: 'glint', type: 'range', label: 'Glint', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'A streak of light sweeps across the subject once per loop.' },
  { tab: 'motion', group: 'Light', k: 'glintAngle', type: 'range', label: 'Glint angle', min: -90, max: 90, step: 1, def: 25, fmt: (v) => Math.round(v) + '°', show: (P) => P.glint > 0, hint: 'The direction the streak travels.' },
  { tab: 'motion', group: 'Light', k: 'glintWidth', type: 'range', label: 'Glint width', min: 0.02, max: 0.4, step: 0.005, def: 0.1, fmt: num(2), show: (P) => P.glint > 0, hint: 'How wide the streak is.' },
  { tab: 'motion', group: 'Light', k: 'glintN', type: 'range', label: 'Sweeps per loop', min: 1, max: 4, step: 1, def: 1, fmt: num(0), show: (P) => P.glint > 0, hint: 'How many times the streak passes in one loop.' },
  { tab: 'motion', group: 'Light', k: 'glintDark', type: 'range', label: 'Dark outside the glint', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, show: (P) => P.glint > 0,
    hint: 'Dims everything the streak is not touching, so it passes over the subject like a torch in the dark.' },
  { tab: 'motion', group: 'Light', k: 'pulse', type: 'range', label: 'Breathing', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'Brightness slowly rises and falls.' },
  { tab: 'motion', group: 'Light', k: 'pulseN', type: 'range', label: 'Breaths per loop', min: 1, max: 6, step: 1, def: 1, fmt: num(0), show: (P) => P.pulse > 0, hint: 'How many times it breathes in one loop.' },

  { tab: 'motion', group: 'Entrance', k: 'intro', type: 'chips', label: 'Appear', def: 'none',
    options: [['none', 'Off'], ['fade', 'Thicken'], ['dissolve', 'Dissolve'], ['up', 'Rise'], ['down', 'Fall'], ['side', 'Wipe'], ['radial', 'Bloom']],
    hint: 'How the picture assembles itself at the start of the loop.' },
  { tab: 'motion', group: 'Entrance', k: 'introLen', type: 'range', label: 'Takes', min: 0.05, max: 0.5, step: 0.01, def: 0.3, fmt: (v) => pct(v) + ' of loop', show: (P) => P.intro !== 'none', hint: 'How much of the loop the entrance takes.' },
  { tab: 'motion', group: 'Entrance', k: 'outro', type: 'toggle', label: 'Leave the same way', def: true, show: (P) => P.intro !== 'none', hint: 'The picture disappears at the end, so the loop closes cleanly.' },

  { tab: 'motion', group: 'Break apart', k: 'burst', type: 'chips', label: 'Pixels fly', def: 'none',
    options: [['none', 'Off'], ['explode', 'Outward'], ['scatter', 'Everywhere'], ['fall', 'Down'], ['rise', 'Up'], ['blow', 'Sideways'], ['swirl', 'In a swirl']],
    hint: 'The picture breaks into loose pixels that fly off, and gathers itself back.' },
  { tab: 'motion', group: 'Break apart', k: 'burstWhen', type: 'chips', label: 'When', def: 'both', show: (P) => P.burst !== 'none',
    options: [['both', 'Gather, then break'], ['start', 'Gather at the start'], ['end', 'Break at the end']],
    hint: 'Gather at the start, break at the end, or both, which makes the loop close cleanly.' },
  { tab: 'motion', group: 'Break apart', k: 'burstLen', type: 'range', label: 'Takes', min: 0.05, max: 0.5, step: 0.01, def: 0.3, fmt: (v) => pct(v) + ' of loop', show: (P) => P.burst !== 'none', hint: 'How much of the loop the flight takes.' },
  { tab: 'motion', group: 'Break apart', k: 'burstDist', type: 'range', label: 'Distance', min: 0.1, max: 2, step: 0.01, def: 0.8, fmt: num(2), show: (P) => P.burst !== 'none', hint: 'How far the pixels travel.' },
  { tab: 'motion', group: 'Break apart', k: 'burstStagger', type: 'range', label: 'One by one', min: 0, max: 1, step: 0.01, def: 0.6, fmt: pct, show: (P) => P.burst !== 'none', hint: 'At 0 every pixel leaves at once. Higher lets them go a few at a time.' },

  { tab: 'motion', group: 'Colour cycling', k: 'cycle', type: 'range', label: 'Turns per loop', min: -4, max: 4, step: 1, def: 0, noAnim: true, fmt: signed(0),
    hint: 'The palette keeps changing while the picture stays. 0 is off; whole turns keep the loop seamless.' },
  { tab: 'motion', group: 'Colour cycling', k: 'cycleMode', type: 'chips', label: 'How', def: 'hue', show: (P) => P.cycle !== 0,
    options: [['hue', 'Hues turn'], ['shift', 'Colours swap places']],
    hint: 'Turn every colour smoothly around the colour wheel, or step the palette colours along one place at a time.' },

  // ---- Colour (the palette itself is built by hand in main.js) ----
  { tab: 'colour', group: 'Adjust all colours', k: 'palHue', type: 'range', label: 'Hue', min: -180, max: 180, step: 1, def: 0, fmt: (v) => signed(0)(v) + '°',
    hint: 'Turn every palette colour around the colour wheel at once. The backdrop stays as it is.' },
  { tab: 'colour', group: 'Adjust all colours', k: 'palSat', type: 'range', label: 'Vividness', min: 0, max: 2, step: 0.01, def: 1, fmt: num(2),
    hint: 'Make every palette colour more vivid, or wash them out toward grey.' },
  { tab: 'colour', group: 'Adjust all colours', k: 'palLight', type: 'range', label: 'Lightness', min: -0.5, max: 0.5, step: 0.01, def: 0, fmt: signed(2),
    hint: 'Make every palette colour lighter or darker.' },

  { tab: 'colour', group: 'Tint the picture', k: 'tint', type: 'chips', label: 'Tint', def: 'none',
    options: [['none', 'Off'], ['solid', 'One colour'], ['linear', 'Gradient'], ['radial', 'From the centre'], ['tone', 'By brightness'], ['rainbow', 'Rainbow']],
    hint: 'Colour the picture before it is dithered, so different palette colours light up in different places.' },
  { tab: 'colour', group: 'Tint the picture', k: 'tintA', type: 'color', label: 'Tint colour', def: '#2573ed', show: (P) => P.tint !== 'none' && P.tint !== 'rainbow',
    hint: 'The tint. In a gradient this is where it starts; by brightness this is the colour of the dark parts.' },
  { tab: 'colour', group: 'Tint the picture', k: 'tintB', type: 'color', label: 'Second colour', def: '#f8932e', show: (P) => ['linear', 'radial', 'tone'].includes(P.tint),
    hint: 'Where the gradient ends; by brightness this is the colour of the bright parts.' },
  { tab: 'colour', group: 'Tint the picture', k: 'tintAmt', type: 'range', label: 'Strength', min: 0, max: 1, step: 0.01, def: 0.85, fmt: pct, show: (P) => P.tint !== 'none',
    hint: 'How much of the picture\'s own colour the tint replaces.' },
  { tab: 'colour', group: 'Tint the picture', k: 'tintAngle', type: 'range', label: 'Direction', min: -180, max: 180, step: 1, def: 90, fmt: (v) => Math.round(v) + '°', show: (P) => P.tint === 'linear' || P.tint === 'rainbow',
    hint: 'Which way the colours run across the picture. 90° is top to bottom.' },
  { tab: 'colour', group: 'Tint the picture', k: 'tintMove', type: 'range', label: 'Flow', min: -3, max: 3, step: 1, def: 0, fmt: signed(0), show: (P) => P.tint !== 'none' && P.tint !== 'solid',
    hint: 'The colours travel through the picture this many times per loop.' },

  // ---- Shape ----
  { tab: 'shape', group: 'Pixel shape', k: 'shapeMix', type: 'chips', label: 'Use', def: 'none',
    options: [['none', 'One shape'], ['colour', 'One per colour'], ['random', 'Scattered']],
    hint: 'One shape for every pixel, a different shape for each palette colour, or several shapes scattered at random.' },
  { tab: 'shape', group: 'Pixel shape', k: 'shape', type: 'shape', label: 'Shape', def: 'square', also: ['shapeMix', 'shapeSet'],
    hint: 'What each pixel looks like up close. With several shapes in use, click to add or remove one.' },
  { k: 'shapeSet', type: 'hidden', def: 'dot,diamond,plus,spark' },
  { tab: 'shape', group: 'Pixel shape', k: 'gap', type: 'range', label: 'Spacing', min: 0.05, max: 0.6, step: 0.01, def: 0.18, fmt: pct, show: (P) => (P.shape !== 'square' || P.shapeMix !== 'none'),
    hint: 'The space between pixels. More spacing makes each shape smaller.' },
  { tab: 'shape', group: 'Pixel shape', k: 'shapeRot', type: 'range', label: 'Turn', min: 0, max: 345, step: 15, def: 0, fmt: (v) => Math.round(v) + '°', show: (P) => (P.shape !== 'square' || P.shapeMix !== 'none'),
    hint: 'Turn every shape. Try it with triangles, hearts and arrows.' },
  { tab: 'shape', group: 'Pixel shape', k: 'shapeVar', type: 'range', label: 'Size follows brightness', min: 0, max: 1, step: 0.01, def: 0, fmt: pct,
    hint: 'Darker palette colours get smaller pixels and brighter ones stay large, which adds depth.' },
  { tab: 'shape', group: 'Your own pixel', k: 'customBtn', type: 'button', label: 'Use an image as the pixel', action: 'pickCustom',
    hint: 'Pick a small picture, logo or icon. Every pixel of the art becomes a copy of it. It joins the shapes above.' },
  { tab: 'shape', group: 'Your own pixel', k: 'customGlyph', type: 'text', label: 'Or type a letter or emoji', def: '', single: true, max: 4,
    hint: 'One character, such as ★ or 🙂 or A, used as the pixel.' },
  { k: 'customImg', type: 'hidden', def: '' },
  { tab: 'shape', group: 'Your own pixel', k: 'customTint', type: 'toggle', label: 'Paint it with palette colours', def: true, show: (P) => !!(P.customImg || P.customGlyph),
    hint: 'On: only its outline is used and the palette colours it. Off: it keeps its own colours.' },

  { tab: 'shape', group: 'Pixel size', id: 'grid2', k: 'grid', type: 'range', label: 'Resolution', min: 32, max: 640, step: 1, def: 256, noAnim: true, fmt: (v) => Math.round(v) + ' px',
    hint: 'Shapes need room. Fewer pixels across the picture means bigger ones that you can actually see.' },

  // ---- Text ----
  { tab: 'text', group: 'Words', k: 'text', type: 'text', label: 'Words on the picture', def: '', keep: true, max: 400,
    hint: 'Type something. The words are dithered together with the picture. Drag them on the picture to move them.' },
  { tab: 'text', group: 'Words', k: 'textFont', type: 'chips', label: 'Typeface', def: 'sans', keep: true, show: (P) => !!P.text,
    options: [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']], hint: 'The style of the letters.' },
  { tab: 'text', group: 'Words', k: 'textUpper', type: 'toggle', label: 'Capitals', def: true, keep: true, show: (P) => !!P.text, hint: 'Set the words in capital letters.' },
  { tab: 'text', group: 'Words', k: 'textSize', type: 'range', label: 'Size', min: 0.03, max: 0.6, step: 0.005, def: 0.11, keep: true, fmt: pct, show: (P) => !!P.text, hint: 'Letter height as a share of the picture height.' },
  { tab: 'text', group: 'Words', k: 'textSpace', type: 'range', label: 'Letter spacing', min: -0.05, max: 0.8, step: 0.01, def: 0.12, keep: true, fmt: num(2), show: (P) => !!P.text, hint: 'Space between the letters.' },
  { tab: 'text', group: 'Words', k: 'textColor', type: 'color', label: 'Colour', def: '#ffffff', keep: true, show: (P) => !!P.text, hint: 'The colour of the words before dithering. The palette decides the final colours.' },
  { tab: 'text', group: 'Place', k: 'textX', type: 'range', label: 'Across', min: 0, max: 1, step: 0.005, def: 0.5, keep: true, fmt: pct, show: (P) => !!P.text, hint: 'Left to right. You can also drag the words on the picture.' },
  { tab: 'text', group: 'Place', k: 'textY', type: 'range', label: 'Up and down', min: 0, max: 1, step: 0.005, def: 0.88, keep: true, fmt: pct, show: (P) => !!P.text, hint: 'Top to bottom. You can also drag the words on the picture.' },
  { tab: 'text', group: 'Place', k: 'textRot', type: 'range', label: 'Turn', min: -180, max: 180, step: 1, def: 0, keep: true, fmt: (v) => signed(0)(v) + '°', show: (P) => !!P.text, hint: 'Turn the words.' },

  // ---- Finish ----
  { tab: 'finish', group: 'Screen', k: 'glow', type: 'range', label: 'Glow', min: 0, max: 1.5, step: 0.01, def: 0, fmt: num(2), hint: 'Lit pixels bleed light into the dark around them.' },
  { tab: 'finish', group: 'Screen', k: 'glowSize', type: 'range', label: 'Glow reach', min: 0.3, max: 4, step: 0.05, def: 1, fmt: num(2), show: (P) => P.glow > 0, hint: 'How far the glow spreads.' },
  { tab: 'finish', group: 'Screen', k: 'scan', type: 'range', label: 'Scanlines', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, hint: 'Dark lines between rows, like an old monitor.' },
  { tab: 'finish', group: 'Screen', k: 'aberr', type: 'range', label: 'Colour fringe', min: 0, max: 3, step: 0.05, def: 0, fmt: num(2), hint: 'Red and blue split apart sideways, like a misaligned screen.' },
  { tab: 'finish', group: 'Highlights', k: 'bloom', type: 'range', label: 'Bloom', min: 0, max: 2, step: 0.01, def: 0, fmt: num(2),
    hint: 'Only the brightest pixels pour light out, far and soft, the way a lens overexposes.' },
  { tab: 'finish', group: 'Highlights', k: 'bloomSize', type: 'range', label: 'Bloom reach', min: 0.3, max: 3, step: 0.05, def: 1, fmt: num(2), show: (P) => P.bloom > 0,
    hint: 'How far the bloom spreads.' },
  { tab: 'finish', group: 'Highlights', k: 'bloomTint', type: 'range', label: 'Bloom tint', min: 0, max: 1, step: 0.01, def: 0, fmt: pct, show: (P) => P.bloom > 0 || P.streak > 0 || P.ring > 0,
    hint: 'Colour the spilled light instead of leaving it the colour of the pixels it comes from.' },
  { tab: 'finish', group: 'Highlights', k: 'bloomColor', type: 'color', label: 'Tint colour', def: '#9d8cff', show: (P) => P.bloomTint > 0 && (P.bloom > 0 || P.streak > 0 || P.ring > 0),
    hint: 'The colour of the tinted light.' },
  { tab: 'finish', group: 'Highlights', k: 'streak', type: 'range', label: 'Streaks', min: 0, max: 1, step: 0.01, def: 0, fmt: pct,
    hint: 'Thin flares shoot sideways out of the brightest pixels.' },
  { tab: 'finish', group: 'Highlights', k: 'ring', type: 'range', label: 'Lens ring', min: 0, max: 1, step: 0.01, def: 0, fmt: pct,
    hint: 'A faint ring of stray light around the frame. It brightens and fades with the picture.' },
  { tab: 'finish', group: 'Highlights', k: 'ringSize', type: 'range', label: 'Ring size', min: 0.5, max: 1.6, step: 0.01, def: 1, fmt: num(2), show: (P) => P.ring > 0,
    hint: 'How wide the ring is.' },
  { tab: 'finish', group: 'Highlights', k: 'hot', type: 'range', label: 'Highlights start at', min: 0.2, max: 1, step: 0.01, def: 0.72, fmt: pct, show: (P) => P.bloom > 0 || P.streak > 0,
    hint: 'How bright a pixel has to be to count as a highlight. Lower it and more of the picture glows.' },
  { tab: 'finish', group: 'Canvas', k: 'pad', type: 'range', label: 'Margin', min: 0, max: 0.3, step: 0.005, def: 0, noAnim: true, fmt: pct, hint: 'Empty backdrop around the picture.' },

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
  { id: 'shape', name: 'Shape' },
  { id: 'paint', name: 'Paint' },
  { id: 'text', name: 'Text' },
  { id: 'motion', name: 'Motion' },
  { id: 'finish', name: 'Finish' },
  { id: 'export', name: 'Export' },
];

export function defaults() {
  const P = {};
  for (const c of CONTROLS) if (c.type !== 'button') P[c.k] = c.def;
  P.pal = [...paletteById('relic').colors];
  P.keys = {};
  return P;
}

export const KEEP = new Set(CONTROLS.filter((c) => c.keep).map((c) => c.k));
/** Sliders that can be keyframed. */
export const CAN_ANIMATE = new Set(CONTROLS.filter((c) => c.type === 'range' && !c.noAnim).map((c) => c.k));
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
  { id: 'prism', name: 'Prism', p: { pal: pal('primaries'), algo: 'blue', grid: 240, tint: 'rainbow', tintAngle: 60, tintMove: 1, tintAmt: 0.9, shimmer: 0.3, edge: 0.5 } },
  { id: 'confetti', name: 'Confetti', p: { pal: pal('rosewindow'), algo: 'bayer4', grid: 72, shapeMix: 'random', shapeSet: 'dot,tri,plus,diamond,star', gap: 0.12, sat: 1.6, shimmer: 0.25, edge: 0.4 } },
  { id: 'shatter', name: 'Shatter', p: { pal: pal('relic'), grid: 180, burst: 'explode', burstLen: 0.32, burstDist: 0.9, shimmer: 0.4, edge: 0.5 } },
  { id: 'carousel', name: 'Carousel', p: { pal: pal('aurora'), algo: 'blue', grid: 220, cycle: 1, shimmer: 0.3, glow: 0.3, edge: 0.4 } },
  { id: 'lumen', name: 'Lumen', p: { pal: pal('lumen'), grid: 120, algo: 'blue', mode: 'ramp', sat: 0, contrast: 0.15, exposure: 0.25, edge: 0.45, shimmer: 0.3, shape: 'dot', gap: 0.1, shapeVar: 0.8, hot: 0.8, bloom: 1, bloomSize: 1.1, bloomTint: 0.55, bloomColor: '#8f86ff', streak: 0.5, ring: 0.6, glint: 0.4, glintDark: 0.35, glintWidth: 0.3, glintAngle: 18 } },
  { id: 'ansi', name: 'ANSI 16', p: { pal: pal('ansi16'), grid: 112, algo: 'bayer4', sat: 1.7, shimmer: 0.1, edge: 0.3 } },
  { id: 'starlight', name: 'Starlight', p: { pal: pal('frost'), algo: 'blue', mode: 'ramp', grid: 88, shape: 'spark', shapeVar: 0.8, gap: 0.08, glow: 0.6, glowSize: 0.8, shimmer: 0.4, sparkle: 0.2 } },
];

export { PALETTES, ALGOS, isDiff };
