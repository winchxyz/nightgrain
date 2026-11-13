// Hand painting on top of the picture: a colour layer and an eraser layer.
// Both live in a square canvas that is stretched over the frame.

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export class Painter {
  constructor(size = 384) {
    this.size = size;
    this.col = mk(size, size);
    this.era = mk(size, size);
    this.cx = this.col.getContext('2d', { willReadFrequently: true });
    this.ex = this.era.getContext('2d', { willReadFrequently: true });
    /** What the engine reads. used is false while nothing has been painted. */
    this.data = { w: size, h: size, erase: new Uint8Array(size * size), col: new Uint8ClampedArray(size * size * 4), used: false };
    this.url = '';
  }

  /**
   * One round dab. x, y: 0..1 across the frame. r: radius as a share of the frame's longer side.
   * aspect: frame width / height, so the dab is round on screen.
   */
  dab(tool, x, y, r, soft, color, flow, aspect) {
    const S = this.size;
    const rx = r * S * (aspect >= 1 ? 1 : 1 / aspect);
    const ry = r * S * (aspect >= 1 ? aspect : 1);
    const draw = (g, op, rgb, a) => {
      g.save();
      g.globalCompositeOperation = op;
      g.translate(x * S, y * S);
      g.scale(Math.max(0.5, rx), Math.max(0.5, ry));
      const grad = g.createRadialGradient(0, 0, Math.max(0, 1 - soft) * 0.98, 0, 0, 1);
      grad.addColorStop(0, `rgba(${rgb},${a})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, 1, 0, Math.PI * 2);
      g.fill();
      g.restore();
    };
    if (tool === 'paint') {
      const n = parseInt(color.slice(1), 16);
      draw(this.ex, 'destination-out', '255,255,255', flow);
      draw(this.cx, 'source-over', `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`, flow);
    } else if (tool === 'erase') {
      draw(this.cx, 'destination-out', '255,255,255', flow);
      draw(this.ex, 'source-over', '255,255,255', flow);
    } else {
      draw(this.cx, 'destination-out', '255,255,255', flow);
      draw(this.ex, 'destination-out', '255,255,255', flow);
    }
    this.data.used = true;
  }

  /** Dabs along a line so a fast stroke has no gaps. */
  line(tool, x0, y0, x1, y1, r, soft, color, flow, aspect) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(d / Math.max(0.002, r * 0.3)));
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      this.dab(tool, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, r, soft, color, flow, aspect);
    }
  }

  /** Copy the canvases into the arrays the engine reads. */
  sync() {
    const S = this.size;
    this.data.col.set(this.cx.getImageData(0, 0, S, S).data);
    const e = this.ex.getImageData(0, 0, S, S).data;
    const out = this.data.erase;
    for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = e[j];
  }

  clear() {
    const S = this.size;
    this.cx.clearRect(0, 0, S, S);
    this.ex.clearRect(0, 0, S, S);
    this.data.erase.fill(0);
    this.data.col.fill(0);
    this.data.used = false;
    this.url = '';
  }

  /** Both layers side by side as a PNG data URL, for undo. Empty string when nothing is painted. */
  snapshot() {
    if (!this.data.used) { this.url = ''; return ''; }
    const S = this.size;
    const c = mk(S * 2, S);
    const g = c.getContext('2d');
    g.drawImage(this.col, 0, 0);
    g.drawImage(this.era, S, 0);
    this.url = c.toDataURL('image/png');
    return this.url;
  }

  /** Put a snapshot back. Resolves when the layers are ready. */
  restore(url) {
    if (url === this.url) return Promise.resolve(false);
    if (!url) { this.clear(); return Promise.resolve(true); }
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const S = this.size;
        this.cx.clearRect(0, 0, S, S);
        this.ex.clearRect(0, 0, S, S);
        this.cx.drawImage(img, 0, 0, S, S, 0, 0, S, S);
        this.ex.drawImage(img, S, 0, S, S, 0, 0, S, S);
        this.data.used = true;
        this.url = url;
        this.sync();
        res(true);
      };
      img.onerror = () => res(false);
      img.src = url;
    });
  }
}
