export type TimeInput = Date | number;

export interface TimelineItem {
  id: string;
  start: TimeInput;
  /** Present for spanning events; omitted for momentary ones. */
  end?: TimeInput;
  title: string;
  /** Storyline id; items without one, or with an unknown one, go in the main lane. */
  storyline?: string;
  /** Higher priority cards survive longer when zooming out. Default 0. */
  priority?: number;
  /** Height hint for the full card, used before the card is measured. */
  estimatedHeight?: number;
  color?: string;
  data?: unknown;
}

/**
 * A storyline of connected events (e.g. "WWII"). Drawn as a rail from its
 * first to its last event in a lane of its own; lanes are reused by other
 * storylines once a storyline has ended.
 */
export interface TimelineStoryline {
  id: string;
  title: string;
  /** Default colour for the storyline's items. */
  color?: string;
  /** Default true. Hidden storylines show no events or cards and free their lane. */
  visible?: boolean;
}

export interface TimelineBand {
  start: TimeInput;
  end: TimeInput;
  color: string;
  label?: string;
}

export type CardLod = 'full' | 'compact';

/**
 * Renders a card's content into `el`. Called again when the level of detail
 * changes. May return a cleanup function, called before re-render or unmount.
 */
export type RenderCard = (item: TimelineItem, el: HTMLElement, lod: CardLod) => void | (() => void);

import type { FormatTick } from './core/dateFormat';

export type { FormatTick, TickUnit } from './core/dateFormat';

export type ColorScheme = 'auto' | 'light' | 'dark';

/**
 * Canvas colours. By default they come from the CSS variables on `.vt-root`
 * (see README, Styling); values given here override them.
 */
export interface TimelineTheme {
  background: string;
  axisText: string;
  gridMajor: string;
  gridMinor: string;
  track: string;
  item: string;
  minimapDensity: string;
  minimapViewport: string;
  font: string;
}

export interface TimelineOptions {
  items?: TimelineItem[];
  /** Storylines; see TimelineStoryline. */
  storylines?: TimelineStoryline[];
  bands?: TimelineBand[];
  renderCard?: RenderCard;
  theme?: Partial<TimelineTheme>;
  /** 'auto' (default) follows the OS; 'light' / 'dark' force a palette. */
  colorScheme?: ColorScheme;
  minimapWidth?: number;
  /** Width of the date axis, px, or 'auto' (default): fits the locale's widest label. */
  axisWidth?: number | 'auto';
  /**
   * Locale(s) for dates on the axis and default cards, as BCP 47 tags (e.g.
   * 'de-DE', or ['fr-CA', 'fr']). Default: the browser's language.
   */
  locale?: string | string[];
  /** Custom axis label formatter; overrides the locale's default labels. */
  formatTick?: FormatTick;
  gutterWidth?: number;
  /** Vertical gap between cards, px. */
  cardGap?: number;
  /** Distance from a card's top edge to where its connector attaches, px. */
  anchorOffset?: number;
  /** Default full / compact card height estimates, px. */
  estimatedFullHeight?: number;
  estimatedCompactHeight?: number;
  /**
   * How tightly cards may pack before being demoted. 1 = cards never overlap
   * at their desired positions (given estimated heights); higher values show
   * more cards and let the dodge layout push them apart.
   */
  cardDensity?: number;
  /** Max distance (in viewport heights) a card may be pushed from its date. */
  maxDisplacement?: number;
  /** Zoom limit: smallest ms per pixel. */
  minMsPerPx?: number;
}

export interface TimelineEvents {
  hover: string | null;
  /** Selected item id; null when the selection is cleared. */
  select: string | null;
  rangechange: { start: number; end: number };
}

/** Internal, normalized item. */
export interface Item {
  id: string;
  start: number;
  end: number;
  isSpan: boolean;
  priority: number;
  estFull: number;
  /** Index of the item's storyline (or the main lane) in the storyline layout. */
  storyline: number;
  /** Span lane within its storyline, -1 for points. */
  lane: number;
  /** Card shows as full while msPerPx <= revealFull, compact while <= revealCompact. */
  revealFull: number;
  revealCompact: number;
  color: string | undefined;
  src: TimelineItem;
}
