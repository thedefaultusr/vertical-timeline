import type { TimelineBand, TimelineStoryline, TimelineItem } from '../src';

export interface DemoData {
  items: TimelineItem[];
  storylines: TimelineStoryline[];
  bands: TimelineBand[];
}

export interface CardData {
  body: string;
  media: boolean;
  tags: string[];
  key: boolean;
}

/** Colour given to "key events" when highlighting is on (per-event colour). */
export const KEY_EVENT_COLOR = '#d64545';

// Storylines: connected events with a start and an end. [id, title, colour, from, to, events]
const STORYLINES: [string, string, string, number, number, number][] = [
  ['genome', 'Human Genome Project', '#3f8f6b', 1990.8, 2003.3, 14],
  ['dotcom', 'Dot-com bubble', '#c0622f', 1995.6, 2002.8, 16],
  ['euro', 'Euro introduction', '#4a6fa5', 1995.9, 2002.2, 9],
  ['iss', 'International Space Station', '#8b5fb0', 1998.9, 2011.5, 14],
  ['gfc', 'Global financial crisis', '#b8903a', 2007.4, 2009.9, 18],
  ['arab', 'Arab Spring', '#c0622f', 2010.95, 2012.9, 12],
  ['brexit', 'Brexit', '#4a6fa5', 2016.4, 2020.1, 12],
  ['covid', 'COVID-19 pandemic', '#3f8f6b', 2019.95, 2023.4, 16],
];

const TAGS = ['politics', 'science', 'culture', 'economy', 'sport', 'tech', 'space', 'health'];
const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat'.split(' ');

const START = Date.UTC(1990, 0, 1);
const END = Date.UTC(2025, 11, 31);
const YEAR = 365.25 * 86_400_000;
const yearToMs = (y: number) => Date.UTC(Math.floor(y), 0, 1) + (y % 1) * YEAR;

export const BANDS: TimelineBand[] = [
  { start: Date.UTC(1990, 0, 1), end: Date.UTC(2000, 0, 1), color: 'rgba(74,111,165,0.06)', label: '1990s' },
  { start: Date.UTC(2007, 11, 1), end: Date.UTC(2009, 5, 30), color: 'rgba(192,98,47,0.10)', label: 'Recession' },
  { start: Date.UTC(2010, 0, 1), end: Date.UTC(2020, 0, 1), color: 'rgba(74,111,165,0.06)', label: '2010s' },
  { start: Date.UTC(2020, 2, 1), end: Date.UTC(2022, 2, 1), color: 'rgba(63,143,107,0.10)', label: 'Pandemic' },
];

export const STORYLINE_LIST: TimelineStoryline[] = STORYLINES.map(([id, title, color]) => ({ id, title, color }));

/**
 * Deterministic sample data: `mainLaneEvents` events in the main lane (clustered
 * in a few busy periods) plus the storylines. With `highlightKeyEvents`, the
 * top ~4% by priority get their own colour, overriding their storyline's.
 */
export function generate(mainLaneEvents: number, highlightKeyEvents: boolean): DemoData {
  let seed = 42;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const sentence = (n: number) => {
    const words = Array.from({ length: n }, () => pick(WORDS));
    words[0] = words[0][0].toUpperCase() + words[0].slice(1);
    return words.join(' ') + '.';
  };
  const clusters = Array.from({ length: 8 }, () => START + rand() * (END - START));
  const randomTime = () => {
    if (rand() < 0.4) return START + rand() * (END - START);
    return Math.min(END, Math.max(START, pick(clusters) + (rand() - 0.5) * YEAR * 1.5));
  };
  const event = (id: number, start: number, end: number | undefined, priority: number, extra: Partial<TimelineItem>): TimelineItem => {
    const key = priority >= 96;
    const data: CardData = {
      body: rand() < 0.8 ? sentence(8 + Math.floor(rand() * 40)) : '',
      media: rand() < 0.3,
      tags: Array.from({ length: Math.floor(rand() * 3) }, () => pick(TAGS)),
      key,
    };
    return {
      id: `e${id}`,
      start,
      end,
      title: sentence(3 + Math.floor(rand() * 5)).slice(0, -1),
      priority,
      estimatedHeight: 150,
      ...extra,
      ...(highlightKeyEvents && key ? { color: KEY_EVENT_COLOR } : {}),
      data,
    };
  };

  let nextId = 0;
  const items: TimelineItem[] = [];
  for (let i = 0; i < mainLaneEvents; i++) {
    const start = randomTime();
    const end = rand() < 0.12 ? start + (0.1 + rand() * 2) * YEAR : undefined;
    items.push(event(nextId++, start, end, Math.floor(rand() * 100), { color: '#7a7f87' }));
  }
  // Storyline events: spread over the storyline, first and last on its ends.
  for (const [storyline, , , from, to, count] of STORYLINES) {
    const a = yearToMs(from);
    const b = yearToMs(to);
    for (let k = 0; k < count; k++) {
      const start = k === 0 ? a : k === count - 1 ? b : a + rand() * (b - a);
      const end = k > 0 && k < count - 1 && rand() < 0.2 ? Math.min(b, start + (0.05 + rand() * 0.5) * YEAR) : undefined;
      items.push(event(nextId++, start, end, 30 + Math.floor(rand() * 70), { storyline }));
    }
  }
  return { items, storylines: STORYLINE_LIST, bands: BANDS };
}
