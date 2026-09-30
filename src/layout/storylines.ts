export interface StorylineSpec {
  /** Storyline id; '' for the main lane of events outside any storyline. */
  id: string;
  title: string;
  color: string | undefined;
  /** The main lane spans all time and never shares its slot. */
  main: boolean;
  hidden: boolean;
  /** Time extent: first event's start to last event's end. */
  start: number;
  end: number;
  /** Span lanes the storyline's items need. */
  laneCount: number;
}

/** Where a storyline is drawn. Indexed like its spec (Item.storyline). */
export interface StorylineColumn {
  id: string;
  title: string;
  color: string | undefined;
  main: boolean;
  hidden: boolean;
  start: number;
  end: number;
  /** Shared slot (horizontal lane) the storyline occupies for its time extent. */
  slot: number;
  x: number;
  width: number;
  /** Centre of the vertical title strip (storylines only). */
  labelX: number;
  /** x of the rail / point-event line. */
  pointX: number;
  /** x of span lane 0. */
  laneX: number;
  /** Span lanes drawn; spans in higher lanes are not drawn. */
  lanes: number;
}

export interface StorylineLayoutOptions {
  laneWidth: number;
  maxLanes: number;
}

const LABEL_WIDTH = 16;
const POINT_INSET = 14;
const LANE_GAP = 12;
const RIGHT_PAD = 6;

/**
 * Packs storylines into shared slots left to right from x0. The main lane (if
 * any) gets the first slot to itself. Storylines are placed in time order
 * into the first slot whose previous storyline has ended, so a lane is reused
 * once a storyline is over. A slot is as wide as its widest storyline.
 */
export function layoutStorylines(
  specs: StorylineSpec[],
  x0: number,
  opts: StorylineLayoutOptions,
): { columns: StorylineColumn[]; right: number } {
  const slotOf = new Array<number>(specs.length).fill(-1);
  const slotEnds: number[] = [];

  const main = specs.findIndex((s) => s.main && !s.hidden);
  if (main >= 0) {
    slotOf[main] = 0;
    slotEnds.push(Infinity);
  }
  const order = specs
    .map((_, i) => i)
    .filter((i) => !specs[i].main && !specs[i].hidden)
    .sort((a, b) => specs[a].start - specs[b].start || specs[a].end - specs[b].end);
  for (const i of order) {
    let slot = slotEnds.findIndex((end) => end < specs[i].start);
    if (slot === -1) slot = slotEnds.length;
    slotEnds[slot] = specs[i].end;
    slotOf[i] = slot;
  }

  const lanes = specs.map((s) => Math.min(s.laneCount, opts.maxLanes));
  const contentWidth = (i: number) =>
    (specs[i].main ? 0 : LABEL_WIDTH) + POINT_INSET + LANE_GAP + lanes[i] * opts.laneWidth + RIGHT_PAD;
  const slotWidths = new Array<number>(slotEnds.length).fill(0);
  specs.forEach((_, i) => {
    if (slotOf[i] >= 0) slotWidths[slotOf[i]] = Math.max(slotWidths[slotOf[i]], contentWidth(i));
  });
  const slotX: number[] = [];
  let x = x0;
  for (const w of slotWidths) {
    slotX.push(x);
    x += w;
  }

  const columns = specs.map((spec, i): StorylineColumn => {
    const { id, title, color, main: isMain, hidden, start, end } = spec;
    const slot = slotOf[i];
    const left = slot >= 0 ? slotX[slot] : x0;
    const labelStrip = isMain ? 0 : LABEL_WIDTH;
    const pointX = left + labelStrip + POINT_INSET;
    return {
      id, title, color, main: isMain, hidden, start, end, slot,
      x: left,
      width: slot >= 0 ? slotWidths[slot] : 0,
      labelX: left + LABEL_WIDTH / 2 + 2,
      pointX,
      laneX: pointX + LANE_GAP,
      lanes: lanes[i],
    };
  });
  return { columns, right: x };
}
