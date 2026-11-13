// The picture answers to the pointer or a finger: light that follows it, ripples on water,
// paint that smears, pixels that move out of the way. Everything is worked out on a small
// field (96 cells on the long side) and applied to the picture before it is dithered, so
// the reaction is made of the same pixels as the rest.

export const TOUCH_MODES = [['off', 'Off'], ['glow', 'Glow'], ['water', 'Water'], ['smear', 'Smear'], ['repel', 'Repel']];

const N = 96;
const STEP = 1 / 60;
const FIELDS = ['g', 'h0', 'h1', 'dx', 'dy', 'ax', 'ay', 'al', 'tmp'];

export class Touch {
  constructor() {
    this.sw = 0;
    this.sh = 0;
    this.mode = 'off';
    this.live = false;
    this.inside = false;
    this.fresh = true;
    this.pressed = false;
    this.x = 0;
    this.y = 0;
    this.lx = 0;
    this.ly = 0;
    this.acc = 0;
    this.light = null;
  }

  fit(w, h) {
    const m = Math.max(w, h) || 1;
    const sw = Math.max(8, Math.round((N * w) / m)), sh = Math.max(8, Math.round((N * h) / m));
    if (sw === this.sw && sh === this.sh) return;
    this.sw = sw;
    this.sh = sh;
    for (const k of FIELDS) this[k] = new Float32Array(sw * sh);
    this.shore = null;
    this.live = false;
  }

  clear() {
    if (this.sw) for (const k of FIELDS) this[k].fill(0);
    this.live = false;
  }

  /** x, y: where the pointer is over the picture, 0..1 across and down. */
  move(x, y) {
    if (!this.inside) { this.inside = true; this.fresh = true; }
    this.x = x;
    this.y = y;
  }
  press(x, y) {
    this.move(x, y);
    this.pressed = true;
  }
  leave() {
    this.inside = false;
  }

  /** Advance by dt seconds. True while there is something to draw. */
  step(dt, P, w, h) {
    this.fit(w, h);
    if (P.touch !== this.mode) { this.clear(); this.mode = P.touch; }
    if (P.touch === 'off') return false;
    this.acc = Math.min(this.acc + dt, 4 * STEP);
    while (this.acc >= STEP) { this.acc -= STEP; this.tick(P); }
    return this.live || this.inside;
  }

  tick(P) {
    const { sw, sh } = this;
    const n = sw * sh;
    const mode = P.touch;
    const rad = Math.max(1.5, 0.1 * P.touchSize * N);
    const last = Math.max(0.1, P.touchLast);
    const cx = this.x * sw, cy = this.y * sh;
    if (this.fresh) { this.lx = cx; this.ly = cy; this.fresh = false; }
    const vx = cx - this.lx, vy = cy - this.ly;
    const sp = Math.hypot(vx, vy);
    const on = this.inside;
    const hops = Math.min(24, Math.ceil(sp / (rad * 0.4)) + 1);
    let peak = 0;

    // Add or raise a soft round spot. `how`: 0 = raise to at least v, 1 = add v.
    const spot = (a, x, y, r, v, how) => {
      const x0 = Math.max(0, Math.floor(x - r * 2.6)), x1 = Math.min(sw - 1, Math.ceil(x + r * 2.6));
      const y0 = Math.max(0, Math.floor(y - r * 2.6)), y1 = Math.min(sh - 1, Math.ceil(y + r * 2.6));
      const q = 1 / (r * r);
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const ddx = xx + 0.5 - x, ddy = yy + 0.5 - y;
          const f = Math.exp(-(ddx * ddx + ddy * ddy) * q) * v;
          const i = yy * sw + xx;
          if (how) a[i] += f;
          else if (f > a[i]) a[i] = f;
        }
      }
    };

    if (mode === 'glow') {
      const g = this.g;
      const decay = Math.exp(-STEP / (0.8 * last));
      for (let i = 0; i < n; i++) { g[i] *= decay; if (g[i] > peak) peak = g[i]; }
      if (on) {
        for (let s = 1; s <= hops; s++) spot(g, this.lx + (vx * s) / hops, this.ly + (vy * s) / hops, rad, 1, 0);
        if (this.pressed) spot(g, cx, cy, rad * 2.2, 1.7, 0);
        peak = 1;
      }
    } else if (mode === 'water') {
      if (on && sp > 0.04) {
        const push = -0.42 * Math.min(1.6, 0.35 + sp * 0.4) / hops;
        for (let s = 1; s <= hops; s++) spot(this.h1, this.lx + (vx * s) / hops, this.ly + (vy * s) / hops, rad * 0.3, push, 1);
      }
      if (on && this.pressed) spot(this.h1, cx, cy, rad * 0.42, -1.5, 1);
      const damp = 1 - 0.016 / last;
      // The shores soak the waves up, so nothing bounces back across the picture.
      if (!this.shore || this.shore.length !== n) {
        this.shore = new Float32Array(n);
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const e = Math.min(x, y, sw - 1 - x, sh - 1 - y);
            this.shore[y * sw + x] = e >= 8 ? 1 : 0.86 + 0.14 * (e / 8);
          }
        }
      }
      const shore = this.shore;
      for (let it = 0; it < 2; it++) {
        const a = this.h1, b = this.h0;
        for (let y = 1; y < sh - 1; y++) {
          for (let i = y * sw + 1, e = y * sw + sw - 1; i < e; i++) {
            b[i] = ((a[i - 1] + a[i + 1] + a[i - sw] + a[i + sw]) * 0.5 - b[i]) * damp * shore[i];
          }
        }
        this.h1 = b;
        this.h0 = a;
      }
      const a = this.h1;
      for (let i = 0; i < n; i++) { const v = a[i] < 0 ? -a[i] : a[i]; if (v > peak) peak = v; }
      // Too faint to see: let the water lie flat.
      if (peak < 0.012) { this.h0.fill(0); this.h1.fill(0); peak = 0; }
    } else if (mode === 'smear') {
      const { dx, dy, tmp } = this;
      const decay = Math.exp(-STEP / (0.9 * last));
      if (on && sp > 0.01) {
        for (let s = 1; s <= hops; s++) {
          const x = this.lx + (vx * s) / hops, y = this.ly + (vy * s) / hops;
          spot(dx, x, y, rad, -vx / hops, 1);
          spot(dy, x, y, rad, -vy / hops, 1);
        }
      }
      // A little thickness: each cell leans toward its neighbours, then everything eases back.
      const cap = 0.2 * N;
      for (const a of [dx, dy]) {
        tmp.set(a);
        for (let y = 0; y < sh; y++) {
          const up = y > 0 ? -sw : 0, down = y < sh - 1 ? sw : 0;
          for (let x = 0; x < sw; x++) {
            const i = y * sw + x;
            const l = x > 0 ? i - 1 : i, r = x < sw - 1 ? i + 1 : i;
            let v = (tmp[i] * 0.84 + (tmp[l] + tmp[r] + tmp[i + up] + tmp[i + down]) * 0.04) * decay;
            if (v > cap) v = cap; else if (v < -cap) v = -cap;
            a[i] = v;
            if (v > peak) peak = v; else if (-v > peak) peak = -v;
          }
        }
      }
    } else if (mode === 'repel') {
      const { dx, dy } = this;
      const back = 1 - Math.exp(-STEP / (0.22 * last));
      const reach = rad * 1.7, q = 1 / (2 * reach * reach);
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const i = y * sw + x;
          let tx = 0, ty = 0, ease = back;
          if (on) {
            const ex = x + 0.5 - cx, ey = y + 0.5 - cy;
            const d2 = ex * ex + ey * ey;
            if (d2 < reach * reach * 9) {
              const d = Math.sqrt(d2) + 1e-4;
              const p = Math.min(d * 0.85, reach * 0.95 * Math.exp(-d2 * q));
              tx = (-ex / d) * p;
              ty = (-ey / d) * p;
              ease = 0.2;
            }
          }
          const nx = dx[i] + (tx - dx[i]) * ease, ny = dy[i] + (ty - dy[i]) * ease;
          dx[i] = nx;
          dy[i] = ny;
          const m = (nx < 0 ? -nx : nx) + (ny < 0 ? -ny : ny);
          if (m > peak) peak = m;
        }
      }
    }
    this.pressed = false;
    this.lx = cx;
    this.ly = cy;
    // Below this the trace cannot be seen: wipe it, so the picture rests.
    const floor = mode === 'glow' ? 0.03 : mode === 'water' ? 0.012 : 0.06;
    if (peak < floor) {
      if (this.live) { this.g.fill(0); this.dx.fill(0); this.dy.fill(0); }
      this.live = false;
    } else this.live = true;
  }

  /** Bend and light the picture's colour planes. Called by the engine just before dithering. */
  apply(E, P) {
    if (!this.live || !this.sw || P.touch === 'off') return;
    const { sw, sh } = this;
    const { w, h, R, G, B } = E;
    const amt = P.touchAmt;
    // Where every picture column and row falls on the field.
    if (!this.cx || this.cx.length !== w) { this.cx = new Int32Array(w); this.fx = new Float32Array(w); }
    if (!this.cy || this.cy.length !== h) { this.cy = new Int32Array(h); this.fy = new Float32Array(h); }
    const { cx, fx, cy, fy } = this;
    for (let x = 0; x < w; x++) {
      const u = Math.min(sw - 1.001, Math.max(0, ((x + 0.5) / w) * sw - 0.5));
      cx[x] = u | 0;
      fx[x] = u - cx[x];
    }
    for (let y = 0; y < h; y++) {
      const v = Math.min(sh - 1.001, Math.max(0, ((y + 0.5) / h) * sh - 0.5));
      cy[y] = v | 0;
      fy[y] = v - cy[y];
    }

    if (P.touch === 'glow') {
      const g = this.g;
      for (let y = 0; y < h; y++) {
        const r0 = cy[y] * sw, wy = fy[y];
        for (let x = 0; x < w; x++) {
          const j = r0 + cx[x], wx = fx[x];
          const top = g[j] + (g[j + 1] - g[j]) * wx;
          const v = top + (g[j + sw] + (g[j + sw + 1] - g[j + sw]) * wx - top) * wy;
          if (v < 0.01) continue;
          const i = y * w + x;
          const gain = 1 + 3 * amt * v, add = 0.2 * amt * v * v;
          R[i] = R[i] * gain + add;
          G[i] = G[i] * gain + add;
          B[i] = B[i] * gain + add;
        }
      }
      return;
    }

    // How far each cell reaches for its colour (in picture cells) and how the light falls on it.
    const { ax, ay, al } = this;
    const scale = Math.max(w, h) / N;
    if (P.touch === 'water') {
      const a = this.h1;
      const k = 4.5 * amt * scale;
      ax.fill(0); ay.fill(0); al.fill(0);
      for (let y = 1; y < sh - 1; y++) {
        for (let i = y * sw + 1, e = y * sw + sw - 1; i < e; i++) {
          const gx = a[i + 1] - a[i - 1], gy = a[i + sw] - a[i - sw];
          ax[i] = gx * k;
          ay[i] = gy * k;
          al[i] = -(gx + gy) * 1.3 * amt;
        }
      }
    } else {
      const k = amt * scale;
      const { dx, dy } = this;
      for (let i = 0, m = sw * sh; i < m; i++) { ax[i] = dx[i] * k; ay[i] = dy[i] * k; }
      al.fill(0);
    }
    const A = E.T1, Bc = E.T2, C = E.T3;
    A.set(R); Bc.set(G); C.set(B);
    const xm = w - 1.001, ym = h - 1.001;
    for (let y = 0; y < h; y++) {
      const r0 = cy[y] * sw, wy = fy[y];
      for (let x = 0; x < w; x++) {
        const j = r0 + cx[x], wx = fx[x];
        let t = ax[j] + (ax[j + 1] - ax[j]) * wx;
        const ox = t + (ax[j + sw] + (ax[j + sw + 1] - ax[j + sw]) * wx - t) * wy;
        t = ay[j] + (ay[j + 1] - ay[j]) * wx;
        const oy = t + (ay[j + sw] + (ay[j + sw + 1] - ay[j + sw]) * wx - t) * wy;
        t = al[j] + (al[j + 1] - al[j]) * wx;
        const l = t + (al[j + sw] + (al[j + sw + 1] - al[j + sw]) * wx - t) * wy;
        const i = y * w + x;
        let r, g, b;
        if (ox * ox + oy * oy > 0.003) {
          let sx = x + ox, sy = y + oy;
          sx = sx < 0 ? 0 : sx > xm ? xm : sx;
          sy = sy < 0 ? 0 : sy > ym ? ym : sy;
          const x0 = sx | 0, y0 = sy | 0;
          const qx = sx - x0, qy = sy - y0;
          const p = y0 * w + x0;
          const w00 = (1 - qx) * (1 - qy), w10 = qx * (1 - qy), w01 = (1 - qx) * qy, w11 = qx * qy;
          r = A[p] * w00 + A[p + 1] * w10 + A[p + w] * w01 + A[p + w + 1] * w11;
          g = Bc[p] * w00 + Bc[p + 1] * w10 + Bc[p + w] * w01 + Bc[p + w + 1] * w11;
          b = C[p] * w00 + C[p + 1] * w10 + C[p + w] * w01 + C[p + w + 1] * w11;
        } else if (l > -0.004 && l < 0.004) continue;
        else { r = A[i]; g = Bc[i]; b = C[i]; }
        if (l > 0.004 || l < -0.004) {
          // Crests catch the light, troughs fall into shade; a faint sheen shows even on black.
          const m = l < -0.6 ? 0.4 : l > 1.5 ? 2.5 : 1 + l;
          const sheen = l > 0.06 ? (l > 0.62 ? 0.14 : (l - 0.06) * 0.25) : 0;
          r = r * m + sheen; g = g * m + sheen; b = b * m + sheen;
        }
        R[i] = r; G[i] = g; B[i] = b;
      }
    }
  }

  /** Glow only: a soft pool of light over the finished picture, in the palette's brightest colour. */
  paintLight(ctx, x, y, W, H, rgb, P) {
    if (!this.live || P.touch !== 'glow') return;
    const { sw, sh, g } = this;
    if (!this.light) this.light = document.createElement('canvas');
    const c = this.light;
    if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; this.img = null; }
    const lx = c.getContext('2d');
    if (!this.img) this.img = lx.createImageData(sw, sh);
    const o = this.img.data;
    const k = 0.3 * P.touchAmt * 255;
    for (let i = 0, j = 0, m = sw * sh; i < m; i++, j += 4) {
      o[j] = rgb[0]; o[j + 1] = rgb[1]; o[j + 2] = rgb[2];
      const a = g[i] * k;
      o[j + 3] = a > 150 ? 150 : a;
    }
    lx.putImageData(this.img, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, x, y, W, H);
    ctx.restore();
  }
}
