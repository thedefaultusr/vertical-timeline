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
