// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { VerticalTimeline, type TimelineItem, type TimelineMarker } from '../src';

const DAY = 86_400_000;
const T0 = Date.UTC(2000, 0, 1);
const CARD_GAP = 8;

/** Browser APIs jsdom lacks: canvas 2D, layout sizes, ResizeObserver, matchMedia, rAF. */
beforeAll(() => {
  const fakeContext = () => {
    const state: Record<string | symbol, unknown> = { measureText: (t: string) => ({ width: t.length * 6 }) };
    return new Proxy(state, {
      get: (o, k) => (k in o ? o[k] : () => {}),
      set: (o, k, v) => ((o[k] = v), true),
    });
  };
  HTMLCanvasElement.prototype.getContext = fakeContext as unknown as HTMLCanvasElement['getContext'];

  const sizes: Record<string, { left: number; width: number; height: number }> = {
    'vt-root': { left: 0, width: 1000, height: 800 },
    'vt-body': { left: 56, width: 944, height: 800 },
  };
  Element.prototype.getBoundingClientRect = function () {
    const cls = [...this.classList].find((c) => c in sizes);
    const { left, width, height } = cls ? sizes[cls] : { left: 0, width: 0, height: 0 };
    return { left, top: 0, width, height, right: left + width, bottom: height, x: left, y: 0, toJSON() {} } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (!this.classList.contains('vt-card')) return 0;
      return this.classList.contains('vt-card--compact') ? 34 : 100;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return this.classList.contains('vt-cards') ? 500 : 0;
    },
  });

  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia = () =>
    ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  // Frames are driven by hand (see run()).
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
});

interface MountedCard {
  item: { id: string };
  lod: 'full' | 'compact';
  y: number;
  height: number;
  offset: number;
  el: HTMLElement;
}

/** Private state the tests look at. */
function internals(tl: VerticalTimeline) {
  return tl as unknown as {
    frame(now: number): void;
    cards: { get(id: string): MountedCard | undefined; mounted: Map<string, MountedCard> };
    index: object;
    measured: Map<string, unknown>;
    geo: { columns: { id: string; slot: number }[] };
    lastFrame: number;
  };
}

function run(tl: VerticalTimeline, frames = 5): void {
  const inner = internals(tl);
  let t = inner.lastFrame || 1000;
  for (let i = 0; i < frames; i++) inner.frame((t += 16));
}

/** 300 main-lane points ~12 days apart, plus a 12-event storyline in the middle. */
function sampleItems(): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (let i = 0; i < 300; i++) items.push({ id: `p${i}`, start: T0 + i * 12 * DAY, title: `P${i}`, priority: i % 10 });
  for (let i = 0; i < 12; i++) {
    items.push({ id: `w${i}`, start: T0 + (1000 + i * 30) * DAY, title: `W${i}`, storyline: 'ww', priority: 50 });
  }
  return items;
}

function create(): VerticalTimeline {
  const container = document.createElement('div');
  document.body.append(container);
  return new VerticalTimeline(container, {
    items: sampleItems(),
    storylines: [{ id: 'ww', title: 'Storyline', color: '#8b5fb0' }],
    cardGap: CARD_GAP,
  });
}

describe('VerticalTimeline', () => {
  it('shows the selected card in full even when zoom and crowding hide it', () => {
    const tl = create();
    run(tl);
    const inner = internals(tl);
    const hidden = sampleItems().find((it) => it.id.startsWith('p') && !inner.cards.get(it.id));
    expect(hidden).toBeDefined();

    tl.select(hidden!.id);
    run(tl);
    const card = inner.cards.get(hidden!.id);
    expect(card?.lod).toBe('full');
    expect(card?.el.classList.contains('vt-card--selected')).toBe(true);
    tl.destroy();
  });

  it('does not select items of hidden storylines', () => {
    const tl = create();
    tl.setStorylineVisible('ww', false);
    tl.select('w3');
    run(tl);
    expect(tl.selected).toBeNull();
    expect(internals(tl).cards.get('w3')).toBeUndefined();
    tl.destroy();
  });

  it('clears the selection when its storyline is hidden', () => {
    const tl = create();
    const events: (string | null)[] = [];
    tl.on('select', (id) => events.push(id));
    tl.select('w3');
    tl.setStorylineVisible('ww', false);
    expect(tl.selected).toBeNull();
    expect(events).toEqual(['w3', null]);
    tl.destroy();
  });

  it('toggles a storyline without rebuilding items or dropping measured heights', () => {
    const tl = create();
    tl.setWindow(T0 + 950 * DAY, T0 + 1400 * DAY);
    run(tl);
    const inner = internals(tl);
    const index = inner.index;
    const measured = inner.measured.size;
    expect(measured).toBeGreaterThan(0);
    const slot = () => inner.geo.columns.find((c) => c.id === 'ww')!.slot;
    expect(slot()).toBeGreaterThanOrEqual(0);

    tl.setStorylineVisible('ww', false);
    expect(inner.index).toBe(index);
    expect(inner.measured.size).toBe(measured);
    expect(slot()).toBe(-1); // lane freed
    run(tl);
    expect([...inner.cards.mounted.keys()].some((id) => id.startsWith('w'))).toBe(false);

    tl.setStorylineVisible('ww', true);
    expect(slot()).toBeGreaterThanOrEqual(0);
    tl.destroy();
  });

  it('lays cards out without overlap once settled', () => {
    const tl = create();
    tl.setWindow(T0 + 900 * DAY, T0 + 1500 * DAY);
    run(tl, 80); // long enough for eased offsets to decay
    const cards = [...internals(tl).cards.mounted.values()].sort((a, b) => a.y - b.y);
    expect(cards.length).toBeGreaterThan(3);
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i].y).toBeGreaterThanOrEqual(cards[i - 1].y + cards[i - 1].height + CARD_GAP - 0.5);
    }
    tl.destroy();
  });

  it('switches the language of default cards at runtime', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const tl = new VerticalTimeline(container, {
      items: [{ id: 'a', start: new Date(2009, 1, 7), title: 'A' }],
      locale: 'en-US',
    });
    run(tl);
    const date = () => internals(tl).cards.get('a')!.el.querySelector('.vt-card__date')!.textContent;
    expect(tl.locale).toBe('en-US');
    expect(date()).toBe('Feb 7, 2009');

    tl.setLocale('de-DE');
    run(tl);
    expect(tl.locale).toBe('de-DE');
    expect(date()).toBe('7. Feb. 2009');
    tl.destroy();
  });

  it('uses a custom formatTick for axis labels and sizes the axis to it', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const labels: string[] = [];
    const tl = new VerticalTimeline(container, {
      items: sampleItems(),
      formatTick: (date, unit) => {
        const label = `${unit}:${date.getFullYear()}`;
        labels.push(label);
        return label;
      },
    });
    run(tl);
    expect(labels.some((l) => /^(year|month|week|day):\d{4}$/.test(l))).toBe(true);
    // Fake measureText is 6px per character; the axis fits the longest sample label.
    const longest = Math.max(...labels.map((l) => l.length * 6));
    const axisWidth = (tl as unknown as { geo: { axisWidth: number } }).geo.axisWidth;
    expect(axisWidth).toBeGreaterThanOrEqual(longest);
    tl.destroy();
  });

  interface EdgeInternals {
    viewport: { height: number; scrollLimits(): [number, number]; timeToY(t: number): number; panBy(dy: number): void };
    anchorY(item: object): number;
    cards: { mounted: Map<string, MountedCard & { item: object }> };
  }

  /** Every mounted card lies within the range the view can be scrolled over. */
  function expectWithinScrollableRange(tl: VerticalTimeline): void {
    const inner = tl as unknown as EdgeInternals;
    const vp = inner.viewport;
    const [first, last] = vp.scrollLimits();
    const top = vp.timeToY(first);
    const bottom = vp.timeToY(last) + vp.height;
    for (const card of inner.cards.mounted.values()) {
      expect(card.y).toBeGreaterThanOrEqual(top - 0.5);
      expect(card.y + card.height).toBeLessThanOrEqual(bottom + 0.5);
    }
  }

  it('keeps every card reachable: within the scrollable range, at the very start and end too', () => {
    const tl = create();
    const inner = tl as unknown as EdgeInternals;
    // Fully zoomed out (the whole timeline fits: barely any scrolling), then
    // zoomed in and scrolled to the very start and the very end.
    tl.setWindow(T0 - 400 * DAY, T0 + 4000 * DAY);
    run(tl, 80);
    expectWithinScrollableRange(tl);
    for (const days of [400, 120]) {
      tl.setWindow(T0, T0 + days * DAY);
      inner.viewport.panBy(-1e9);
      run(tl, 80);
      expectWithinScrollableRange(tl);
      for (const card of inner.cards.mounted.values()) expect(card.y).toBeGreaterThanOrEqual(-0.5);
      inner.viewport.panBy(1e9);
      run(tl, 80);
      expectWithinScrollableRange(tl);
      const H = inner.viewport.height;
      for (const card of inner.cards.mounted.values()) expect(card.y + card.height).toBeLessThanOrEqual(H + 0.5);
    }
    tl.destroy();
  });

  it('leaves cards in the middle of the timeline free to extend past the view', () => {
    // Off the edge of the view mid-timeline is just a scroll away: no viewport limit there.
    const tl = create();
    const inner = tl as unknown as EdgeInternals;
    let pastEdge = 0;
    for (let k = 0; k < 6; k++) {
      tl.setWindow(T0 + (1300 + k * 7) * DAY, T0 + (1500 + k * 7) * DAY);
      run(tl, 80);
      const H = inner.viewport.height;
      for (const card of inner.cards.mounted.values()) {
        const anchor = inner.anchorY(card.item);
        if (anchor >= 0 && anchor <= H && (card.y < -0.5 || card.y + card.height > H + 0.5)) pastEdge++;
      }
      expectWithinScrollableRange(tl);
    }
    expect(pastEdge).toBeGreaterThan(0);
    tl.destroy();
  });

  it('does not flip cards in or out while scrolling through a dense stretch', () => {
    const tl = create();
    const inner = tl as unknown as EdgeInternals;
    tl.setWindow(T0 + 300 * DAY, T0 + 500 * DAY);
    run(tl, 20);
    const H = inner.viewport.height;
    const seen = new Map<string, string>(); // card id → lod (or 'none') while its date is on screen
    let flips = 0;
    const visible = () => (tl as unknown as { visible: { id: string }[] }).visible;
    for (let i = 0; i < 300; i++) {
      inner.viewport.panBy(4);
      run(tl, 1);
      for (const it of visible()) {
        const anchor = inner.anchorY(it);
        if (anchor < 40 || anchor > H - 40) {
          seen.delete(it.id); // only track dates well inside the view
          continue;
        }
        const lod = inner.cards.mounted.get(it.id)?.lod ?? 'none';
        const prev = seen.get(it.id);
        if (prev !== undefined && prev !== lod) flips++;
        seen.set(it.id, lod);
      }
    }
    expect(flips).toBe(0);
    tl.destroy();
  });

  it('draws and hit-tests short spans at least as tall as a dot', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const start = T0 + 1000 * DAY;
    const tl = new VerticalTimeline(container, {
      items: [
        { id: 'short', start, end: start + DAY, title: 'Short span' },
        { id: 'far', start: T0, title: 'Far' },
        { id: 'far2', start: T0 + 3000 * DAY, title: 'Far' },
      ],
    });
    tl.setWindow(T0, T0 + 3000 * DAY); // ~3.75 days per px: the span is a fraction of a pixel
    run(tl);
    const inner = tl as unknown as {
      viewport: { timeToY(t: number): number };
      geo: { columns: { laneX: number }[] };
      visible: object[];
      timelineRenderer: { hitTest(vp: object, geo: object, visible: object[], x: number, y: number): string | null };
    };
    const geo = inner.geo;
    const x = geo.columns[0].laneX + 3;
    const mid = inner.viewport.timeToY(start + DAY / 2);
    const hit = (dy: number) => inner.timelineRenderer.hitTest(inner.viewport, geo, inner.visible, x, mid + dy);
    expect(hit(4)).toBe('short'); // within the 10px minimum, centred on the span
    expect(hit(-4)).toBe('short');
    expect(hit(12)).toBeNull();
    tl.destroy();
  });

  it('never grows eased offsets when a frame timestamp goes backwards', () => {
    const tl = create();
    run(tl);
    const inner = internals(tl);
    const card = inner.cards.mounted.values().next().value!;
    card.offset = 50;
    inner.frame(inner.lastFrame + 16);
    const after = card.offset;
    inner.frame(inner.lastFrame - 5000);
    expect(Math.abs(card.offset)).toBeLessThanOrEqual(Math.abs(after));
    expect(Math.abs(after)).toBeLessThan(50);
    tl.destroy();
  });
});

describe('VerticalTimeline in editable content', () => {
  /** A timeline inside a contenteditable editor, as a non-editable widget (like Obsidian's Live Preview). */
  function createEmbedded() {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const widget = editor.appendChild(document.createElement('div'));
    widget.setAttribute('contenteditable', 'false');
    document.body.append(editor);
    const tl = new VerticalTimeline(widget, {
      items: sampleItems(),
      storylines: [{ id: 'ww', title: 'Storyline' }],
      renderCard(item, el) {
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = item.title;
        el.append(link, document.createElement('input'));
      },
    });
    run(tl);
    const card = internals(tl).cards.mounted.values().next().value!;
    return { tl, editor, card };
  }

  it('selects a clicked card, unless the click is on a link or input in it', () => {
    const { tl, editor, card } = createEmbedded();
    card.el.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    card.el.querySelector('input')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tl.selected).toBeNull();
    card.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tl.selected).toBe(card.item.id);
    tl.destroy();
    editor.remove();
  });

  it('handles keys, unless they are typed into an input in a card', () => {
    const { tl, editor, card } = createEmbedded();
    tl.setWindow(T0 + 1000 * DAY, T0 + 1100 * DAY);
    const key = (target: Element) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const before = tl.viewport.t0;
    key(card.el.querySelector('input')!);
    expect(tl.viewport.t0).toBe(before);
    key(editor.querySelector('.vt-root')!);
    expect(tl.viewport.t0).toBeGreaterThan(before);
    tl.destroy();
    editor.remove();
  });
});

describe('markers', () => {
  interface LabelRect {
    id: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }
  function markerInternals(tl: VerticalTimeline) {
    return tl as unknown as {
      storylineSpecs: { id: string; start: number; end: number; hidden: boolean }[];
      shownMarkers: { id: string; storyline: number }[];
      geo: { columns: { id: string; slot: number }[] };
      timelineRenderer: { markerLabels: LabelRect[] };
      onTap(e: Partial<PointerEvent>): void;
      index: object;
      measured: Map<string, unknown>;
    };
  }

  function createWithMarkers(markers: TimelineMarker[]): VerticalTimeline {
    const container = document.createElement('div');
    document.body.append(container);
    return new VerticalTimeline(container, {
      items: sampleItems(),
      storylines: [
        { id: 'ww', title: 'Storyline', color: '#8b5fb0' },
        { id: 'quiet', title: 'Markers only', color: '#3f8f6b' },
      ],
      markers,
    });
  }

  it("extends its storyline's time extent (and so the lane it reserves)", () => {
    // The storyline's events run from day 1000 to day 1330.
    const tl = createWithMarkers([{ id: 'm', at: T0 + 900 * DAY, label: 'Before', storyline: 'ww' }]);
    const spec = markerInternals(tl).storylineSpecs.find((s) => s.id === 'ww')!;
    expect(spec.start).toBe(T0 + 900 * DAY);
    expect(spec.end).toBe(T0 + 1330 * DAY);
    tl.destroy();
  });

  it('gives a storyline with only markers a lane, and spans the whole timeline for unknown storylines', () => {
    const tl = createWithMarkers([
      { id: 'q', at: T0 + 100 * DAY, storyline: 'quiet' },
      { id: 'g', at: T0 + 200 * DAY, storyline: 'missing' },
    ]);
    const inner = markerInternals(tl);
    expect(inner.storylineSpecs.find((s) => s.id === 'quiet')!.hidden).toBe(false);
    expect(inner.geo.columns.find((c) => c.id === 'quiet')!.slot).toBeGreaterThanOrEqual(0);
    expect(inner.shownMarkers.find((m) => m.id === 'g')!.storyline).toBe(-1);
    tl.destroy();
  });

  it("hides a storyline's markers with it", () => {
    const tl = createWithMarkers([
      { id: 'in-ww', at: T0 + 1100 * DAY, storyline: 'ww' },
      { id: 'global', at: T0 + 1100 * DAY },
    ]);
    const shown = () => markerInternals(tl).shownMarkers.map((m) => m.id);
    expect(shown()).toEqual(['in-ww', 'global']);
    tl.setStorylineVisible('ww', false);
    expect(shown()).toEqual(['global']);
    tl.setStorylineVisible('ww', true);
    expect(shown()).toEqual(['in-ww', 'global']);
    tl.destroy();
  });

  it('extends the timeline extent', () => {
    const tl = createWithMarkers([{ id: 'late', at: T0 + 9000 * DAY }]);
    expect(tl.viewport.extent[1]).toBeGreaterThanOrEqual(T0 + 9000 * DAY);
    tl.destroy();
  });

  it('emits markerclick when a label is clicked, without selecting anything', () => {
    const at = T0 + 1100 * DAY;
    const tl = createWithMarkers([{ id: 'm', at, label: 'Turning point', storyline: 'ww' }]);
    tl.setWindow(at - 60 * DAY, at + 60 * DAY);
    run(tl);
    const inner = markerInternals(tl);
    const label = inner.timelineRenderer.markerLabels.find((l) => l.id === 'm');
    expect(label).toBeDefined();

    const clicks: string[] = [];
    tl.on('markerclick', (id) => clicks.push(id));
    // The body starts 56px from the left (after the minimap) in the layout stubs.
    inner.onTap({ target: document.body, clientX: 56 + (label!.x0 + label!.x1) / 2, clientY: (label!.y0 + label!.y1) / 2 });
    expect(clicks).toEqual(['m']);
    expect(tl.selected).toBeNull();
    tl.destroy();
  });

  it('replaces markers without rebuilding items or dropping measured heights', () => {
    const tl = createWithMarkers([]);
    tl.setWindow(T0 + 950 * DAY, T0 + 1400 * DAY);
    run(tl);
    const inner = markerInternals(tl);
    const index = inner.index;
    const measured = inner.measured.size;
    tl.setMarkers([{ id: 'new', at: T0 + 1000 * DAY, label: 'New', storyline: 'ww' }]);
    expect(inner.index).toBe(index);
    expect(inner.measured.size).toBe(measured);
    expect(inner.shownMarkers.map((m) => m.id)).toEqual(['new']);
    tl.destroy();
  });
});

describe('tooltips', () => {
  interface TooltipInternals {
    body: HTMLElement;
    viewport: { timeToY(t: number): number };
    geo: { columns: { pointX: number; main: boolean }[] };
    cards: { get(id: string): MountedCard | undefined };
    tooltip: { el: HTMLElement };
    hoverId: string | null;
    onBodyPointerMove(e: Partial<PointerEvent>): void;
    onBodyPointerLeave(): void;
  }
  const hoverAt = (tl: VerticalTimeline, item: TimelineItem) => {
    const inner = tl as unknown as TooltipInternals;
    // The body starts 56px from the left (after the minimap) in the layout stubs.
    inner.onBodyPointerMove({
      buttons: 0,
      target: inner.body,
      clientX: 56 + inner.geo.columns.find((c) => c.main)!.pointX,
      clientY: inner.viewport.timeToY(+item.start),
    });
    run(tl, 1);
  };

  it('shows the date and title of a hovered event that has no card, and hides when leaving', () => {
    const tl = create();
    tl.setWindow(T0, T0 + 3600 * DAY); // zoomed out: most events have no card
    run(tl);
    const inner = tl as unknown as TooltipInternals;
    const collapsed = sampleItems().find((it) => it.id.startsWith('p') && !inner.cards.get(it.id))!;
    hoverAt(tl, collapsed);
    // Zoomed out, neighbouring dots are a few px apart: the hit is the nearest one.
    const hovered = sampleItems().find((it) => it.id === inner.hoverId)!;
    expect(inner.cards.get(hovered.id)).toBeUndefined();
    expect(inner.tooltip.el.hidden).toBe(false);
    expect(inner.tooltip.el.querySelector('.vt-card__title')!.textContent).toBe(hovered.title);
    expect(inner.tooltip.el.querySelector('.vt-card__date')!.textContent).not.toBe('');

    inner.onBodyPointerLeave();
    run(tl, 1);
    expect(inner.tooltip.el.hidden).toBe(true);
    tl.destroy();
  });

  it('shows no tooltip for an event whose card is shown', () => {
    const tl = create();
    tl.setWindow(T0 + 1000 * DAY, T0 + 1060 * DAY);
    run(tl);
    const inner = tl as unknown as TooltipInternals;
    const withCard = sampleItems().find((it) => it.id.startsWith('p') && inner.cards.get(it.id))!;
    hoverAt(tl, withCard);
    expect(inner.tooltip.el.hidden).toBe(true);
    tl.destroy();
  });

  it('uses renderTooltip, and calls its cleanup when the tooltip hides', () => {
    const container = document.createElement('div');
    document.body.append(container);
    let cleanups = 0;
    const tl = new VerticalTimeline(container, {
      items: sampleItems(),
      renderTooltip: (item, el) => {
        el.textContent = `Custom: ${item.title}`;
        return () => cleanups++;
      },
    });
    tl.setWindow(T0, T0 + 3600 * DAY);
    run(tl);
    const inner = tl as unknown as TooltipInternals;
    const collapsed = sampleItems().find((it) => it.id.startsWith('p') && !inner.cards.get(it.id))!;
    hoverAt(tl, collapsed);
    const hovered = sampleItems().find((it) => it.id === inner.hoverId)!;
    expect(inner.tooltip.el.textContent).toBe(`Custom: ${hovered.title}`);
    inner.onBodyPointerLeave();
    run(tl, 1);
    expect(cleanups).toBe(1);
    tl.destroy();
  });
});
