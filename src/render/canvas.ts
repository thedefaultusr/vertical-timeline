/** A canvas kept at device-pixel resolution; draw in CSS pixels. */
export class HiDpiCanvas {
  readonly el: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;

  constructor(className: string) {
    this.el = document.createElement('canvas');
    this.el.className = className;
    this.ctx = this.el.getContext('2d')!;
  }

  /** Returns true if the backing store changed (contents were cleared). */
  resize(width: number, height: number): boolean {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    this.width = width;
    this.height = height;
    this.el.style.width = `${width}px`;
    this.el.style.height = `${height}px`;
    if (this.el.width === w && this.el.height === h) return false;
    this.el.width = w;
    this.el.height = h;
    return true;
  }

  begin(): CanvasRenderingContext2D {
    const dpr = this.el.width / Math.max(1, this.width);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    return ctx;
  }
}

/** Snap a coordinate so 1px lines render crisp. */
export function crisp(v: number): number {
  return Math.round(v) + 0.5;
}
