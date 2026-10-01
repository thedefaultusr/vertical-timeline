// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { VerticalTimeline, type TimelineItem } from '../src';

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
