import { describe, expect, it } from 'vitest';
import { dodge } from '../src/cards/dodge';

function assertValid(desired: number[], heights: number[], gap: number, pos: Float64Array) {
  for (let i = 1; i < pos.length; i++) {
    expect(pos[i]).toBeGreaterThanOrEqual(pos[i - 1] + heights[i - 1] + gap - 1e-9);
  }
  expect(pos.length).toBe(desired.length);
}

describe('dodge', () => {
  it('leaves non-overlapping boxes at their desired positions', () => {
    const pos = dodge([0, 100, 300], [50, 50, 50], 10);
    expect([...pos]).toEqual([0, 100, 300]);
  });

  it('splits two colliding boxes symmetrically', () => {
    const pos = dodge([100, 100], [40, 40], 0);
    expect([...pos]).toEqual([80, 120]);
  });

  it('cascades merges through chains of blocks', () => {
    const desired = [0, 50, 55, 60];
    const heights = [50, 50, 50, 50];
    const pos = dodge(desired, heights, 0);
    assertValid(desired, heights, 0, pos);
    // One block; its top is the mean of desired - offset.
    const top = (0 + (50 - 50) + (55 - 100) + (60 - 150)) / 4;
    expect(pos[0]).toBeCloseTo(top);
  });

  it('produces valid layouts for random input and is continuous', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let trial = 0; trial < 50; trial++) {
      const n = 1 + Math.floor(rand() * 40);
      const desired = Array.from({ length: n }, () => rand() * 1000).sort((a, b) => a - b);
      const heights = Array.from({ length: n }, () => 20 + rand() * 100);
      const pos = dodge(desired, heights, 8);
      assertValid(desired, heights, 8, pos);

      // Nudging one input a hair moves outputs by at most that much.
      const nudged = desired.slice();
      nudged[0] -= 0.001;
      const pos2 = dodge(nudged, heights, 8);
      for (let i = 0; i < n; i++) expect(Math.abs(pos2[i] - pos[i])).toBeLessThanOrEqual(0.001 + 1e-9);
    }
  });

  it('handles empty input', () => {
    expect(dodge([], [], 4).length).toBe(0);
  });
});

describe('dodge with bounds', () => {
  const inf = (n: number) => ({ lo: Array(n).fill(-Infinity), hi: Array(n).fill(Infinity) });

  it('matches the unbounded layout when bounds are infinite', () => {
    const desired = [0, 10, 15, 200];
    const heights = [40, 40, 40, 40];
    expect([...dodge(desired, heights, 4, inf(4))]).toEqual([...dodge(desired, heights, 4)]);
  });

  it('clamps a lone box to its bounds', () => {
    expect([...dodge([-10], [50], 0, { lo: [0], hi: [100] })]).toEqual([0]);
    expect([...dodge([90], [50], 0, { lo: [0], hi: [50] })]).toEqual([50]);
  });

  it('pushes a whole block back inside when one member hits an edge', () => {
    // Unbounded the pair sits at 62.5 / 82.5; the second must end by 100 (top <= 80).
    const pos = dodge([70, 75], [20, 20], 0, { lo: [-Infinity, -Infinity], hi: [80, 80] });
    expect([...pos]).toEqual([60, 80]);
  });

  it('keeps the lower bound when bounds conflict (a box taller than the space)', () => {
    expect([...dodge([0], [200], 0, { lo: [0], hi: [-100] })]).toEqual([0]);
  });

  it('stays ordered, non-overlapping, in bounds and continuous for random input', () => {
    let seed = 3;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const H = 1000;
    for (let trial = 0; trial < 50; trial++) {
      const n = 1 + Math.floor(rand() * 12);
      const desired = Array.from({ length: n }, () => rand() * H).sort((a, b) => a - b);
      const heights = Array.from({ length: n }, () => 20 + rand() * 60);
      const bounds = { lo: desired.map((d) => Math.min(0, d)), hi: desired.map((d, i) => Math.max(H, d) - heights[i]) };
      const pos = dodge(desired, heights, 8, bounds);
      for (let i = 0; i < n; i++) {
        if (i > 0) expect(pos[i]).toBeGreaterThanOrEqual(pos[i - 1] + heights[i - 1] + 8 - 1e-9);
      }
      // Total height fits the space here, so everything is inside it.
      if (heights.reduce((a, b) => a + b + 8, 0) <= H) {
        expect(pos[0]).toBeGreaterThanOrEqual(-1e-9);
        expect(pos[n - 1] + heights[n - 1]).toBeLessThanOrEqual(H + 1e-9);
      }
      const nudged = desired.slice();
      nudged[0] -= 0.001;
      const pos2 = dodge(nudged, heights, 8, bounds);
      for (let i = 0; i < n; i++) expect(Math.abs(pos2[i] - pos[i])).toBeLessThanOrEqual(0.001 + 1e-9);
    }
  });
});
