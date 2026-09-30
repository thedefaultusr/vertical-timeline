import { describe, expect, it } from 'vitest';
import { Viewport } from '../src/core/Viewport';

const DAY = 86_400_000;

function makeViewport() {
  const vp = new Viewport(1_000);
  vp.setHeight(1000);
  vp.setExtent(0, 1000 * DAY);
  vp.fit(100 * DAY, 200 * DAY);
  return vp;
}

describe('Viewport', () => {
  it('maps time to y and back', () => {
    const vp = makeViewport();
    expect(vp.timeToY(100 * DAY)).toBeCloseTo(0);
    expect(vp.timeToY(200 * DAY)).toBeCloseTo(1000);
    expect(vp.yToTime(vp.timeToY(123_456_789))).toBeCloseTo(123_456_789);
  });

  it('keeps the time under the cursor fixed when zooming', () => {
    const vp = makeViewport();
    const t = vp.yToTime(300);
    vp.zoomAt(300, 3);
    expect(vp.yToTime(300)).toBeCloseTo(t, -1);
    expect(vp.msPerPx).toBeCloseTo((100 * DAY) / 1000 / 3);
  });

  it('clamps zoom to limits', () => {
    const vp = makeViewport();
    vp.zoomAt(0, 1e12);
    expect(vp.msPerPx).toBe(1_000);
    vp.zoomAt(0, 1e-12);
    expect(vp.msPerPx).toBeCloseTo((1000 * DAY * 1.2) / 1000);
  });

  it('clamps panning to the extent', () => {
    const vp = makeViewport();
    vp.panBy(-1e9);
    expect(vp.t1).toBeGreaterThan(0);
    vp.panBy(1e9);
    expect(vp.t0).toBeLessThan(1000 * DAY);
  });

  it('decays inertia to a stop', () => {
    const vp = makeViewport();
    const t0 = vp.t0;
    vp.startInertia(2);
    let frames = 0;
    while (vp.tick(16) && frames < 1000) frames++;
    expect(frames).toBeLessThan(1000);
    // Total travel ≈ v * tau = 650px.
    expect((vp.t0 - t0) / vp.msPerPx).toBeGreaterThan(550);
    expect((vp.t0 - t0) / vp.msPerPx).toBeLessThan(700);
  });
});

describe('Viewport before sizing', () => {
  it('defers fit() until the height is known', () => {
    const vp = new Viewport(1_000);
    vp.setExtent(0, 1000 * DAY);
    vp.fit(100 * DAY, 200 * DAY);
    vp.setHeight(0);
    vp.setHeight(500);
    expect(vp.t0).toBeCloseTo(100 * DAY, -3);
    expect(vp.t1).toBeCloseTo(200 * DAY, -3);
  });
});
