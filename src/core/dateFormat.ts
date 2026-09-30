/**
 * What an axis tick marks: the largest calendar boundary it falls on (local
 * time). 'week' is a day-level tick when ticks are a week or more apart, so
 * it reads as a date ("Feb 7") rather than a weekday ("Sat 7").
 */
export type TickUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond';

/** Formats an axis tick label. */
export type FormatTick = (date: Date, unit: TickUnit) => string;

const DAY = 86_400_000;

const TICK_OPTIONS: Record<TickUnit, Intl.DateTimeFormatOptions> = {
  year: { year: 'numeric' },
  month: { month: 'long' },
  week: { month: 'short', day: 'numeric' },
  day: { weekday: 'short', day: 'numeric' },
  hour: { hour: 'numeric', minute: '2-digit' },
  minute: { hour: 'numeric', minute: '2-digit' },
  second: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  millisecond: { second: '2-digit', fractionalSecondDigits: 3 },
};

export function tickUnit(date: Date, step: number): TickUnit {
  if (date.getMilliseconds()) return 'millisecond';
  if (date.getSeconds()) return 'second';
  if (date.getMinutes()) return 'minute';
  if (date.getHours()) return 'hour';
  if (date.getDate() !== 1) return step >= 7 * DAY ? 'week' : 'day';
  if (date.getMonth()) return 'month';
  return 'year';
}

/**
 * Locale-aware date formatting for axis ticks and default cards, built on
 * Intl (month and weekday names, ordering, 12/24 h clock and digits for any
 * locale, no extra data). Formatters are created once per locale, since
 * constructing an Intl.DateTimeFormat is slow and the axis draws every frame.
 */
export class DateFormats {
  /** The resolved BCP 47 locale, e.g. 'de-DE'. */
  readonly locale: string;
  readonly cardDate: Intl.DateTimeFormat;
  private tick = new Map<TickUnit, Intl.DateTimeFormat>();

  constructor(locale?: string | string[]) {
    this.cardDate = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' });
    this.locale = this.cardDate.resolvedOptions().locale;
    for (const [unit, options] of Object.entries(TICK_OPTIONS) as [TickUnit, Intl.DateTimeFormatOptions][]) {
      this.tick.set(unit, new Intl.DateTimeFormat(locale, options));
    }
  }

  formatTick: FormatTick = (date, unit) => this.tick.get(unit)!.format(date);
}

/**
 * Representative (date, unit) pairs covering the widest labels of each unit
 * (every month name and weekday, two-digit days, late hours in 12 and 24 h
 * clocks), for sizing the axis to the locale.
 */
export function sampleTicks(): [Date, TickUnit][] {
  const samples: [Date, TickUnit][] = [[new Date(2888, 0, 1), 'year']];
  for (let m = 0; m < 12; m++) {
    samples.push([new Date(2024, m, 1), 'month'], [new Date(2024, m, 28), 'week']);
  }
  for (let d = 22; d <= 28; d++) samples.push([new Date(2024, 0, d), 'day']);
  for (const h of [12, 23]) {
    samples.push([new Date(2024, 0, 28, h, 58), 'minute'], [new Date(2024, 0, 28, h, 58, 58), 'second']);
  }
  return samples;
}
