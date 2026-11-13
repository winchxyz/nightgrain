// Keyframes: a slider can hold several values placed along the loop.
// keys = { settingKey: [[phase 0..1, value], ...] }, each list sorted by phase.

/** Two moments closer than this count as the same keyframe. */
export const NEAR = 0.02;

const gap = (a, b) => {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
};

/** Index of the keyframe at this moment, or -1. */
export function keyAt(list, ph) {
  if (!list) return -1;
  for (let i = 0; i < list.length; i++) if (gap(list[i][0], ph) < NEAR) return i;
  return -1;
}

export function setKey(keys, k, ph, v) {
  const list = keys[k] || (keys[k] = []);
  const i = keyAt(list, ph);
  if (i >= 0) list[i][1] = v;
  else {
    list.push([Math.round(ph * 1000) / 1000, v]);
    list.sort((a, b) => a[0] - b[0]);
  }
}

export function removeKey(keys, k, ph) {
  const list = keys[k];
  const i = keyAt(list, ph);
  if (i < 0) return false;
  list.splice(i, 1);
  if (!list.length) delete keys[k];
  return true;
}

/** The value at a moment. The last keyframe eases back into the first, so the loop has no seam. */
export function valueAt(list, ph) {
  const n = list.length;
  if (n === 1) return list[0][1];
  let i = n - 1;
  for (let j = 0; j < n; j++) if (list[j][0] <= ph) i = j;
  const a = list[i], b = list[(i + 1) % n];
  let span = b[0] - a[0];
  if (span <= 0) span += 1;
  let d = ph - a[0];
  if (d < 0) d += 1;
  let u = span > 0 ? d / span : 0;
  u = u * u * (3 - 2 * u);
  return a[1] + (b[1] - a[1]) * u;
}

/** Keep only well-formed keyframes for settings that may be animated. */
export function cleanKeys(raw, allowed) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k in raw) {
    if (!allowed.has(k) || !Array.isArray(raw[k])) continue;
    const list = raw[k]
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= 1)
      .map((p) => [p[0], p[1]])
      .sort((a, b) => a[0] - b[0])
      .slice(0, 32);
    if (list.length) out[k] = list;
  }
  return out;
}
