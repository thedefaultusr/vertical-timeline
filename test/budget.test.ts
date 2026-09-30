import { describe, expect, it } from 'vitest';
import { applyBudget, type BudgetCard } from '../src/cards/budget';

interface Card extends BudgetCard {
  id: string;
}

const card = (id: string, anchor: number, over: Partial<Card> = {}): Card => ({
  id, anchor, lod: 'full', priority: 0, flexible: false, prevLod: undefined, onScreen: true, ...over,
});

const opts = {
  budget: 100,
  hysteresis: 0.7,
  gap: 0,
  height: (_: Card, lod: string) => (lod === 'full' ? 200 : 30),
  anchorOffset: () => 0,
};

const summary = (r: { kept: Card[]; dropped: Card[] }) => ({
  kept: r.kept.map((c) => `${c.id}:${c.lod}`),
  dropped: r.dropped.map((c) => c.id),
});

describe('applyBudget', () => {
  it('keeps everything when nothing is crowded', () => {
    const cards = [card('a', 0), card('b', 300)];
    expect(summary(applyBudget(cards, opts))).toEqual({ kept: ['a:full', 'b:full'], dropped: [] });
  });

  it('makes pinned spans yield to a dated card, even one with lower priority', () => {
    // Two pinned spans stacked at the top push a point card far from its date.
    const cards = [
      card('span1', 0, { flexible: true, priority: 90 }),
      card('span2', 0, { flexible: true, priority: 80 }),
      card('point', 40, { priority: 1 }),
    ];
    // The lower-priority span shrinks, then goes; the point stays full.
    expect(summary(applyBudget(cards, opts))).toEqual({ kept: ['span1:full', 'point:full'], dropped: ['span2'] });
  });

  it('demotes by priority among equally precise cards, compacting before dropping', () => {
    // Both pushed 70px apart from their anchors; compacting 'lo' (above) resolves it.
    const cards = [card('lo', 0, { priority: 1 }), card('hi', 60, { priority: 10 })];
    expect(summary(applyBudget(cards, { ...opts, budget: 50 }))).toEqual({ kept: ['lo:compact', 'hi:full'], dropped: [] });

    const crowded = [card('hi', 0, { priority: 10 }), ...Array.from({ length: 6 }, (_, i) => card(`lo${i}`, 1 + i, { priority: 1 }))];
    const r = applyBudget(crowded, opts);
    expect(r.kept[0].id).toBe('hi');
    expect(r.kept[0].lod).toBe('full');
    expect(r.dropped.length).toBeGreaterThan(0);
  });

  it('keeps a card already on screen over a higher-priority newcomer', () => {
    const cards = [card('shown', 0, { priority: 1, prevLod: 'full' }), card('newcomer', 0, { priority: 99 })];
    const r = applyBudget(cards, { ...opts, budget: 50 });
    expect(r.kept.find((c) => c.id === 'shown')?.lod).toBe('full');
    expect(r.kept.find((c) => c.id === 'newcomer')?.lod ?? 'dropped').not.toBe('full');
  });

  it('never demotes a forced card, even the least important one', () => {
    const cards = [
      card('pinned', 0, { flexible: true, forced: true, priority: 0 }),
      card('other', 10, { priority: 99, prevLod: 'full' }),
    ];
    const r = applyBudget(cards, { ...opts, budget: 50 });
    expect(r.kept.find((c) => c.id === 'pinned')?.lod).toBe('full');
    expect(r.kept.find((c) => c.id === 'other')?.lod ?? 'dropped').not.toBe('full');
  });

  it('requires promoted cards to fit within the hysteresis share of the budget', () => {
    // Displacement ≈ 80: within budget (100) but not within 70%.
    const cards = () => [card('a', 0, { priority: 10 }), card('b', 40, { priority: 1, lod: 'compact' })];
    const small = { ...opts, height: (_: Card, lod: string) => (lod === 'full' ? 200 : 200) };
    expect(applyBudget(cards(), small).dropped).toEqual([]);
    const promoting = cards();
    promoting[1].prevLod = null;
    expect(applyBudget(promoting, small).dropped.map((c) => c.id)).toEqual(['b']);
  });
});
