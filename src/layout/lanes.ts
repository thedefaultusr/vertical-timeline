import type { Item } from '../types';

/**
 * Greedy interval packing of spans into lanes. Zoom-independent since spans
 * are laid out in time; points get lane -1. Returns the number of lanes.
 */
export function assignLanes(items: Item[]): number {
  const spans = items.filter((it) => it.isSpan).sort((a, b) => a.start - b.start || b.end - a.end);
  const laneEnds: number[] = [];
  for (const it of items) if (!it.isSpan) it.lane = -1;
  for (const span of spans) {
    let lane = laneEnds.findIndex((end) => end < span.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = span.end;
    span.lane = lane;
  }
  return laneEnds.length;
}
