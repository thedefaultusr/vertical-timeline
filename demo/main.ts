import { VerticalTimeline, type ColorScheme, type RenderCard, type TimelineOptions } from '../src';
import { generate, KEY_EVENT_COLOR, STORYLINE_LIST, type CardData } from './data';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** Card date formatters per locale ('' = the browser's). */
const cardDates = new Map<string, Intl.DateTimeFormat>();
function cardDate(): Intl.DateTimeFormat {
  let format = cardDates.get(state.locale);
  if (!format) {
    format = new Intl.DateTimeFormat(state.locale || undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    cardDates.set(state.locale, format);
  }
  return format;
}
const storylineTitle = new Map(STORYLINE_LIST.map((s) => [s.id, s.title]));

const renderCard: RenderCard = (item, el, lod) => {
  const data = item.data as CardData;
  const when = item.end !== undefined ? cardDate().formatRange(item.start, item.end) : cardDate().format(item.start);
  const date = item.storyline ? `${storylineTitle.get(item.storyline)} · ${when}` : when;
  if (lod === 'compact') {
    el.innerHTML = `<div class="vt-card__title"></div>`;
    el.firstElementChild!.textContent = item.title;
    return;
  }
  el.innerHTML = `
    <div class="vt-card__date"></div>
    <div class="vt-card__title"></div>
    ${data.media ? '<div class="demo-card__media"></div>' : ''}
    ${data.body ? '<p class="demo-card__body"></p>' : ''}
    <div class="demo-card__tags"></div>
    <a class="demo-card__link" href="#${item.id}">Read more →</a>`;
  el.querySelector('.vt-card__date')!.textContent = date;
  el.querySelector('.vt-card__title')!.textContent = item.title;
  const body = el.querySelector('.demo-card__body');
  if (body) body.textContent = data.body;
  const tags = el.querySelector('.demo-card__tags')!;
  if (item.color === KEY_EVENT_COLOR) tags.append(tag('key event', 'demo-card__tag demo-card__tag--key'));
  for (const t of data.tags) tags.append(tag(t, 'demo-card__tag'));
};

function tag(text: string, className: string): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

// Playground state -------------------------------------------------------

const state = {
  scheme: 'auto' as ColorScheme,
  /** BCP 47 tag; '' follows the browser. */
  locale: '',
  events: 360,
  highlight: true,
  markers: true,
  cardDensity: 1.25,
  maxDisplacement: 0.5,
  hidden: new Set<string>(),
};

const DAY = 86_400_000;
const container = $<HTMLDivElement>('#timeline');
let data = generate(state.events, state.highlight);
let timeline = create();
timeline.setWindow(Date.UTC(2006, 6, 1), Date.UTC(2011, 0, 1));

/** Constructor options can't change on a live instance: recreate, keeping the view. */
function create(): VerticalTimeline {
  const options: TimelineOptions = {
    ...data,
    storylines: data.storylines.map((s) => ({ ...s, visible: !state.hidden.has(s.id) })),
    markers: state.markers ? data.markers : [],
    renderCard,
    colorScheme: state.scheme,
    locale: state.locale || undefined,
    cardDensity: state.cardDensity,
    maxDisplacement: state.maxDisplacement,
  };
  const tl = new VerticalTimeline(container, options);
  // Clicking a marker's label zooms to the three months either side of it.
  tl.on('markerclick', (id) => {
    const marker = data.markers.find((m) => m.id === id);
    if (marker) tl.setWindow(+marker.at - 91 * DAY, +marker.at + 91 * DAY);
  });
  Object.assign(window, { timeline: tl });
  return tl;
}

function recreate(): void {
  const { t0, t1 } = timeline.viewport;
  const selected = timeline.selected;
  timeline.destroy();
  timeline = create();
  timeline.setWindow(t0, t1);
  if (selected) timeline.select(selected);
}

// Controls ---------------------------------------------------------------

function applyScheme(scheme: ColorScheme): void {
  state.scheme = scheme;
  if (scheme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = scheme;
  timeline.setColorScheme(scheme);
}

$<HTMLSelectElement>('#scheme').addEventListener('change', (e) => applyScheme((e.target as HTMLSelectElement).value as ColorScheme));

$<HTMLSelectElement>('#locale').addEventListener('change', (e) => {
  state.locale = (e.target as HTMLSelectElement).value;
  timeline.setLocale(state.locale || undefined); // re-renders cards, which read state.locale
});

$<HTMLSelectElement>('#events').addEventListener('change', (e) => {
  state.events = Number((e.target as HTMLSelectElement).value);
  data = generate(state.events, state.highlight);
  timeline.setItems(data.items);
});

$<HTMLInputElement>('#markers').addEventListener('change', (e) => {
  state.markers = (e.target as HTMLInputElement).checked;
  timeline.setMarkers(state.markers ? data.markers : []);
});

$<HTMLInputElement>('#highlight').addEventListener('change', (e) => {
  state.highlight = (e.target as HTMLInputElement).checked;
  data = generate(state.events, state.highlight);
  timeline.setItems(data.items);
});

function bindRange(id: string, key: 'cardDensity' | 'maxDisplacement'): void {
  const input = $<HTMLInputElement>(`#${id}`);
  const output = $<HTMLOutputElement>(`#${id}-value`);
  output.textContent = String(state[key]);
  input.value = String(state[key]);
  input.addEventListener('input', () => (output.textContent = input.value));
  input.addEventListener('change', () => {
    state[key] = Number(input.value);
    recreate();
  });
}
bindRange('density', 'cardDensity');
bindRange('displacement', 'maxDisplacement');

const storylines = $<HTMLUListElement>('#storylines');
for (const storyline of STORYLINE_LIST) {
  const li = document.createElement('li');
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = true;
  box.addEventListener('change', () => {
    if (box.checked) state.hidden.delete(storyline.id);
    else state.hidden.add(storyline.id);
    timeline.setStorylineVisible(storyline.id, box.checked);
  });
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = storyline.color!;
  label.append(box, swatch, storyline.title);
  const zoom = document.createElement('button');
  zoom.type = 'button';
  zoom.textContent = 'Zoom';
  zoom.addEventListener('click', () => timeline.focusStoryline(storyline.id));
  li.append(label, zoom);
  storylines.append(li);
}

// Stats ------------------------------------------------------------------

const stats = $<HTMLSpanElement>('#stats');
let frames = 0;
let last = performance.now();
function measure(now: number) {
  frames++;
  if (now - last >= 500) {
    const fps = Math.round((frames * 1000) / (now - last));
    const cards = container.querySelectorAll('.vt-card').length;
    stats.textContent = `${fps} fps · ${cards} cards · ${data.items.length.toLocaleString()} events`;
    frames = 0;
    last = now;
  }
  requestAnimationFrame(measure);
}
requestAnimationFrame(measure);
