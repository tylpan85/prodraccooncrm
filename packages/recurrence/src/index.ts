// ---------------------------------------------------------------------------
// Recurrence Engine — TypeScript port from beta
// ---------------------------------------------------------------------------

export const RECURRENCE_ENGINE_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurrenceEndMode = 'never' | 'after_n_occurrences' | 'on_date';
export type DayOfWeek = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';
export type Ordinal = 'first' | 'second' | 'third' | 'fourth' | 'fifth' | 'last';
export type MonthOfYear =
  | 'JAN'
  | 'FEB'
  | 'MAR'
  | 'APR'
  | 'MAY'
  | 'JUN'
  | 'JUL'
  | 'AUG'
  | 'SEP'
  | 'OCT'
  | 'NOV'
  | 'DEC';

export interface RecurrenceRule {
  recurrenceFrequency: RecurrenceFrequency;
  recurrenceInterval: number;
  recurrenceEndMode: RecurrenceEndMode;
  recurrenceOccurrenceCount?: number | null;
  recurrenceEndDate?: string | null;
  recurrenceDayOfWeek?: DayOfWeek[] | null;
  recurrenceDayOfMonth?: number | null;
  recurrenceOrdinal?: Ordinal | null;
  recurrenceMonthOfYear?: MonthOfYear | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_NAMES: DayOfWeek[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const ORDINAL_MAP: Record<Ordinal, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
  last: -1,
};

const MONTH_MAP: Record<MonthOfYear, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

// ---------------------------------------------------------------------------
// generateOccurrenceDates
// ---------------------------------------------------------------------------

/**
 * Generate occurrence dates for a recurring series.
 *
 * @param rule - The recurrence rule
 * @param anchorDate - The start date of the first occurrence (local date)
 * @param maxCount - Maximum number of dates to generate
 * @param horizonDate - Do not generate dates past this point
 * @param startIndex - Start generating from this occurrence index (0-based)
 * @returns Array of occurrence local dates
 */
export function generateOccurrenceDates(
  rule: RecurrenceRule,
  anchorDate: Date,
  maxCount: number,
  horizonDate: Date,
  startIndex = 0,
): Date[] {
  const dates: Date[] = [];
  const normalizedAnchor = new Date(
    anchorDate.getFullYear(),
    anchorDate.getMonth(),
    anchorDate.getDate(),
  );
  const {
    recurrenceFrequency,
    recurrenceInterval,
    recurrenceEndMode,
    recurrenceOccurrenceCount,
    recurrenceEndDate,
  } = rule;

  const effectiveMaxOccurrences =
    recurrenceEndMode === 'after_n_occurrences'
      ? (recurrenceOccurrenceCount ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;

  const effectiveEndDate =
    recurrenceEndMode === 'on_date' && recurrenceEndDate
      ? new Date(`${recurrenceEndDate}T23:59:59`)
      : null;

  let occurrenceCount = 0;
  let iterationLimit = 5000;

  const generator = getGenerator(recurrenceFrequency);

  for (const candidateDate of generator(rule, normalizedAnchor, recurrenceInterval)) {
    if (--iterationLimit <= 0) break;

    if (candidateDate > horizonDate) break;
    if (effectiveEndDate && candidateDate > effectiveEndDate) break;
    if (occurrenceCount >= effectiveMaxOccurrences) break;

    if (occurrenceCount >= startIndex) {
      dates.push(candidateDate);
    }

    occurrenceCount++;

    if (dates.length >= maxCount) break;
  }

  return dates;
}

// ---------------------------------------------------------------------------
// Generator lookup
// ---------------------------------------------------------------------------

type DateGenerator = (
  rule: RecurrenceRule,
  anchor: Date,
  interval: number,
) => Generator<Date, void, undefined>;

function getGenerator(frequency: RecurrenceFrequency): DateGenerator {
  switch (frequency) {
    case 'daily':
      return generateDaily;
    case 'weekly':
      return generateWeekly;
    case 'monthly':
      return generateMonthly;
    case 'yearly':
      return generateYearly;
    default:
      throw new Error(`Unsupported recurrence frequency: ${frequency}`);
  }
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

function* generateDaily(
  _rule: RecurrenceRule,
  anchor: Date,
  interval: number,
): Generator<Date, void, undefined> {
  const current = new Date(anchor);
  while (true) {
    yield new Date(current);
    current.setDate(current.getDate() + interval);
  }
}

// ---------------------------------------------------------------------------
// Weekly
// ---------------------------------------------------------------------------

function* generateWeekly(
  rule: RecurrenceRule,
  anchor: Date,
  interval: number,
): Generator<Date, void, undefined> {
  const targetDays =
    rule.recurrenceDayOfWeek && rule.recurrenceDayOfWeek.length > 0
      ? rule.recurrenceDayOfWeek
          .map((d) => DAY_NAMES.indexOf(d))
          .filter((i) => i >= 0)
          .sort((a, b) => a - b)
      : [anchor.getDay()];

  const anchorDayOfWeek = anchor.getDay();

  // Find the start of the anchor's week (Sunday)
  const weekStart = new Date(anchor);
  weekStart.setDate(weekStart.getDate() - anchorDayOfWeek);

  while (true) {
    for (const dayIndex of targetDays) {
      const candidate = new Date(weekStart);
      candidate.setDate(candidate.getDate() + dayIndex);

      // Skip dates before the anchor
      if (candidate < anchor) continue;

      yield candidate;
    }

    weekStart.setDate(weekStart.getDate() + 7 * interval);
  }
}

// ---------------------------------------------------------------------------
// Monthly
// ---------------------------------------------------------------------------

function* generateMonthly(
  rule: RecurrenceRule,
  anchor: Date,
  interval: number,
): Generator<Date, void, undefined> {
  const { recurrenceOrdinal, recurrenceDayOfWeek } = rule;

  if (recurrenceOrdinal && recurrenceDayOfWeek && recurrenceDayOfWeek.length > 0) {
    yield* generateMonthlyOrdinal(rule, anchor, interval);
  } else {
    yield* generateMonthlyByDay(rule, anchor, interval);
  }
}

function* generateMonthlyByDay(
  rule: RecurrenceRule,
  anchor: Date,
  interval: number,
): Generator<Date, void, undefined> {
  const targetDay = rule.recurrenceDayOfMonth || anchor.getDate();
  let year = anchor.getFullYear();
  let month = anchor.getMonth();

  while (true) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    if (targetDay <= daysInMonth) {
      const candidate = new Date(year, month, targetDay);
      if (candidate >= anchor) {
        yield candidate;
      }
    }
    // If targetDay > daysInMonth, skip this month (per business rule)

    month += interval;
    if (month >= 12) {
      year += Math.floor(month / 12);
      month = month % 12;
    }
  }
}

function* generateMonthlyOrdinal(
  rule: RecurrenceRule,
  anchor: Date,
  interval: number,
): Generator<Date, void, undefined> {
  const rOrdinal = rule.recurrenceOrdinal;
  const rDow = rule.recurrenceDayOfWeek;
  if (!rOrdinal || !rDow || rDow.length === 0) return;

  const ordinal = ORDINAL_MAP[rOrdinal];
  const targetDayIndex = DAY_NAMES.indexOf(rDow[0] as DayOfWeek);

  let year = anchor.getFullYear();
  let month = anchor.getMonth();

  while (true) {
    const candidate = findOrdinalWeekday(year, month, ordinal, targetDayIndex);

    if (candidate && candidate >= anchor) {
      yield candidate;
    }

    month += interval;
    if (month >= 12) {
      year += Math.floor(month / 12);
      month = month % 12;
    }
  }
}

function findOrdinalWeekday(
  year: number,
  month: number,
  ordinal: number,
  targetDayIndex: number,
): Date | null {
  if (ordinal === -1) {
    // "last" - find last occurrence of this weekday in the month
    const lastDay = new Date(year, month + 1, 0);
    const current = new Date(lastDay);
    while (current.getDay() !== targetDayIndex) {
      current.setDate(current.getDate() - 1);
    }
    return current;
  }

  // Find the first occurrence of the target weekday
  const firstOccurrence = new Date(year, month, 1);
  while (firstOccurrence.getDay() !== targetDayIndex) {
    firstOccurrence.setDate(firstOccurrence.getDate() + 1);
  }

  // Jump to the Nth occurrence
  const candidate = new Date(firstOccurrence);
  candidate.setDate(candidate.getDate() + ordinal * 7);

  // Validate it's still in the same month
  if (candidate.getMonth() !== month) {
    return null; // Skip - 5th weekday doesn't exist
  }

  return candidate;
}

// ---------------------------------------------------------------------------
// Yearly
// ---------------------------------------------------------------------------

function* generateYearly(
  rule: RecurrenceRule,
  anchor: Date,
  interval: number,
): Generator<Date, void, undefined> {
  const { recurrenceOrdinal, recurrenceDayOfWeek, recurrenceMonthOfYear } = rule;

  if (
    recurrenceOrdinal &&
    recurrenceDayOfWeek &&
    recurrenceDayOfWeek.length > 0 &&
    recurrenceMonthOfYear
  ) {
    yield* generateYearlyOrdinal(rule, anchor, interval);
  } else {
    yield* generateYearlyByDate(rule, anchor, interval);
  }
}

function* generateYearlyByDate(
  rule: RecurrenceRule,
  anchor: Date,
  interval: number,
): Generator<Date, void, undefined> {
  const targetMonth = rule.recurrenceMonthOfYear
    ? MONTH_MAP[rule.recurrenceMonthOfYear]
    : anchor.getMonth();
  const targetDay = rule.recurrenceDayOfMonth || anchor.getDate();

  let year = anchor.getFullYear();

  while (true) {
    const daysInMonth = new Date(year, targetMonth + 1, 0).getDate();

    if (targetDay <= daysInMonth) {
      const candidate = new Date(year, targetMonth, targetDay);
      if (candidate >= anchor) {
        yield candidate;
      }
    }

    year += interval;
  }
}

function* generateYearlyOrdinal(
  rule: RecurrenceRule,
  anchor: Date,
  interval: number,
): Generator<Date, void, undefined> {
  const rOrdinal = rule.recurrenceOrdinal;
  const rDow = rule.recurrenceDayOfWeek;
  const rMonth = rule.recurrenceMonthOfYear;
  if (!rOrdinal || !rDow || rDow.length === 0 || !rMonth) return;

  const ordinal = ORDINAL_MAP[rOrdinal];
  const targetDayIndex = DAY_NAMES.indexOf(rDow[0] as DayOfWeek);
  const targetMonth = MONTH_MAP[rMonth];

  let year = anchor.getFullYear();

  while (true) {
    const candidate = findOrdinalWeekday(year, targetMonth, ordinal, targetDayIndex);

    if (candidate && candidate >= anchor) {
      yield candidate;
    }

    year += interval;
  }
}

// ---------------------------------------------------------------------------
// computeHorizonDate
// ---------------------------------------------------------------------------

/**
 * Compute the materialization horizon date from now.
 */
export function computeHorizonDate(ruleOrFrequency: RecurrenceRule | string): Date {
  const now = new Date();
  const rule: Partial<RecurrenceRule> =
    typeof ruleOrFrequency === 'string'
      ? { recurrenceFrequency: ruleOrFrequency as RecurrenceFrequency }
      : ruleOrFrequency || {};

  if (rule.recurrenceEndMode === 'on_date' && rule.recurrenceEndDate) {
    return new Date(`${rule.recurrenceEndDate}T23:59:59.999`);
  }

  if (rule.recurrenceEndMode === 'never') {
    switch (rule.recurrenceFrequency) {
      case 'daily':
        return new Date(now.getFullYear() + 3, now.getMonth(), now.getDate());
      case 'weekly':
      case 'monthly':
        return new Date(now.getFullYear() + 20, now.getMonth(), now.getDate());
      case 'yearly':
        return new Date(now.getFullYear() + 50, now.getMonth(), now.getDate());
      default:
        return new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
    }
  }

  if (rule.recurrenceFrequency === 'yearly') {
    return new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());
  }

  return new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
}

// ---------------------------------------------------------------------------
// describeRecurrenceRule
// ---------------------------------------------------------------------------

/**
 * Format a rule into a human-readable summary.
 */
export function describeRecurrenceRule(rule: RecurrenceRule): string {
  const { recurrenceFrequency, recurrenceInterval } = rule;
  const interval = recurrenceInterval;

  switch (recurrenceFrequency) {
    case 'daily':
      return interval === 1 ? 'Daily' : `Every ${interval} days`;
    case 'weekly': {
      const days = (rule.recurrenceDayOfWeek || []).join(', ');
      const base = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
      return days ? `${base} on ${days}` : base;
    }
    case 'monthly': {
      const base = interval === 1 ? 'Monthly' : `Every ${interval} months`;
      if (rule.recurrenceOrdinal && rule.recurrenceDayOfWeek?.length) {
        return `${base} on the ${rule.recurrenceOrdinal} ${rule.recurrenceDayOfWeek[0]}`;
      }
      if (rule.recurrenceDayOfMonth) {
        return `${base} on day ${rule.recurrenceDayOfMonth}`;
      }
      return base;
    }
    case 'yearly': {
      return interval === 1 ? 'Yearly' : `Every ${interval} years`;
    }
    default:
      return 'Custom';
  }
}
