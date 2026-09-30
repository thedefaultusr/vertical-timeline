# @defaultusr/vertical-timeline

> [!WARNING]  
> The entire repo was generated 100% with Claude Code and has only received a very brief review. Use at your own risk.

A vertical timeline rendered on canvas, with rich HTML cards linked to their dates.

- Handles thousands of events. Markers, grid, bands and connectors are drawn on canvas; only the cards near the viewport exist in the DOM.
- **Rich cards**: your own HTML, or a React, Vue or Svelte component, placed next to the event's date. Cards move aside for each other, shrink or hide as you zoom out, and ease into new positions instead of jumping.
- **Momentary and spanning events**, **background bands**, a **minimap**, and **storylines**: sets of connected events drawn as rails that reuse lanes over time.
- Scroll, drag with inertia, and zoom with pinch or ctrl/⌘ + wheel; click to select; keyboard support.
- Light and dark themes via CSS variables, including the canvas colours.

```
┌─────────┬──────────────────────┬───┬───────────────────────────┐
│ minimap │ axis  main  │ story- │ ╲ │  ┌─ card (your HTML) ───┐ │
│         │       lane  │ lines  │  ●──┤                      │ │
│         │ bands, spans, markers│   │  └──────────────────────┘ │
└─────────┴──────────────────────┴───┴───────────────────────────┘
            canvas                connectors      DOM cards
```

**[Playground →](https://thedefaultusr.github.io/vertical-timeline/)** (deployed from `main` by GitHub Actions; see [Releasing](#releasing))

## Install

```bash
npm install @defaultusr/vertical-timeline
```

It ships as an ES module with TypeScript types. It has one dependency, `d3-scale`, used for time ticks. It injects its own base styles, so no CSS import is needed.

## Quick start

```ts
import { VerticalTimeline } from '@defaultusr/vertical-timeline';

const timeline = new VerticalTimeline(document.getElementById('timeline')!, {
  storylines: [{ id: 'ww2', title: 'World War II', color: '#8b5fb0' }],
  items: [
    { id: 'poland', start: new Date(1939, 8, 1), title: 'Invasion of Poland', storyline: 'ww2', priority: 10 },
    { id: 'blitz', start: new Date(1940, 8, 7), end: new Date(1941, 4, 11), title: 'The Blitz', storyline: 'ww2' },
    { id: 'penicillin', start: new Date(1928, 8, 28), title: 'Penicillin discovered', color: '#d64545' },
  ],
  bands: [{ start: new Date(1929, 9, 1), end: new Date(1939, 0, 1), color: 'rgba(0,0,0,.05)', label: 'Great Depression' }],
  renderCard(item, el, lod) {
    const title = document.createElement('div');
    title.className = 'vt-card__title';
    title.textContent = item.title;
    el.append(title);
    if (lod === 'full') el.append(describe(item)); // your richer content
  },
});

timeline.on('select', (id) => console.log('selected', id));
timeline.setWindow(new Date(1935, 0, 1), new Date(1946, 0, 1));
```

The container needs a height (the timeline fills it), e.g. `#timeline { height: 100vh }`.

## Concepts

**Events** (`items`) are *momentary* (only `start`) or *spanning* (`start` and `end`). A momentary event is a dot; a spanning event is a bar in a lane beside the dots. Every event can have a card.

**Storylines** (`storylines`) are sets of connected events, such as "World War II" or "The French Revolution". A storyline is drawn as a rail from its first event to its last, with its title running down the rail. Storylines are packed into shared lanes by time: once one ends, a later one can take its lane. Events without a storyline go in the *main lane* on the left, which spans all time. Clicking a storyline's title zooms to it.

**Bands** are coloured background ranges (eras, recessions, etc.) with an optional label.

**Cards** are placed as close to their date as crowding allows, joined to it by a connector. As you zoom out, lower-`priority` cards shrink to `compact` and then disappear, leaving just the dot. Clicking an event (or calling `select(id)`) always shows its card in full.

**Input**
| | |
|---|---|
| Wheel / trackpad scroll, drag | Pan (drag has inertia) |
| Ctrl/⌘ + wheel, trackpad pinch, two-finger pinch | Zoom around the pointer |
| ↑ ↓, Page Up / Down, `+` / `-` | Pan / zoom (when the timeline has focus) |
| Click an event dot or bar, or a card | Select it; click again, click empty space, or press Esc to clear |
| Click a storyline title | Zoom to the storyline |
| Click or drag in the minimap | Jump / scroll |

## API

### `new VerticalTimeline(container, options?)`

| Option | Type | Default | |
|---|---|---|---|
| `items` | `TimelineItem[]` | `[]` | Events. |
| `storylines` | `TimelineStoryline[]` | `[]` | Storylines. |
| `bands` | `TimelineBand[]` | `[]` | Background ranges. |
| `renderCard` | `RenderCard` | title + date | Renders a card's content; see [Cards](#cards). |
| `colorScheme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | `auto` follows the OS setting. |
| `theme` | `Partial<TimelineTheme>` | from CSS | Canvas colour overrides; see [Styling](#styling). |
| `cardDensity` | `number` | `1.25` | How many cards to show at a given zoom. `1` = cards never overlap at their dates; higher shows more cards and lets them push each other further. |
| `maxDisplacement` | `number` | `0.5` | Furthest a card may be pushed from its date, in viewport heights, before it shrinks or hides. |
| `cardGap` | `number` | `8` | Vertical gap between cards, px. |
| `anchorOffset` | `number` | `18` | Distance from a card's top to where its connector attaches, px. |
| `estimatedFullHeight` | `number` | `120` | Card height guess used before a card is measured, px. Per item: `estimatedHeight`. |
| `estimatedCompactHeight` | `number` | `34` | Same, for compact cards. |
| `minimapWidth` | `number` | `56` | px |
| `axisWidth` | `number` | `76` | Width of the date axis, px. |
| `gutterWidth` | `number` | `72` | Space for connectors between track and cards, px. |
| `minMsPerPx` | `number` | `1000` | Zoom-in limit, milliseconds per pixel. |

The view initially fits all events.

### Data types

```ts
type TimeInput = Date | number;            // number = ms since epoch

interface TimelineItem {
  id: string;
  start: TimeInput;
  end?: TimeInput;          // present → spanning event
  title: string;
  storyline?: string;       // storyline id; missing or unknown → main lane
  color?: string;           // this event's colour (dot, bar, connector, card accent);
                            // overrides the storyline colour. Any canvas colour string.
  priority?: number;        // default 0; higher keeps its card longer when zooming out
  estimatedHeight?: number; // full card height hint, px
  data?: unknown;           // anything; passed through to renderCard
}

interface TimelineStoryline {
  id: string;
  title: string;
  color?: string;           // default colour of the storyline's events
  visible?: boolean;        // default true
}

interface TimelineBand {
  start: TimeInput;
  end: TimeInput;
  color: string;
  label?: string;
}
```

### Methods

| Method | |
|---|---|
| `setItems(items)` | Replace all events. Keeps the current view. |
| `setStorylines(storylines)` | Replace storylines; events are re-assigned by their `storyline` id. |
| `setBands(bands)` | Replace bands. |
| `setWindow(start, end)` | Show the range `[start, end]` across the viewport. |
| `select(id \| null)` | Select an event: its card is shown full even if zoom or crowding hid it, and the view scrolls to it if it's off screen. `null` clears. Unknown ids and events of hidden storylines are ignored. |
| `selected` | The selected id, or `null` (getter). |
| `focusStoryline(id)` | Zoom to fit a storyline. |
| `setStorylineVisible(id, visible)` / `isStorylineVisible(id)` | Hide or show a storyline's events and cards. A hidden storyline frees its lane. Hiding the selected event's storyline clears the selection. |
| `setColorScheme('auto' \| 'light' \| 'dark')` | Switch the palette. |
| `refreshTheme()` | Re-read canvas colours from CSS variables. Needed only when you change the variables yourself (the colour scheme, the OS setting and first attachment to the document are handled). |
| `on(event, fn)` | Subscribe; returns an unsubscribe function. |
| `destroy()` | Remove the timeline and all listeners. |
| `viewport` | Low-level view state (`t0`, `t1`, `msPerPx`, `timeToY()`, `zoomAt()`, `panBy()`, …). Call `invalidate()` after changing it. |

### Events

| Event | Payload | |
|---|---|---|
| `select` | `string \| null` | Selection changed (click, `select()`, or the selected event's storyline was hidden). |
| `hover` | `string \| null` | Pointer entered or left an event's dot, bar or card. |
| `rangechange` | `{ start: number; end: number }` | The visible range changed (ms). Fires once per frame at most. |

### Cards

```ts
type CardLod = 'full' | 'compact';
type RenderCard = (item: TimelineItem, el: HTMLElement, lod: CardLod) => void | (() => void);
```

`renderCard` fills `el`, the card element, with content. It's called when a card is mounted and again whenever its `lod` changes. If it returns a function, that function is called before the next render and when the card is unmounted. Use it to unmount framework components:

```ts
// React
renderCard(item, el, lod) {
  const root = createRoot(el);
  root.render(<EventCard item={item} compact={lod === 'compact'} />);
  return () => root.unmount();
}
```

Cards are virtualized: only cards near the viewport exist, and elements are reused. Keep per-card state in your own store rather than in the element. Card height can be anything, and changes (e.g. images loading) are picked up automatically. Clicks on links, buttons and inputs inside a card work normally and don't select the card.

## Styling

All colours are CSS custom properties on `.vt-root`, **including the canvas colours**. The timeline reads them at startup and whenever the colour scheme changes. The built-in defaults have zero specificity, so a plain rule overrides them:

```css
.vt-root {
  --vt-accent: #0a7cff;
  --vt-card-radius: 4px;
}
/* dark values, if you customise colours */
.vt-root[data-theme="dark"] { --vt-accent: #5aa6ff; }
@media (prefers-color-scheme: dark) {
  .vt-root:not([data-theme="light"]) { --vt-accent: #5aa6ff; }
}
```

| Variable | Used for |
|---|---|
| `--vt-font` | `font` shorthand for cards; the canvas uses its family |
| `--vt-bg` | Background (timeline, minimap, hollow dots) |
| `--vt-accent` | Default event colour (dots, bars, connectors, card accent) |
| `--vt-axis-text` | Axis labels, band labels |
| `--vt-grid-major`, `--vt-grid-minor` | Grid lines |
| `--vt-track` | Main lane line |
| `--vt-minimap-density`, `--vt-minimap-viewport` | Minimap plot and its viewport window |
| `--vt-card-bg`, `--vt-card-border`, `--vt-card-text`, `--vt-card-muted` | Cards |
| `--vt-card-radius`, `--vt-card-shadow` | Cards (shadow on hover / selection) |

**Dark mode**: `colorScheme: 'auto'` (the default) follows `prefers-color-scheme`, and `'light'` / `'dark'` force a palette by setting `data-theme` on `.vt-root`. If your app switches themes some other way (e.g. a class on `<html>` that changes these variables), call `timeline.refreshTheme()` afterwards so the canvas picks up the new colours.

**Per-event colour**: set `color` on an item. It colours the event's dot or bar, its connector, and its card: the left border, plus the `--vt-item-color` variable, which your card content can use (e.g. `color: var(--vt-item-color)`). If `color` is missing, the storyline's colour is used, then `--vt-accent`.

**Class names** for styling card content and state:

| Selector | |
|---|---|
| `.vt-card` | Every card (also `[data-id="<item id>"]`) |
| `.vt-card--full`, `.vt-card--compact` | Level of detail |
| `.vt-card--hover`, `.vt-card--selected` | State |
| `.vt-card__date`, `.vt-card__title` | Parts of the default card; reusable in your own |
| `.vt-root`, `.vt-minimap`, `.vt-body`, `.vt-cards` | Layout containers |

`theme` (constructor option) overrides canvas colours from JavaScript instead of CSS: `background`, `axisText`, `gridMajor`, `gridMinor`, `track`, `item`, `minimapDensity`, `minimapViewport`, `font`.

## Development

```bash
npm install
npm run dev          # playground at http://localhost:5173 (index.html + demo/)
npm test             # unit tests (vitest)
npm run typecheck
npm run build        # dist/vertical-timeline.js + dist/types
npm run build:demo   # static playground in site/
```

## Releasing

Two GitHub Actions workflows live in `.github/workflows/`:

- **`release.yml`** runs when a `v*` tag is pushed. It checks that the tag matches `package.json`, runs typecheck, tests and build, then `npm publish --provenance` and creates a GitHub release with generated notes. Prerelease versions (`1.2.0-beta.1`) are published under the `next` dist-tag.
  ```bash
  npm version minor        # bumps package.json and tags vX.Y.Z
  git push --follow-tags
  ```
  It authenticates with npm **trusted publishing** (OIDC), so there's no token or secret. One-time setup on npmjs.com: package settings → Trusted publisher → GitHub Actions, with owner `thedefaultusr`, repository `vertical-timeline` and workflow `release.yml`.
- **`pages.yml`** runs on every push to `main`. It runs the tests, builds the playground and deploys it to GitHub Pages. One-time setup: Settings → Pages → Source: **GitHub Actions**.

## How it works

Per animation frame, in this order (`src/Timeline.ts`):

1. **Viewport** (`core/Viewport.ts`): the only time ↔ y mapping. There is no native scroll anywhere; wheel, drag, pinch, keys and inertia all go through it (`interaction/Gestures.ts`), so DOM and canvases always come from the same frame.
2. **Card selection**: items within ±1 viewport, filtered by precomputed per-item **reveal thresholds** (`cards/reveal.ts`). Each item is revealed once the zoom gives it one card height of room from the nearest more important item; those neighbours are found for all items in O(n log n) with two monotonic-stack passes over the time-sorted items. The thresholds only change with zoom, so cards don't flicker. Each card is `full`, `compact` or hidden (dot only).
3. **Dodge** (`cards/dodge.ts`): an O(n) block-merge 1-D layout. It keeps the cards in order and stops them overlapping, while keeping the total squared distance from their dates as small as possible. The output changes continuously with the input, so cards glide during zoom.
   - **Budget** (`cards/budget.ts`): cards pushed further than `maxDisplacement` are demoted. In each crowded cluster of touching cards, the least important card gives way: it shrinks from full to compact, then is dropped. The order is: pinned spans (their anchor is approximate), then cards that weren't shown last frame, then shown cards dated off screen, then shown cards dated on screen. Priority decides within each tier. So scrolling never removes a card whose date is on screen. Cards being promoted must fit within 70% of the limit, which stops cards near the limit from flipping every frame.
   - **Selection**: the selected item is always a candidate, always full, and never demoted (`forced`), so clicking any marker shows its card even when zoom or crowding hid it; neighbours make room with eased motion.
   - **Easing jumps**: the layout only snaps when the card sequence changes: a point's date passes a span's card pinned near the top, a card mounts, or a card is resized. On those frames the previous sequence is laid out again at the current anchors, and the difference from the new layout becomes a per-card offset that decays (τ = 100ms). Cards sliding up go behind the others (z-index 0), and cards sliding down go in front (z-index 2).
4. **Cards** (`cards/CardLayer.ts`): virtualized and pooled DOM. New cards are measured in one batch, and later size changes are picked up by `ResizeObserver`. Cards are positioned only with `transform`.
5. **Storylines** (`layout/storylines.ts`): a storyline is a set of connected events, such as "World War II". It's drawn as a rail from its first event to its last, with its events on the rail, its spanning events in lanes beside it, and its title running down the rail. The title stays visible while the rail is on screen, and clicking it zooms to fit the storyline. Storylines are packed into shared lanes by time: a storyline takes the first lane whose previous storyline has already ended, so a lane is reused once a storyline is over. Events without a storyline sit in the main lane on the left, which spans all time. Hiding a storyline frees its lane; it only re-runs the lane packing and reveal thresholds, so items and measured card heights are kept. Items take their storyline's colour.
6. **Canvases**: axis, grid, bands, spans and points (`render/TimelineRenderer.ts`; markers are batched into one path per colour); connectors (`render/ConnectorRenderer.ts`); and the minimap, whose density plot is cached and redrawn only when data or size changes (`render/Minimap.ts`). Colours come from the CSS variables (`styles.ts`). Canvases are re-sized when `devicePixelRatio` changes (moving to another display), via a `resolution` media query.

## Not done yet

- Nested storylines; keeping a storyline's lane stable when others are hidden or added
- Mounting cards during idle time, with skeletons while flinging (zoom-in frames currently spike to ~10–20ms when many cards change level of detail at once)
- Clusters (`+12`) on the track when zoomed out
- Hidden DOM copy of the timeline for screen readers, and keyboard focus for items
- Editing (drag to move / resize)

## License

[MIT](LICENSE)
