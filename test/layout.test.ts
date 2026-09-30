import { describe, expect, it } from 'vitest';
import { computeReveal } from '../src/cards/reveal';
import { ItemIndex } from '../src/core/ItemIndex';
import { layoutStorylines, type StorylineSpec } from '../src/layout/storylines';
import { assignLanes } from '../src/layout/lanes';
import type { Item } from '../src/types';

function item(id: string, start: number, end = start, priority = 0): Item {
  return {
    id, start, end, isSpan: end !== start, priority, estFull: 100, storyline: 0, lane: -1,
    revealFull: 0, revealCompact: 0, color: undefined, src: { id, start, title: id },
  };
}

describe('ItemIndex', () => {
  it('returns exactly the items overlapping a range', () => {
    const items = [item('a', 0, 100), item('b', 50), item('c', 200, 300), item('d', 400)];
    const index = new ItemIndex(items);
    const ids = (a: number, b: number) => index.query(a, b).map((it) => it.id).sort();
    expect(ids(60, 250)).toEqual(['a', 'c']);
    expect(ids(40, 60)).toEqual(['a', 'b']);
    expect(ids(301, 399)).toEqual([]);
    expect(index.extent).toEqual([0, 400]);
  });
});

describe('assignLanes', () => {
  it('packs overlapping spans into separate lanes and reuses free ones', () => {
    const items = [item('a', 0, 100), item('b', 50, 150), item('c', 120, 200), item('p', 10)];
    expect(assignLanes(items)).toBe(2);
    const lane = Object.fromEntries(items.map((it) => [it.id, it.lane]));
    expect(lane).toEqual({ a: 0, b: 1, c: 0, p: -1 });
  });
});

describe('computeReveal', () => {
  it('uses the distance to the nearest more important item (brute force check)', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // Coarse times and priorities, so ties in both are common.
    const items = Array.from({ length: 300 }, (_, i) =>
      item(`i${i}`, Math.floor(rand() * 60) * 1000, undefined, Math.floor(rand() * 8)),
    );
    const moreImportant = (a: Item, b: Item) => a.priority > b.priority || (a.priority === b.priority && a.id < b.id);
    computeReveal(items, 30, 1.5);
    for (const it of items) {
      let d = Infinity;
      for (const other of items) if (moreImportant(other, it)) d = Math.min(d, Math.abs(other.start - it.start));
      expect(it.revealFull).toBe((d * 1.5) / it.estFull);
      expect(it.revealCompact).toBe((d * 1.5) / 30);
    }
  });

  it('reveals higher priority first and guarantees spacing at density 1', () => {
    const items = [item('a', 0, 0, 10), item('b', 1000, 1000, 5), item('c', 1500, 1500, 1)];
    computeReveal(items, 30, 1);
    const [a, b, c] = items;
    expect(a.revealFull).toBe(Infinity);
    expect(b.revealFull).toBe(1000 / 100);
    expect(c.revealFull).toBe(500 / 100);
    // At c's threshold, all three cards are >= one card height apart.
    const m = c.revealFull;
    expect((c.start - b.start) / m).toBeGreaterThanOrEqual(100);
    expect(c.revealCompact).toBeGreaterThan(c.revealFull);
  });
});

describe('layoutStorylines', () => {
  const storyline = (id: string, start: number, end: number, over: Partial<StorylineSpec> = {}): StorylineSpec => ({
    id, title: id, color: undefined, main: false, hidden: false, start, end, laneCount: 0, ...over,
  });
  const main = storyline('', -Infinity, Infinity, { main: true });
  const opts = { laneWidth: 8, maxLanes: 3 };
  const slots = (specs: StorylineSpec[]) => layoutStorylines(specs, 0, opts).columns.map((c) => c.slot);

  it('gives the main lane the first slot to itself', () => {
    expect(slots([storyline('a', 0, 10), main])).toEqual([1, 0]);
  });

  it('reuses a lane once its storyline has ended', () => {
    // a and b overlap; c starts after a ends, so it takes a's lane.
    expect(slots([storyline('a', 0, 10), storyline('b', 5, 30), storyline('c', 20, 40)])).toEqual([0, 1, 0]);
  });

  it('does not share a lane between touching storylines', () => {
    expect(slots([storyline('a', 0, 10), storyline('b', 10, 20)])).toEqual([0, 1]);
  });

  it('frees the lane of hidden storylines', () => {
    expect(slots([storyline('a', 0, 10, { hidden: true }), storyline('b', 5, 30)])).toEqual([-1, 0]);
  });

  it('sizes a slot by its widest storyline and aligns storylines to its left edge', () => {
    const { columns, right } = layoutStorylines([storyline('a', 0, 10, { laneCount: 3 }), storyline('b', 20, 30)], 100, opts);
    expect(columns[0].slot).toBe(columns[1].slot);
    expect(columns[0].x).toBe(100);
    expect(columns[0].pointX).toBe(columns[1].pointX);
    expect(columns[0].width).toBe(16 + 14 + 12 + 3 * 8 + 6);
    expect(right).toBe(100 + columns[0].width);
  });
});
