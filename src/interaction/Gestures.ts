import type { Viewport } from '../core/Viewport';
import { closestWithin, EDITABLE } from './targets';

const TAP_SLOP = 4;
const VELOCITY_WINDOW = 100;

interface Sample {
  y: number;
  t: number;
}

/**
 * All input that moves the viewport. There is no native scrolling anywhere:
 * wheel, drag, pinch and inertia all go through the Viewport so DOM cards and
 * canvases update in the same frame.
 *
 * - wheel: scroll; ctrl/meta + wheel (and trackpad pinch): zoom at cursor
 * - drag: pan with inertia (mouse drags starting on cards are left alone so
 *   card content stays selectable / clickable; touch pans anywhere)
 * - two-finger touch: pinch zoom
 * - tap (press and release without moving): reported via onTap
 */
export class Gestures {
  private pointers = new Map<number, { x: number; y: number }>();
  private samples: Sample[] = [];
  private pinchDist = 0;
  /** Where a single-pointer press started, while it can still be a tap; null once it's a drag. */
  private tapStart: { x: number; y: number } | null = null;

  constructor(
    private el: HTMLElement,
    private vp: Viewport,
    private onChange: () => void,
    private shouldIgnore: (e: PointerEvent) => boolean,
    private onTap: (e: PointerEvent) => void = () => {},
    /** Element whose top edge is the viewport's y = 0 (for zooming at the cursor). */
    private yOrigin: HTMLElement = el,
  ) {
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('keydown', this.onKeyDown);
  }

  destroy(): void {
    const el = this.el;
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('keydown', this.onKeyDown);
  }

  private localY(clientY: number): number {
    return clientY - this.yOrigin.getBoundingClientRect().top;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.vp.stopInertia();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vp.height : 1;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel
      // with ctrl sends ~100 per notch. Clamp so both feel reasonable.
      const clamped = Math.max(-50, Math.min(50, dy));
      this.vp.zoomAt(this.localY(e.clientY), Math.exp(-clamped * 0.01));
    } else {
      this.vp.panBy(dy);
    }
    this.onChange();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.shouldIgnore(e)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.vp.stopInertia();
    this.samples = [{ y: e.clientY, t: e.timeStamp }];
    this.tapStart = this.pointers.size === 1 ? { x: e.clientX, y: e.clientY } : null;
    if (this.pointers.size === 2) {
      this.pinchDist = this.pointerDistance();
      this.captureAll();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.tapStart && Math.hypot(e.clientX - this.tapStart.x, e.clientY - this.tapStart.y) >= TAP_SLOP) {
      // Now a drag. Capture only from here on, so a tap still reaches (and
      // clicks) whatever is under the pointer, e.g. a link inside a card.
      this.tapStart = null;
      this.captureAll();
    }

    if (this.pointers.size === 2) {
      const dist = this.pointerDistance();
      if (this.pinchDist > 0 && dist > 0) {
        const [a, b] = [...this.pointers.values()];
        this.vp.zoomAt(this.localY((a.y + b.y) / 2), dist / this.pinchDist);
      }
      this.pinchDist = dist;
      this.samples = [];
    } else {
      if (this.tapStart) return; // still within tap slop
      this.vp.panBy(-dy);
      this.samples.push({ y: e.clientY, t: e.timeStamp });
      const cutoff = e.timeStamp - VELOCITY_WINDOW;
      while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
    }
    this.onChange();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    if (this.tapStart && this.pointers.size === 0 && e.type === 'pointerup') {
      this.tapStart = null;
      this.onTap(e);
      return;
    }
    this.tapStart = null;
    if (this.pointers.size === 0 && this.samples.length >= 2) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      const dt = last.t - first.t;
      if (dt > 0 && e.timeStamp - last.t < 50) {
        this.vp.startInertia(-(last.y - first.y) / dt);
        this.onChange();
      }
    }
    this.samples = [];
    this.pinchDist = 0;
  };

  /** An uncaptured press (not yet a drag) that leaves the element is abandoned. */
  private onPointerLeave = (e: PointerEvent): void => {
    if (!this.el.hasPointerCapture(e.pointerId) && this.pointers.delete(e.pointerId)) this.tapStart = null;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const page = this.vp.height * 0.9;
    const actions: Record<string, () => void> = {
      ArrowDown: () => this.vp.panBy(40),
      ArrowUp: () => this.vp.panBy(-40),
      PageDown: () => this.vp.panBy(page),
      PageUp: () => this.vp.panBy(-page),
      '+': () => this.vp.zoomAt(this.vp.height / 2, 1.25),
      '=': () => this.vp.zoomAt(this.vp.height / 2, 1.25),
      '-': () => this.vp.zoomAt(this.vp.height / 2, 0.8),
    };
    const action = actions[e.key];
    // Keys typed into an input inside a card are the input's.
    if (!action || closestWithin(e.target, EDITABLE, this.el)) return;
    e.preventDefault();
    this.vp.stopInertia();
    action();
    this.onChange();
  };

  private captureAll(): void {
    for (const id of this.pointers.keys()) {
      if (!this.el.hasPointerCapture(id)) this.el.setPointerCapture(id);
    }
  }

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
