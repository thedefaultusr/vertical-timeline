import type { CardLod } from '../types';
import { dodge } from './dodge';

export interface BudgetCard {
  /** y the card's connector points at. */
  anchor: number;
  /** Requested level of detail; lowered in place when the card is demoted. */
  lod: CardLod;
  priority: number;
  /**
   * The anchor is only approximate (a span pinned to the viewport edge could
   * point anywhere along its bar), so this card yields before precise ones.
   */
  flexible: boolean;
  /** Level of detail last frame: null if dropped, undefined if not a candidate. */
  prevLod: CardLod | null | undefined;
  /** The anchor is inside the viewport. */
  onScreen: boolean;
  /** Never demoted (e.g. the selected card); its neighbours make room instead. */
  forced?: boolean;
}

export interface BudgetOptions<T extends BudgetCard> {
  /** Max distance a card may be pushed from its anchor, px. */
  budget: number;
  /** Share of the budget a cluster must fit in while one of its cards is being promoted. */
  hysteresis: number;
  gap: number;
  height: (card: T, lod: CardLod) => number;
  anchorOffset: (height: number) => number;
  /** Limits on a card's top position, given its anchor and height (e.g. the scrollable range). */
  bounds?: (anchor: number, height: number) => [lo: number, hi: number];
}

const LOD_RANK = { none: 0, compact: 1, full: 2 } as const;

/**
 * Demotes cards until no card is pushed further than the budget from its
 * anchor. `cards` must be sorted by anchor. Returns the cards that remain
 * (with `lod` possibly lowered) in the same order, and the dropped ones.
 *
 * Crowding is resolved per cluster of touching cards, by demoting the cluster's
 * least important card (see `tier`), then by priority. A full card shrinks to
 * compact before it is dropped. So a precisely dated card never disappears to
 * make room for a pinned span, and a card on screen isn't pushed out by one
 * that scrolled into the candidate window.
 */
export function applyBudget<T extends BudgetCard>(cards: T[], opts: BudgetOptions<T>): { kept: T[]; dropped: T[] } {
  let kept = cards;
  const dropped: T[] = [];

  for (let iter = 0; iter <= 2 * cards.length; iter++) {
    const n = kept.length;
    const heights = kept.map((c) => opts.height(c, c.lod));
    const desired = kept.map((c, i) => c.anchor - opts.anchorOffset(heights[i]));
    const bounds = opts.bounds && boundsOf(kept, heights, opts.bounds);
    const pos = dodge(desired, heights, opts.gap, bounds);

    const victims = new Set<number>();
    for (let start = 0; start < n; ) {
      let end = start;
      while (end + 1 < n && pos[end + 1] - (pos[end] + heights[end] + opts.gap) < 0.5) end++;

      let promoting = false;
      for (let i = start; i <= end; i++) {
        const c = kept[i];
        if (c.prevLod !== undefined && LOD_RANK[c.lod] > LOD_RANK[c.prevLod ?? 'none']) promoting = true;
      }
      const limit = promoting ? opts.budget * opts.hysteresis : opts.budget;
      let over = false;
      for (let i = start; i <= end; i++) if (Math.abs(pos[i] - desired[i]) > limit) over = true;
      // The cluster must fit within its members' bounds; one that's growing
      // must fit with room to spare (as with the displacement limit), so a
      // card at the limit doesn't flip between shrinking and growing.
      if (bounds) {
        const room = clusterRoom(heights, opts.gap, bounds, start, end);
        if (room < (promoting ? opts.budget * (1 - opts.hysteresis) : 0)) over = true;
      }
      const victim = over ? leastImportant(kept, start, end) : -1;
      if (victim >= 0) victims.add(victim);
      start = end + 1;
    }
    if (!victims.size) break;

    kept = kept.filter((c, i) => {
      if (!victims.has(i)) return true;
      if (c.lod === 'full') {
        c.lod = 'compact';
        return true;
      }
      dropped.push(c);
      return false;
    });
  }
  return { kept, dropped };
}

/**
 * Spare room for cluster [start, end] laid out back to back within its
 * members' bounds: how far the cluster could move; negative if it can't fit.
 */
function clusterRoom(
  heights: ArrayLike<number>,
  gap: number,
  bounds: { lo: ArrayLike<number>; hi: ArrayLike<number> },
  start: number,
  end: number,
): number {
  let lo = -Infinity;
  let hi = Infinity;
  let offset = 0;
  for (let i = start; i <= end; i++) {
    lo = Math.max(lo, bounds.lo[i] - offset);
    hi = Math.min(hi, bounds.hi[i] - offset);
    offset += heights[i] + gap;
  }
  return hi - lo;
}

export function boundsOf(
  cards: readonly { anchor: number }[],
  heights: ArrayLike<number>,
  bounds: (anchor: number, height: number) => [number, number],
): { lo: Float64Array; hi: Float64Array } {
  const lo = new Float64Array(cards.length);
  const hi = new Float64Array(cards.length);
  cards.forEach((c, i) => ([lo[i], hi[i]] = bounds(c.anchor, heights[i])));
  return { lo, hi };
}

/**
 * Who yields first: 0 pinned spans, 1 cards not shown last frame, 2 shown
 * cards whose anchor is off screen, 3 shown cards whose anchor is on screen.
 * Stability beats priority here; priority already decided what's revealed
 * at each zoom level.
 */
function tier(c: BudgetCard): number {
  if (c.flexible) return 0;
  if (!c.prevLod) return 1;
  return c.onScreen ? 3 : 2;
}

/** Index of the cluster's card to demote, or -1 if every card is forced. */
function leastImportant(cards: BudgetCard[], start: number, end: number): number {
  let best = -1;
  let bestTier = Infinity;
  for (let i = start; i <= end; i++) {
    if (cards[i].forced) continue;
    const t = tier(cards[i]);
    if (t < bestTier || (t === bestTier && cards[i].priority < cards[best].priority)) {
      best = i;
      bestTier = t;
    }
  }
  return best;
}
