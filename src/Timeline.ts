import { applyBudget, boundsOf, type BudgetCard } from './cards/budget';
import { CardLayer, type CardRequest } from './cards/CardLayer';
import { Tooltip } from './cards/Tooltip';
import { dodge } from './cards/dodge';
import { computeReveal } from './cards/reveal';
import { DateFormats, sampleTicks } from './core/dateFormat';
import { ItemIndex } from './core/ItemIndex';
import { Viewport } from './core/Viewport';
import { Gestures } from './interaction/Gestures';
import { closestWithin, INTERACTIVE } from './interaction/targets';
import { layoutStorylines, type StorylineSpec } from './layout/storylines';
import { assignLanes } from './layout/lanes';
import { HiDpiCanvas } from './render/canvas';
import { ConnectorRenderer, type Connector } from './render/ConnectorRenderer';
import { Minimap } from './render/Minimap';
import {
  AXIS_FONT_SIZE,
  connectorX,
  spanY,
  TimelineRenderer,
  type AxisText,
  type NormalizedBand,
  type NormalizedMarker,
  type TrackGeometry,
} from './render/TimelineRenderer';
import { injectStyles, THEME_VARS } from './styles';
import type {
  CardLod,
  ColorScheme,
  Item,
  RenderCard,
  TimeInput,
  TimelineBand,
  TimelineEvents,
  TimelineStoryline,
  TimelineItem,
  TimelineMarker,
  TimelineOptions,
  TimelineTheme,
} from './types';

/** Fallbacks for when a CSS variable is missing (the light palette). */
const DEFAULT_THEME: TimelineTheme = {
  background: '#fbfbfa',
  axisText: '#6b6b66',
  gridMajor: 'rgba(0,0,0,0.10)',
  gridMinor: 'rgba(0,0,0,0.04)',
  track: '#d8d8d3',
  item: '#4a6fa5',
  minimapDensity: 'rgba(74,111,165,0.55)',
  minimapViewport: 'rgba(74,111,165,0.12)',
  font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

const MAX_VISIBLE_LANES = 8;
const LANE_WIDTH = 8;
/** Keep span anchors this far inside the viewport so the card stays on screen. */
const SPAN_ANCHOR_INSET = 24;
/**
 * A card being promoted (hidden → compact → full) must fit within this share
 * of the displacement budget, so cards near the limit don't flip every frame.
 */
const PROMOTE_HYSTERESIS = 0.7;
/** Time constant for easing out layout jumps, ms (~95% settled after 3τ). */
const JUMP_TAU = 100;

/** Space around axis labels: from the left edge, and to the tick marks. */
const AXIS_LABEL_PADDING = 22;
const MIN_AXIS_WIDTH = 48;

/** The card used without a renderCard option: date (in the timeline's locale) and title. */
function renderDefaultCard(item: TimelineItem, el: HTMLElement, lod: CardLod, dates: Intl.DateTimeFormat): void {
  const date = document.createElement('div');
  date.className = 'vt-card__date';
  date.textContent = item.end !== undefined
    ? dates.formatRange(toMs(item.start), toMs(item.end))
    : dates.format(toMs(item.start));
  const title = document.createElement('div');
  title.className = 'vt-card__title';
  title.textContent = item.title;
  el.append(...(lod === 'full' ? [date, title] : [title]));
}

type Listener<T> = (payload: T) => void;
type CardCandidate = BudgetCard & CardRequest;

export class VerticalTimeline {
  readonly viewport: Viewport;

  private root: HTMLDivElement;
  /** The scrolling area: canvases and cards. */
  private body: HTMLDivElement;
  private timelineCanvas = new HiDpiCanvas('vt-timeline');
  private connectorCanvas = new HiDpiCanvas('vt-connectors');
  private timelineRenderer: TimelineRenderer;
  private connectorRenderer: ConnectorRenderer;
  private minimap: Minimap;
  private cards: CardLayer;
  private tooltip: Tooltip;
  /** Pointer y over the body while hovering an event, for placing span tooltips. */
  private hoverY = 0;
  private gestures: Gestures;
  private resizeObserver: ResizeObserver;

  private opts: Required<
    Omit<TimelineOptions, 'items' | 'storylines' | 'bands' | 'markers' | 'renderTooltip' | 'theme' | 'colorScheme' | 'renderCard' | 'locale' | 'formatTick'>
  >;
  /** Canvas colours, read from CSS variables; shared by reference with the renderers. */
  private theme: TimelineTheme = { ...DEFAULT_THEME };
  private themeOverrides: Partial<TimelineTheme>;
  private formats: DateFormats;
  private customFormatTick: TimelineOptions['formatTick'];
  /** Axis text settings; shared by reference with the renderer. */
  private text: AxisText;
  private darkQuery: MediaQueryList | null =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  /** Whether the theme was read while attached to the document (else CSS vars were unavailable). */
  private themeFromDocument = false;
  /** Matches the current devicePixelRatio; fires when it changes (e.g. moving to another display). */
  private pixelRatioQuery: MediaQueryList | null = null;
  private index = new ItemIndex([]);
  private bands: NormalizedBand[] = [];
  private rawMarkers: TimelineMarker[] = [];
  private markers: NormalizedMarker[] = [];
  /** Markers not in hidden storylines. */
  private shownMarkers: NormalizedMarker[] = [];
  private hoverMarkerId: string | null = null;
  private storylines: TimelineStoryline[] = [];
  private hiddenStorylines = new Set<string>();
  private rawItems: TimelineItem[] = [];
  /** One per storyline plus the main lane, indexed by Item.storyline. */
  private storylineSpecs: StorylineSpec[] = [];
  private hoverStorylineId: string | null = null;
  /** Items in shown storylines: what the minimap plots and reveal thresholds consider. */
  private shownItems: Item[] = [];
  private geo!: TrackGeometry;

  private visible: Item[] = [];
  private candidates: Item[] = [];
  private hoverId: string | null = null;
  private selectedId: string | null = null;
  private raf = 0;
  private lastFrame = 0;
  /** Card order + heights of the previous frame; a change means the layout may jump. */
  private layoutKey = '';
  private prevSequence: { item: Item; height: number }[] = [];
  /** Level of detail each candidate ended up with last frame (null: dropped by the budget). */
  private lastLod = new Map<string, CardLod | null>();
  /** Measured card heights per item and level of detail; better than estimates for budgeting. */
  private measured = new Map<string, Partial<Record<CardLod, number>>>();
  private cardsWidth = 0;
  private lastRange = { start: NaN, end: NaN };
  private listeners = new Map<keyof TimelineEvents, Set<Listener<never>>>();

  constructor(container: HTMLElement, options: TimelineOptions = {}) {
    injectStyles();
    this.opts = {
      minimapWidth: options.minimapWidth ?? 56,
      axisWidth: options.axisWidth ?? 'auto',
      gutterWidth: options.gutterWidth ?? 72,
      cardGap: options.cardGap ?? 8,
      anchorOffset: options.anchorOffset ?? 18,
      estimatedFullHeight: options.estimatedFullHeight ?? 120,
      estimatedCompactHeight: options.estimatedCompactHeight ?? 34,
      cardDensity: options.cardDensity ?? 1.25,
      maxDisplacement: options.maxDisplacement ?? 0.5,
      minMsPerPx: options.minMsPerPx ?? 1_000,
    };
    this.themeOverrides = options.theme ?? {};
    this.formats = new DateFormats(options.locale);
    this.customFormatTick = options.formatTick;
    this.text = { formatTick: this.customFormatTick ?? this.formats.formatTick, locale: this.formats.locale };
    this.viewport = new Viewport(this.opts.minMsPerPx);

    this.root = document.createElement('div');
    this.root.className = 'vt-root';
    this.root.tabIndex = 0;
    this.root.style.width = '100%';
    this.root.style.height = '100%';
    if (options.colorScheme && options.colorScheme !== 'auto') this.root.dataset.theme = options.colorScheme;

    this.minimap = new Minimap(this.viewport, this.theme, this.invalidate);
    const main = document.createElement('div');
    main.className = 'vt-main';
    this.body = document.createElement('div');
    this.body.className = 'vt-body';
    this.body.append(this.timelineCanvas.el, this.connectorCanvas.el);
    main.append(this.body);
    this.root.append(this.minimap.canvas.el, main);
    container.appendChild(this.root);
    this.refreshTheme();
    this.darkQuery?.addEventListener('change', this.refreshTheme);
    this.watchPixelRatio();

    this.timelineRenderer = new TimelineRenderer(this.timelineCanvas, this.theme, this.text);
    this.connectorRenderer = new ConnectorRenderer(this.connectorCanvas, this.theme);
    const renderCard: RenderCard =
      options.renderCard ?? ((item, el, lod) => renderDefaultCard(item, el, lod, this.formats.cardDate));
    this.cards = new CardLayer(this.body, renderCard, this.invalidate, (id) => this.setHover(id));
    this.tooltip = new Tooltip(
      this.body,
      options.renderTooltip ?? ((item, el) => renderDefaultCard(item, el, 'full', this.formats.cardDate)),
    );

    this.gestures = new Gestures(
      this.root,
      this.viewport,
      this.invalidate,
      (e) => e.pointerType === 'mouse' && !!(e.target as HTMLElement).closest('.vt-card, .vt-minimap'),
      this.onTap,
      this.body,
    );
    this.cards.el.addEventListener('click', this.onCardClick);
    this.root.addEventListener('keydown', this.onKeyDown);
    this.body.addEventListener('pointermove', this.onBodyPointerMove);
    this.body.addEventListener('pointerleave', this.onBodyPointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.root);

    this.setBands(options.bands ?? []);
    this.storylines = options.storylines ?? [];
    for (const s of this.storylines) if (s.visible === false) this.hiddenStorylines.add(s.id);
    this.rawMarkers = options.markers ?? [];
    this.setItems(options.items ?? []);
    this.layout();
    const extent = this.index.extent;
    if (extent) this.viewport.fit(extent[0], extent[1]);
  }

  setItems(items: TimelineItem[]): void {
    this.rawItems = items;
    const storylineIndex = new Map(this.storylines.map((s, i) => [s.id, i]));
    const specs: StorylineSpec[] = this.storylines.map((s) => ({
      id: s.id,
      title: s.title,
      color: s.color,
      main: false,
      hidden: this.hiddenStorylines.has(s.id),
      start: Infinity,
      end: -Infinity,
      laneCount: 0,
    }));
    // Events outside any storyline live in the main lane, created on demand.
    let mainIndex = -1;
    const mainLane = () => {
      if (mainIndex < 0) {
        mainIndex = specs.length;
        specs.push({ id: '', title: '', color: undefined, main: true, hidden: false, start: -Infinity, end: Infinity, laneCount: 0 });
      }
      return mainIndex;
    };

    const normalized = items.map((src): Item => {
      const start = toMs(src.start);
      const end = src.end !== undefined ? Math.max(start, toMs(src.end)) : start;
      const storyline = (src.storyline !== undefined ? storylineIndex.get(src.storyline) : undefined) ?? mainLane();
      return {
        id: src.id,
        start,
        end,
        isSpan: src.end !== undefined,
        priority: src.priority ?? 0,
        estFull: src.estimatedHeight ?? this.opts.estimatedFullHeight,
        storyline,
        lane: -1,
        revealFull: 0,
        revealCompact: 0,
        color: src.color ?? this.storylines[storyline]?.color,
        src,
      };
    });
    if (!normalized.length) mainLane();

    // Span lanes are packed within each storyline.
    const byStoryline = specs.map((): Item[] => []);
    for (const it of normalized) byStoryline[it.storyline].push(it);
    byStoryline.forEach((list, i) => (specs[i].laneCount = assignLanes(list)));
    this.storylineSpecs = specs;

    this.index = new ItemIndex(normalized);
    this.updateStorylineExtents();
    this.measured.clear();
    this.lastLod.clear();
    if (this.selectedId !== null && !this.index.get(this.selectedId)) this.setSelected(null);
    this.updateExtent();
    this.applyVisibility();
  }

  /** Replaces the storylines; items are re-assigned by their `storyline` id. */
  setStorylines(storylines: TimelineStoryline[]): void {
    this.storylines = storylines;
    this.hiddenStorylines = new Set(storylines.filter((s) => s.visible === false).map((s) => s.id));
    this.setItems(this.rawItems);
  }

  /** Shows or hides a storyline's events and cards; a hidden storyline frees its lane. */
  setStorylineVisible(id: string, visible: boolean): void {
    if (visible === !this.hiddenStorylines.has(id)) return;
    if (visible) this.hiddenStorylines.delete(id);
    else this.hiddenStorylines.add(id);
    // Only visibility changed: items, lanes and measured card heights stay.
    for (const spec of this.storylineSpecs) {
      // A storyline without events or markers stays hidden (it takes no lane).
      if (spec.id === id && !spec.main) spec.hidden = !visible || spec.start > spec.end;
    }
    this.applyVisibility();
  }

  /**
   * Replaces the moment markers. A marker assigned to a storyline extends that
   * storyline's time extent, so it may change which lanes storylines share.
   */
  setMarkers(markers: TimelineMarker[]): void {
    this.rawMarkers = markers;
    this.updateStorylineExtents();
    this.updateExtent();
    this.applyVisibility();
  }

  /** Zooms to fit a storyline's time extent. */
  focusStoryline(id: string): void {
    const spec = this.storylineSpecs.find((s) => s.id === id && !s.main);
    if (!spec || spec.start > spec.end) return;
    const pad = Math.max((spec.end - spec.start) * 0.08, 86_400_000);
    this.setWindow(spec.start - pad, spec.end + pad);
  }

  isStorylineVisible(id: string): boolean {
    return !this.hiddenStorylines.has(id);
  }

  setBands(bands: TimelineBand[]): void {
    this.bands = bands.map((b) => ({ start: toMs(b.start), end: toMs(b.end), color: b.color, label: b.label }));
    this.updateExtent();
    this.minimap.invalidate();
    this.invalidate();
  }

  /**
   * Selects an item: its card is shown full (other cards make room), even if
   * zoom or crowding would hide it. Scrolls the item into view if its date is
   * off screen. Pass null to clear the selection.
   */
  select(id: string | null): void {
    const item = id === null ? undefined : this.index.get(id);
    // Unknown ids and items of hidden storylines can't be selected.
    if (id !== null && (!item || this.isHidden(item))) return;
    if (item) {
      const vp = this.viewport;
      const inView = item.end >= vp.t0 && item.start <= vp.t1;
      if (!inView) {
        vp.stopInertia();
        vp.centerOn(item.start);
      }
    }
    this.setSelected(id);
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /** Show [start, end] across the viewport. */
  setWindow(start: TimeInput, end: TimeInput): void {
    this.viewport.stopInertia();
    this.viewport.fit(toMs(start), toMs(end));
    this.invalidate();
  }

  on<K extends keyof TimelineEvents>(event: K, fn: Listener<TimelineEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /**
   * Switches the language of axis labels and default cards (BCP 47 tags;
   * undefined = the browser's language). Mounted cards are re-rendered, so a
   * custom renderCard that reads `timeline.locale` updates too.
   */
  setLocale(locale?: string | string[]): void {
    this.formats = new DateFormats(locale);
    this.text.formatTick = this.customFormatTick ?? this.formats.formatTick;
    this.text.locale = this.formats.locale;
    this.cards.refresh();
    this.layout(); // label widths change with the language
  }

  /** The resolved locale in use, e.g. 'de-DE'. */
  get locale(): string {
    return this.formats.locale;
  }

  /** 'light' or 'dark' forces a palette; 'auto' follows the OS setting. */
  setColorScheme(scheme: ColorScheme): void {
    if (scheme === 'auto') delete this.root.dataset.theme;
    else this.root.dataset.theme = scheme;
    this.refreshTheme();
  }

  /**
   * Re-reads the canvas colours from the CSS variables. Called automatically
   * when the colour scheme changes and when the timeline is first laid out in
   * the document; call it after changing the variables yourself (e.g.
   * toggling a theme class on a parent, or a stylesheet that loads late).
   */
  refreshTheme = (): void => {
    // A detached element has no computed CSS variables: fall back to the
    // defaults for now and read again once attached (see layout()).
    this.themeFromDocument = this.root.isConnected;
    const style = getComputedStyle(this.root);
    const fromCss: Partial<TimelineTheme> = {};
    for (const [key, cssVar] of Object.entries(THEME_VARS) as [keyof typeof THEME_VARS, string][]) {
      const value = style.getPropertyValue(cssVar).trim();
      if (value) fromCss[key] = value;
    }
    if (style.fontFamily) fromCss.font = style.fontFamily;
    Object.assign(this.theme, DEFAULT_THEME, fromCss, this.themeOverrides);
    this.minimap.invalidate();
    this.invalidate();
  };

  destroy(): void {
    this.darkQuery?.removeEventListener('change', this.refreshTheme);
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.gestures.destroy();
    this.root.removeEventListener('keydown', this.onKeyDown);
    this.cards.destroy();
    this.tooltip.destroy();
    this.minimap.destroy();
    this.root.remove();
  }

  invalidate = (): void => {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  private emit<K extends keyof TimelineEvents>(event: K, payload: TimelineEvents[K]): void {
    this.listeners.get(event)?.forEach((fn) => (fn as Listener<TimelineEvents[K]>)(payload));
  }

  /** Recomputes what depends on which storylines are shown. */
  private applyVisibility(): void {
    this.shownItems = this.index.items.filter((it) => !this.isHidden(it));
    this.shownMarkers = this.markers.filter((m) => m.storyline < 0 || !this.storylineSpecs[m.storyline].hidden);
    // Reveal thresholds only consider shown items, so hiding a storyline gives
    // the remaining cards its room.
    computeReveal(this.shownItems, this.opts.estimatedCompactHeight, this.opts.cardDensity);
    const selected = this.selectedId !== null ? this.index.get(this.selectedId) : undefined;
    if (selected && this.isHidden(selected)) this.setSelected(null);
    this.minimap.invalidate();
    if (this.geo) this.layout();
  }

  /**
   * Normalizes markers and recomputes each storyline's time extent: from its
   * first to its last event or marker. A storyline with neither takes no lane.
   */
  private updateStorylineExtents(): void {
    const specs = this.storylineSpecs;
    for (const spec of specs) {
      if (spec.main) continue;
      spec.start = Infinity;
      spec.end = -Infinity;
    }
    const extend = (i: number, start: number, end: number) => {
      const spec = specs[i];
      if (spec.main) return;
      spec.start = Math.min(spec.start, start);
      spec.end = Math.max(spec.end, end);
    };
    for (const it of this.index.items) extend(it.storyline, it.start, it.end);

    // Storyline specs come first, in `this.storylines` order (the main lane, if any, is last).
    const storylineIndex = new Map(this.storylines.map((s, i) => [s.id, i]));
    this.markers = this.rawMarkers.map((m) => {
      const storyline = (m.storyline !== undefined ? storylineIndex.get(m.storyline) : undefined) ?? -1;
      const at = toMs(m.at);
      if (storyline >= 0) extend(storyline, at, at);
      return {
        id: m.id,
        at,
        label: m.label,
        storyline,
        color: m.color ?? (storyline >= 0 ? this.storylines[storyline].color : undefined),
      };
    });

    for (const spec of specs) {
      if (!spec.main) spec.hidden = this.hiddenStorylines.has(spec.id) || spec.start > spec.end;
    }
  }

  private isHidden(it: Item): boolean {
    return this.storylineSpecs[it.storyline].hidden;
  }

  /** Removes items of hidden storylines, in place. */
  private dropHidden(list: Item[]): void {
    let n = 0;
    for (const it of list) if (!this.isHidden(it)) list[n++] = it;
    list.length = n;
  }

  private updateExtent(): void {
    let min = Infinity;
    let max = -Infinity;
    const extent = this.index.extent;
    if (extent) [min, max] = extent;
    for (const b of this.bands) {
      min = Math.min(min, b.start);
      max = Math.max(max, b.end);
    }
    for (const m of this.markers) {
      min = Math.min(min, m.at);
      max = Math.max(max, m.at);
    }
    if (!Number.isFinite(min)) {
      const now = Date.now();
      [min, max] = [now - 365 * 86_400_000, now];
    }
    const pad = (max - min) * 0.02;
    this.viewport.setExtent(min - pad, max + pad);
  }

  private layout(): void {
    if (!this.themeFromDocument) this.refreshTheme();
    const { minimapWidth, gutterWidth } = this.opts;
    const axisWidth = this.opts.axisWidth === 'auto' ? this.autoAxisWidth() : this.opts.axisWidth;
    const rect = this.root.getBoundingClientRect();
    const height = rect.height;
    const mainWidth = Math.max(0, rect.width - minimapWidth);

    const { columns, right } = layoutStorylines(this.storylineSpecs, axisWidth, {
      laneWidth: LANE_WIDTH,
      maxLanes: MAX_VISIBLE_LANES,
    });
    const gridRight = right + gutterWidth;
    this.geo = { axisWidth, laneWidth: LANE_WIDTH, columns, trackRight: right, gridRight };

    this.minimap.resize(minimapWidth, height);
    this.timelineCanvas.resize(mainWidth, height);
    this.connectorCanvas.resize(gridRight, height);
    this.cards.el.style.left = `${gridRight}px`;
    // Card heights depend on width; drop cached measurements when it changes.
    const cardsWidth = this.cards.el.offsetWidth;
    if (cardsWidth !== this.cardsWidth) this.measured.clear();
    this.cardsWidth = cardsWidth;
    this.viewport.setHeight(height);
    this.invalidate();
  }

  /** Axis width that fits the widest label of the current locale (and font). */
  private autoAxisWidth(): number {
    const ctx = this.timelineCanvas.ctx;
    ctx.font = `${AXIS_FONT_SIZE}px ${this.theme.font}`;
    let widest = 0;
    for (const [date, unit] of sampleTicks()) {
      widest = Math.max(widest, ctx.measureText(this.text.formatTick(date, unit)).width);
    }
    return Math.max(MIN_AXIS_WIDTH, Math.ceil(widest) + AXIS_LABEL_PADDING);
  }

  /**
   * Canvas backing stores depend on devicePixelRatio, which changes without a
   * resize when the window moves to another display (or on browser zoom). A
   * `resolution` media query for the current ratio fires once it no longer
   * matches; re-layout (re-sizing the canvases) and watch the new ratio.
   */
  private watchPixelRatio(): void {
    this.pixelRatioQuery?.removeEventListener('change', this.onPixelRatioChange);
    if (typeof matchMedia !== 'function') return;
    this.pixelRatioQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.pixelRatioQuery.addEventListener('change', this.onPixelRatioChange);
  }

  private onPixelRatioChange = (): void => {
    this.watchPixelRatio();
    this.layout();
  };

  private setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.cards.setHighlight(id);
    this.emit('hover', id);
    this.invalidate();
  }

  private setSelected(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.cards.setSelected(id);
    this.emit('select', id);
    this.invalidate();
  }

  /**
   * What's under a point in client coordinates: a marker label (drawn on top,
   * so it wins), an event dot or bar, or a storyline title.
   */
  private hitAt(clientX: number, clientY: number): { item: string | null; storyline: string | null; marker: string | null } {
    const none = { item: null, storyline: null, marker: null };
    const rect = this.body.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || x > this.geo.gridRight) return none;
    // Marker labels can extend past the track into the connector gutter.
    const marker = this.timelineRenderer.markerAt(x, y);
    if (marker !== null) return { ...none, marker };
    if (x > this.geo.trackRight + 4) return none;
    const item = this.timelineRenderer.hitTest(this.viewport, this.geo, this.visible, x, y);
    return { ...none, item, storyline: item ? null : this.timelineRenderer.labelAt(x, y) };
  }

  private onTap = (e: PointerEvent): void => {
    const target = e.target as HTMLElement;
    // Taps on cards (touch) belong to the card's own content.
    if (target.closest('.vt-card, .vt-minimap')) return;
    const { item: id, storyline, marker } = this.hitAt(e.clientX, e.clientY);
    if (marker !== null) {
      this.emit('markerclick', marker);
      return;
    }
    if (storyline !== null) {
      this.focusStoryline(storyline);
      return;
    }
    // Clicking the selected event again, or empty timeline, deselects.
    this.setSelected(id === this.selectedId ? null : id);
  };

  private onCardClick = (e: MouseEvent): void => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.vt-card');
    // Links, buttons and inputs in the card handle their own clicks.
    if (!card?.dataset.id || closestWithin(e.target, INTERACTIVE, card)) return;
    this.setSelected(card.dataset.id);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.selectedId !== null) this.setSelected(null);
  };

  private onBodyPointerMove = (e: PointerEvent): void => {
    if (e.buttons || (e.target as HTMLElement).closest('.vt-card')) return;
    const { item, storyline, marker } = this.hitAt(e.clientX, e.clientY);
    this.body.style.cursor = item || storyline || marker ? 'pointer' : '';
    this.setHover(item);
    this.setHoverStoryline(storyline);
    this.setHoverMarker(marker);
    if (item !== null) {
      // A span's tooltip follows the pointer along the bar.
      this.hoverY = e.clientY - this.body.getBoundingClientRect().top;
      this.invalidate();
    }
  };

  private onBodyPointerLeave = (): void => {
    this.body.style.cursor = '';
    this.setHover(null);
    this.setHoverStoryline(null);
    this.setHoverMarker(null);
  };

  private setHoverStoryline(id: string | null): void {
    if (id === this.hoverStorylineId) return;
    this.hoverStorylineId = id;
    this.invalidate();
  }

  private setHoverMarker(id: string | null): void {
    if (id === this.hoverMarkerId) return;
    this.hoverMarkerId = id;
    this.invalidate();
  }

  /**
   * Tooltip for the hovered event when its card isn't shown (collapsed by
   * zoom or crowding): beside its dot, or beside a span's bar at the pointer.
   */
  private updateTooltip(): void {
    const it = this.hoverId !== null ? this.index.get(this.hoverId) : undefined;
    if (!it || this.cards.get(it.id) || this.isHidden(it)) {
      this.tooltip.hide();
      return;
    }
    const vp = this.viewport;
    let y = vp.timeToY(it.start);
    if (it.isSpan) {
      const [y0, y1] = spanY(vp, it);
      y = Math.min(Math.max(this.hoverY, y0), y1);
    }
    if (y < 0 || y > vp.height) {
      this.tooltip.hide();
      return;
    }
    this.tooltip.show(it, connectorX(this.geo, it) + 8, y, this.timelineCanvas.width, vp.height);
  }

  /** y the card's connector should point at: the date, or the visible part of a span. */
  private anchorY(it: Item): number {
    const vp = this.viewport;
    const y0 = vp.timeToY(it.start);
    if (!it.isSpan) return y0;
    const y1 = vp.timeToY(it.end);
    return Math.min(Math.max(y0, SPAN_ANCHOR_INSET), Math.max(y0, y1 - SPAN_ANCHOR_INSET));
  }

  private frame = (now: number): void => {
    this.raf = 0;
    // Clamped: a stalled tab shouldn't teleport animations, and a timestamp
    // going backwards must not turn decay into growth.
    const dt = this.lastFrame ? Math.max(0, Math.min(64, now - this.lastFrame)) : 16;
    this.lastFrame = now;
    const animating = this.viewport.tick(dt);

    const vp = this.viewport;
    const H = vp.height;
    const pad = 8 * vp.msPerPx;
    this.index.query(vp.t0 - pad, vp.t1 + pad, this.visible);
    this.dropHidden(this.visible);

    // 1. Choose cards: everything within ±1 viewport whose reveal threshold
    //    admits it at this zoom, plus the selected item, always full.
    this.index.query(vp.yToTime(-H), vp.yToTime(2 * H), this.candidates);
    this.dropHidden(this.candidates);
    const selected = this.selectedId !== null ? this.index.get(this.selectedId) : undefined;
    if (selected && !this.candidates.includes(selected)) this.candidates.push(selected);
    const msPerPx = vp.msPerPx;
    const candidates: CardCandidate[] = [];
    for (const item of this.candidates) {
      const forced = item === selected;
      const lod: CardLod | null = forced
        ? 'full'
        : msPerPx <= item.revealFull
          ? 'full'
          : msPerPx <= item.revealCompact
            ? 'compact'
            : null;
      if (!lod) continue;
      const anchor = this.anchorY(item);
      candidates.push({
        item,
        lod,
        anchor,
        priority: item.priority,
        // A span whose start is above its anchor is pinned: its card could
        // point anywhere along the bar, so it makes way for dated cards.
        flexible: item.isSpan && vp.timeToY(item.start) < anchor - 0.5,
        prevLod: this.lastLod.get(item.id),
        onScreen: anchor >= 0 && anchor <= H,
        forced,
      });
    }
    candidates.sort((a, b) => a.anchor - b.anchor);

    // 2. Displacement budget, using measured or estimated heights.
    const { kept: requests, dropped } = applyBudget(candidates, {
      budget: this.opts.maxDisplacement * H,
      hysteresis: PROMOTE_HYSTERESIS,
      gap: this.opts.cardGap,
      height: (c, lod) => this.cardHeight(c.item, lod),
      anchorOffset: (h) => this.anchorOffset(h),
      bounds: this.cardBounds,
    });
    const nextLod = new Map<string, CardLod | null>();
    for (const c of dropped) nextLod.set(c.item.id, null);
    for (const r of requests) nextLod.set(r.item.id, r.lod);
    this.lastLod = nextLod;

    // 3. Mount / measure, then final placement with real heights.
    const mounted = this.cards.sync(requests);
    const heights = mounted.map((c) => c.height);
    for (const card of mounted) {
      let m = this.measured.get(card.item.id);
      if (!m) this.measured.set(card.item.id, (m = {}));
      m[card.lod] = card.height;
    }
    const desired = requests.map((r, i) => r.anchor - this.anchorOffset(heights[i]));
    const pos = dodge(desired, heights, this.opts.cardGap, boundsOf(requests, heights, this.cardBounds));

    // 4. Ease out jumps. With a fixed card sequence (same cards, order and
    //    heights) the dodge layout is continuous, so scrolling and pushing
    //    apply immediately. When the sequence changes (a point passes a span's
    //    pinned card, a card mounts or resizes) cards would snap to new slots.
    //    To isolate the snap, the previous sequence is laid out again at the
    //    current anchors; the difference from the new layout is absorbed into
    //    an offset that decays, so cards slide past each other instead.
    let key = '';
    for (const card of mounted) key += `${card.item.id}:${card.height}|`;
    if (key !== this.layoutKey && this.prevSequence.length) {
      const prev = this.prevSequence;
      const prevHeights = prev.map((p) => p.height);
      const prevAnchors = prev.map((p) => ({ anchor: this.anchorY(p.item) }));
      const prevDesired = prevAnchors.map((p, i) => p.anchor - this.anchorOffset(prevHeights[i]));
      const prevPos = dodge(prevDesired, prevHeights, this.opts.cardGap, boundsOf(prevAnchors, prevHeights, this.cardBounds));
      const prevById = new Map<string, number>();
      for (let i = 0; i < prev.length; i++) prevById.set(prev[i].item.id, prevPos[i]);
      for (let i = 0; i < mounted.length; i++) {
        const before = prevById.get(mounted[i].item.id);
        if (before !== undefined) mounted[i].offset -= pos[i] - before;
      }
    }
    this.layoutKey = key;
    this.prevSequence = mounted.map((c) => ({ item: c.item, height: c.height }));
    const decay = Math.exp(-dt / JUMP_TAU);
    let settling = false;

    const connectors: Connector[] = [];
    const geo = this.geo;
    for (let i = 0; i < mounted.length; i++) {
      const card = mounted[i];
      const it = card.item;
      if (Math.abs(card.offset) < 0.5) card.offset = 0;
      else settling = true;

      const y = pos[i] + card.offset;
      this.cards.place(card, y);
      card.offset *= decay;
      connectors.push({ item: it, x0: connectorX(geo, it), y0: requests[i].anchor, y1: y + this.anchorOffset(heights[i]) });
    }

    // 5. Canvases, from the same viewport state as the DOM above.
    this.timelineRenderer.draw(vp, geo, {
      bands: this.bands,
      markers: this.shownMarkers,
      visible: this.visible,
      hoverId: this.hoverId,
      selectedId: this.selectedId,
      hoverStorylineId: this.hoverStorylineId,
      hoverMarkerId: this.hoverMarkerId,
    });
    this.connectorRenderer.draw(connectors, this.hoverId, this.selectedId);
    this.minimap.draw(this.shownItems, this.bands, this.shownMarkers);
    this.updateTooltip();

    if (vp.t0 !== this.lastRange.start || vp.t1 !== this.lastRange.end) {
      this.lastRange = { start: vp.t0, end: vp.t1 };
      this.emit('rangechange', { ...this.lastRange });
    }
    if (animating || settling) this.invalidate();
  };

  private cardHeight(item: Item, lod: CardLod): number {
    const card = this.cards.get(item.id);
    if (card && card.lod === lod) return card.height;
    return this.measured.get(item.id)?.[lod] ?? (lod === 'full' ? item.estFull : this.opts.estimatedCompactHeight);
  }

  /**
   * Limits on a card's top: it must stay within the scrollable range, from
   * the top of the view when scrolled all the way up to its bottom when
   * scrolled all the way down (at the current zoom). In the middle of the
   * timeline a card off the edge of the view is a scroll away, so this only
   * binds near the start and end of the timeline (or when zoomed out so far
   * that there's little to scroll), where it keeps every card reachable.
   * The range is fixed in timeline coordinates and doesn't depend on any
   * card's date, so it never flips on or off while scrolling.
   */
  private cardBounds = (_anchor: number, height: number): [number, number] => {
    const vp = this.viewport;
    const [first, last] = vp.scrollLimits();
    return [vp.timeToY(first), vp.timeToY(last) + vp.height - height];
  };

  private anchorOffset(height: number): number {
    return Math.min(this.opts.anchorOffset, height / 2);
  }
}

function toMs(t: TimeInput): number {
  return typeof t === 'number' ? t : t.getTime();
}
