// Palettes. The first colour is always the backdrop.

import { hexToRgb, rgbToHex, luma } from './util.js';

export const PALETTES = [
  { id: 'relic', name: 'Relic', colors: ['#000000', '#2573ed', '#4fb652', '#f8932e', '#fafef9'] },
  { id: 'vigil', name: 'Vigil', colors: ['#000000', '#3a6fd0', '#6d6a8d', '#cf6478', '#ef9072', '#f0a050', '#6baa70', '#fef5fd'] },
  { id: 'moonsteel', name: 'Moonsteel', colors: ['#020308', '#1c2f6b', '#3f6fc4', '#8fb7ea', '#eef4ff'] },
  { id: 'forge', name: 'Forge', colors: ['#000000', '#5a0f14', '#c8321c', '#f58a1f', '#ffd86b', '#fff8e6'] },
  { id: 'verdigris', name: 'Verdigris', colors: ['#020605', '#0f4a45', '#1f9a7a', '#8ed6a4', '#f1f7d9'] },
  { id: 'rosewindow', name: 'Rose window', colors: ['#05020a', '#4b1d8f', '#c2278a', '#ff6f91', '#ffc857', '#fdf3ff'] },
  { id: 'ultraviolet', name: 'Ultraviolet', colors: ['#000000', '#2a0f6e', '#6a2cf0', '#c05bff', '#59e3ff', '#ffffff'] },
  { id: 'bloodmoon', name: 'Blood moon', colors: ['#000000', '#3d0610', '#8f1023', '#e23b2e', '#ffb199'] },
  { id: 'goldleaf', name: 'Gold leaf', colors: ['#050301', '#4a2c0a', '#a8701a', '#e9b93f', '#fff3c2'] },
  { id: 'frost', name: 'Frost', colors: ['#01040a', '#0d3b66', '#2e8fc4', '#9ad8f0', '#ffffff'] },
  { id: 'aurora', name: 'Aurora', colors: ['#000208', '#123c8a', '#12a37a', '#7df59a', '#e84fd0', '#f5fff0'] },
  { id: 'bone', name: 'Bone', colors: ['#0a0806', '#4a3a2c', '#9a8266', '#d9c7a3', '#f7f0df'] },
  { id: 'phosphor', name: 'Phosphor', colors: ['#000300', '#0b4a1c', '#1faa3c', '#7dff8a'] },
  { id: 'amber', name: 'Amber', colors: ['#050200', '#5c2a00', '#d97a00', '#ffc247'] },
  { id: 'onebit', name: 'One bit', colors: ['#000000', '#ffffff'] },
  { id: 'gameboy', name: 'Pocket', colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  { id: 'cga', name: 'CGA', colors: ['#000000', '#55ffff', '#ff55ff', '#ffffff'] },
  { id: 'primaries', name: 'Primaries', colors: ['#000000', '#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00', '#ffffff'] },
  { id: 'console16', name: 'Console 16', colors: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'] },
  { id: 'riso', name: 'Riso', colors: ['#f2ead8', '#1b1b1f', '#e8452c', '#2d5fa8', '#f2b632'] },
  { id: 'blueprint', name: 'Blueprint', colors: ['#0b2a6f', '#1d4fb8', '#7fb2ff', '#ffffff'] },
  { id: 'newsprint', name: 'Newsprint', colors: ['#ebe6da', '#15140f'] },
];

export const paletteById = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0];

export function sortByLuma(colors, keepFirst = true) {
  const key = (c) => {
    const [r, g, b] = hexToRgb(c);
    return luma(r, g, b);
  };
  if (!keepFirst) return [...colors].sort((a, b) => key(a) - key(b));
  const [first, ...rest] = colors;
  return [first, ...rest.sort((a, b) => key(a) - key(b))];
}

// Median cut over an RGBA buffer. Returns hex colours, darkest first.
export function extractPalette(data, count) {
  const pts = [];
  const step = Math.max(1, Math.floor(data.length / 4 / 12000));
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 128) continue;
    pts.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!pts.length) return ['#000000', '#ffffff'];
  let boxes = [pts];
  while (boxes.length < count) {
    let bi = -1, bestRange = 0, axis = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let a = 0; a < 3; a++) {
        let lo = 255, hi = 0;
        for (const p of box) { if (p[a] < lo) lo = p[a]; if (p[a] > hi) hi = p[a]; }
        // Favour big boxes a little so tiny outlier groups do not eat the budget.
        const range = (hi - lo) * Math.pow(box.length, 0.35);
        if (range > bestRange) { bestRange = range; bi = i; axis = a; }
      }
    });
    if (bi < 0 || bestRange === 0) break;
    const box = boxes[bi];
    box.sort((p, q) => p[axis] - q[axis]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  const cols = boxes.filter((b) => b.length).map((box) => {
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    return rgbToHex(r / box.length, g / box.length, b / box.length);
  });
  return sortByLuma([...new Set(cols)], false);
}
