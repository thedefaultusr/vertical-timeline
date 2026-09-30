import { describe, expect, it } from 'vitest';
import { DateFormats, sampleTicks, tickUnit } from '../src/core/dateFormat';

const DAY = 86_400_000;

describe('tickUnit', () => {
  it('picks the largest calendar boundary a tick falls on', () => {
    expect(tickUnit(new Date(2009, 0, 1), DAY)).toBe('year');
    expect(tickUnit(new Date(2009, 1, 1), DAY)).toBe('month');
    expect(tickUnit(new Date(2009, 1, 7), DAY)).toBe('day');
    expect(tickUnit(new Date(2009, 1, 7, 14), 3_600_000)).toBe('hour');
    expect(tickUnit(new Date(2009, 1, 7, 14, 5), 60_000)).toBe('minute');
    expect(tickUnit(new Date(2009, 1, 7, 14, 5, 9), 1000)).toBe('second');
    expect(tickUnit(new Date(2009, 1, 7, 14, 5, 9, 120), 10)).toBe('millisecond');
  });

  it('labels day ticks as dates when they are a week or more apart', () => {
    expect(tickUnit(new Date(2009, 1, 8), 7 * DAY)).toBe('week');
    expect(tickUnit(new Date(2009, 1, 8), DAY)).toBe('day');
  });
});

describe('DateFormats', () => {
  const feb7 = new Date(2009, 1, 7);

  it('formats ticks in the requested locale', () => {
    const en = new DateFormats('en-US');
    const de = new DateFormats('de-DE');
    const ru = new DateFormats('ru-RU');
    expect(en.formatTick(new Date(2009, 1, 1), 'month')).toBe('February');
    expect(de.formatTick(new Date(2009, 1, 1), 'month')).toBe('Februar');
    expect(ru.formatTick(new Date(2009, 1, 1), 'month')).toBe('февраль');
    expect(en.formatTick(feb7, 'week')).toBe('Feb 7');
    expect(de.formatTick(feb7, 'week')).toBe('7. Feb.');
    expect(en.formatTick(new Date(2009, 0, 1), 'year')).toBe('2009');
  });

  it('uses the locale clock and digits', () => {
    const at = new Date(2009, 1, 7, 14, 5);
    expect(new DateFormats('de-DE').formatTick(at, 'minute')).toBe('14:05');
    expect(new DateFormats('en-US').formatTick(at, 'minute')).toMatch(/^2:05\sPM$/);
    expect(new DateFormats('ar-EG').formatTick(new Date(2009, 0, 1), 'year')).toBe('٢٠٠٩');
  });

  it('resolves the locale and falls back for unsupported tags', () => {
    expect(new DateFormats('de-DE').locale).toBe('de-DE');
    expect(new DateFormats(['xx-XX', 'fr-FR']).locale).toBe('fr-FR');
  });
});

describe('sampleTicks', () => {
  it('covers every month and weekday', () => {
    const samples = sampleTicks();
    expect(new Set(samples.filter(([, u]) => u === 'month').map(([d]) => d.getMonth())).size).toBe(12);
    expect(new Set(samples.filter(([, u]) => u === 'day').map(([d]) => d.getDay())).size).toBe(7);
  });
});
