import type { Item } from '../types';

/**
 * Items sorted by start, queried for overlap with a time range. Uses the
 * max-duration trick: anything overlapping [a, b] starts in
 * [a - maxDuration, b], so a binary search bounds the scan.
 */
export class ItemIndex {
  readonly items: Item[];
  private starts: Float64Array;
  private maxDuration = 0;
  private byId = new Map<string, Item>();

  constructor(items: Item[]) {
    this.items = [...items].sort((x, y) => x.start - y.start || x.end - y.end);
    this.starts = Float64Array.from(this.items, (it) => it.start);
    for (const it of this.items) {
      this.maxDuration = Math.max(this.maxDuration, it.end - it.start);
      this.byId.set(it.id, it);
    }
  }

  get(id: string): Item | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.items.length;
  }

  get extent(): [number, number] | null {
    if (!this.items.length) return null;
    let max = -Infinity;
    for (const it of this.items) max = Math.max(max, it.end);
    return [this.items[0].start, max];
  }

  query(a: number, b: number, out: Item[] = []): Item[] {
    out.length = 0;
    const hi = upperBound(this.starts, b);
    for (let i = lowerBound(this.starts, a - this.maxDuration); i < hi; i++) {
      const it = this.items[i];
      if (it.end >= a) out.push(it);
    }
    return out;
  }
}

function lowerBound(arr: Float64Array, v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr: Float64Array, v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
