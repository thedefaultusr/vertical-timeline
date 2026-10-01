import type { Viewport } from '../core/Viewport';
import type { Item, TimelineTheme } from '../types';
import type { NormalizedBand, NormalizedMarker } from './TimelineRenderer';
import { HiDpiCanvas } from './canvas';

/**
 * Whole-extent overview. The density plot is rendered once per data/size
 * change into an offscreen canvas; each frame only blits it and draws the
 * viewport rectangle. Dragging moves the main viewport.
 */
export class Minimap {
  readonly canvas: HiDpiCanvas;
  private cache: HTMLCanvasElement = document.createElement('canvas');
  private cacheValid = false;
  private dragOffset: number | null = null;

  constructor(
    private vp: Viewport,
    private theme: TimelineTheme,
    private onChange: () => void,
  ) {
    this.canvas = new HiDpiCanvas('vt-minimap');
    const el = this.canvas.el;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
  }

  invalidate(): void {
    this.cacheValid = false;
  }

  resize(width: number, height: number): void {
    if (this.canvas.resize(width, height)) this.cacheValid = false;
  }

  /** `items` / `markers`: what to plot (those in shown storylines). */
  draw(items: readonly Item[], bands: NormalizedBand[], markers: readonly NormalizedMarker[]): void {
    if (!this.cacheValid) this.renderCache(items, bands, markers);
    const ctx = this.canvas.begin();
    const { width, height } = this.canvas;
    ctx.drawImage(this.cache, 0, 0, width, height);

    const y0 = this.timeToY(this.vp.t0);
    const y1 = this.timeToY(this.vp.t1);
    const h = Math.max(4, y1 - y0);
    ctx.fillStyle = this.theme.minimapViewport;
    ctx.fillRect(1, y0, width - 2, h);
    ctx.strokeStyle = this.theme.axisText;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(1.5, Math.round(y0) + 0.5, width - 3, Math.round(h));
    ctx.globalAlpha = 1;
  }

  destroy(): void {
    this.canvas.el.remove();
  }

  private timeToY(t: number): number {
    const [min, max] = this.vp.extent;
    return ((t - min) / (max - min)) * this.canvas.height;
  }

  private yToTime(y: number): number {
    const [min, max] = this.vp.extent;
    return min + (y / this.canvas.height) * (max - min);
  }

  private renderCache(items: readonly Item[], bands: NormalizedBand[], markers: readonly NormalizedMarker[]): void {
    const { width, height } = this.canvas;
    const dpr = this.canvas.el.width / Math.max(1, width);
    this.cache.width = this.canvas.el.width;
    this.cache.height = this.canvas.el.height;
    const ctx = this.cache.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, width, height);

    for (const b of bands) {
      ctx.fillStyle = b.color;
      const y0 = this.timeToY(b.start);
      ctx.fillRect(0, y0, width, this.timeToY(b.end) - y0);
    }

    // Density histogram: one bin per 2px row; items count toward every bin
    // they overlap.
    const bins = new Float32Array(Math.max(1, Math.ceil(height / 2)));
    const [min, max] = this.vp.extent;
    const binSpan = (max - min) / bins.length;
    for (const it of items) {
      const a = Math.max(0, Math.floor((it.start - min) / binSpan));
      const b = Math.min(bins.length - 1, Math.floor((it.end - min) / binSpan));
      for (let i = a; i <= b; i++) bins[i]++;
    }
    let peak = 1;
    for (const v of bins) peak = Math.max(peak, v);

    ctx.fillStyle = this.theme.minimapDensity;
    const maxW = width - 8;
    for (let i = 0; i < bins.length; i++) {
      if (!bins[i]) continue;
      // sqrt keeps sparse regions visible next to dense ones.
      const w = Math.max(1, Math.sqrt(bins[i] / peak) * maxW);
      ctx.fillRect((width - w) / 2, i * 2, w, 2);
    }

    // Markers: thin full-width lines, on top of the density plot.
    for (const m of markers) {
      ctx.fillStyle = m.color ?? this.theme.item;
      ctx.fillRect(0, Math.round(this.timeToY(m.at)), width, 1);
    }
    this.cacheValid = true;
  }

  private onPointerDown = (e: PointerEvent): void => {
    e.stopPropagation();
    if (e.button !== 0) return;
    this.canvas.el.setPointerCapture(e.pointerId);
    this.vp.stopInertia();
    const y0 = this.timeToY(this.vp.t0);
    const y1 = this.timeToY(this.vp.t1);
    if (e.offsetY >= y0 && e.offsetY <= y1) {
      // Grab the viewport rectangle where it was clicked.
      this.dragOffset = e.offsetY - y0;
    } else {
      // Jump: center the viewport on the clicked time, then drag from center.
      this.vp.centerOn(this.yToTime(e.offsetY));
      this.dragOffset = e.offsetY - this.timeToY(this.vp.t0);
      this.onChange();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragOffset === null) return;
    const t = this.yToTime(e.offsetY - this.dragOffset);
    this.vp.panBy((t - this.vp.t0) / this.vp.msPerPx);
    this.onChange();
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.dragOffset = null;
    if (this.canvas.el.hasPointerCapture(e.pointerId)) this.canvas.el.releasePointerCapture(e.pointerId);
  };
}
