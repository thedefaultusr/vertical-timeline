import type { Item } from '../types';

/**
 * Precomputes, per item, the zoom level (ms per px) below which its card is
 * shown full or compact. An item's reveal distance is its time distance to
 * the nearest more important item (higher priority; ties broken by id).
 *
 * With density 1 this guarantees that any two cards shown at the same zoom
 * are at least one (estimated) card height apart at their desired positions.
 * Thresholds are monotonic in zoom, so cards never flicker while zooming.
 *
 * O(n log n): after sorting by time, the nearest more important item on each
 * side is a "previous smaller element" query, answered for all items by one
 * monotonic-stack pass in each direction.
 */
export function computeReveal(items: Item[], compactHeight: number, density: number): void {
  const n = items.length;
  // rank[i]: 0 = most important.
  const byImportance = [...items].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rankOf = new Map<Item, number>();
  byImportance.forEach((it, r) => rankOf.set(it, r));

  const byTime = [...items].sort((a, b) => a.start - b.start);
  const rank = Int32Array.from(byTime, (it) => rankOf.get(it)!);
  const dist = new Float64Array(n).fill(Infinity);
  const stack = new Int32Array(n);

  for (const dir of [1, -1]) {
    let top = 0;
    for (let k = 0; k < n; k++) {
      const i = dir === 1 ? k : n - 1 - k;
      while (top > 0 && rank[stack[top - 1]] > rank[i]) top--;
      if (top > 0) dist[i] = Math.min(dist[i], Math.abs(byTime[i].start - byTime[stack[top - 1]].start));
      stack[top++] = i;
    }
  }

  for (let i = 0; i < n; i++) {
    const it = byTime[i];
    it.revealFull = (dist[i] * density) / it.estFull;
    it.revealCompact = (dist[i] * density) / compactHeight;
  }
}
