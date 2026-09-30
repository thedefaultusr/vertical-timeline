/** Inertia decay time constant, ms (iOS-like). */
const INERTIA_TAU = 325;
/** Below this speed (px/ms) inertia stops. */
const INERTIA_MIN_V = 0.02;

/**
 * Single source of truth for the time ↔ y mapping. Everything that draws or
 * places content reads from here within the same animation frame.
 */
export class Viewport {
  /** Time at y = 0, ms. */
  t0 = 0;
  msPerPx = 60_000;
  height = 1;
  minMsPerPx: number;
  maxMsPerPx = Infinity;

  private min = 0;
  private max = 1;
  private velocity = 0;
  /** A fit() requested before the viewport had a real height. */
  private pendingFit: [number, number] | null = null;

  constructor(minMsPerPx = 1_000) {
    this.minMsPerPx = minMsPerPx;
  }

  get t1(): number {
    return this.t0 + this.height * this.msPerPx;
  }

  get extent(): [number, number] {
    return [this.min, this.max];
  }

  timeToY(t: number): number {
    return (t - this.t0) / this.msPerPx;
  }

  yToTime(y: number): number {
    return this.t0 + y * this.msPerPx;
  }

  setExtent(min: number, max: number): void {
    if (max <= min) max = min + 86_400_000;
    this.min = min;
    this.max = max;
    this.updateZoomLimits();
    this.clamp();
  }

  setHeight(h: number): void {
    if (h <= 1) return;
    const center = this.yToTime(this.height / 2);
    this.height = h;
    this.updateZoomLimits();
    if (this.pendingFit) {
      this.fit(...this.pendingFit);
      return;
    }
    this.t0 = center - (this.height / 2) * this.msPerPx;
    this.clamp();
  }

  /** Show [start, end] across the viewport. */
  fit(start: number, end: number): void {
    if (this.height <= 1) {
      this.pendingFit = [start, end];
      return;
    }
    this.pendingFit = null;
    this.msPerPx = clampNum((end - start) / this.height, this.minMsPerPx, this.maxMsPerPx);
    this.t0 = (start + end) / 2 - (this.height / 2) * this.msPerPx;
    this.clamp();
  }

  /** Scroll by dy pixels; positive moves toward later times. */
  panBy(dy: number): void {
    this.t0 += dy * this.msPerPx;
    this.clamp();
  }

  centerOn(t: number): void {
    this.t0 = t - (this.height / 2) * this.msPerPx;
    this.clamp();
  }

  /** Zoom keeping the time under y fixed. factor > 1 zooms in. */
  zoomAt(y: number, factor: number): void {
    const t = this.yToTime(y);
    this.msPerPx = clampNum(this.msPerPx / factor, this.minMsPerPx, this.maxMsPerPx);
    this.t0 = t - y * this.msPerPx;
    this.clamp();
  }

  /** Start a fling, velocity in px/ms (same sign convention as panBy). */
  startInertia(velocity: number): void {
    this.velocity = Math.abs(velocity) < INERTIA_MIN_V ? 0 : velocity;
  }

  stopInertia(): void {
    this.velocity = 0;
  }

  /** Advance animations by dt ms. Returns true while still animating. */
  tick(dt: number): boolean {
    if (this.velocity === 0) return false;
    dt = Math.max(0, Math.min(dt, 64));
    const decay = Math.exp(-dt / INERTIA_TAU);
    // Distance travelled over dt under exponential decay.
    this.panBy(this.velocity * INERTIA_TAU * (1 - decay));
    this.velocity *= decay;
    const [lo, hi] = this.panLimits();
    if (Math.abs(this.velocity) < INERTIA_MIN_V || this.t0 <= lo || this.t0 >= hi) this.velocity = 0;
    return this.velocity !== 0;
  }

  private updateZoomLimits(): void {
    // Allow zooming out until the whole extent (plus margin) fits.
    this.maxMsPerPx = Math.max(this.minMsPerPx, ((this.max - this.min) * 1.2) / this.height);
    this.msPerPx = clampNum(this.msPerPx, this.minMsPerPx, this.maxMsPerPx);
  }

  /** Allowed t0 range: the extent may scroll until 10% of the view remains. */
  private panLimits(): [number, number] {
    const span = this.height * this.msPerPx;
    const pad = span * 0.1;
    const lo = this.min - span + pad;
    const hi = this.max - pad;
    if (this.max - this.min <= span) {
      // Extent fits: keep it fully visible.
      return [this.max - span, this.min];
    }
    return [lo, hi];
  }

  private clamp(): void {
    const [lo, hi] = this.panLimits();
    this.t0 = clampNum(this.t0, lo, hi);
  }
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
