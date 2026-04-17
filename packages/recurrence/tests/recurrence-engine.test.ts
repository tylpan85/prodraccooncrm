import { describe, expect, it } from 'vitest';
import {
  type RecurrenceRule,
  computeHorizonDate,
  describeRecurrenceRule,
  generateOccurrenceDates,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Helper to make rules concise
// ---------------------------------------------------------------------------

function weeklyRule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    recurrenceFrequency: 'weekly',
    recurrenceInterval: 1,
    recurrenceDayOfWeek: ['FRI'],
    recurrenceEndMode: 'after_n_occurrences',
    recurrenceOccurrenceCount: 4,
    ...overrides,
  };
}

function at<T>(arr: T[], i: number): T {
  return arr[i] as T;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

describe('daily recurrence', () => {
  it('generates daily dates with interval 1', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'daily',
      recurrenceInterval: 1,
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 5,
    };
    const anchor = new Date(2026, 3, 17); // Apr 17
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates).toHaveLength(5);
    expect(toDateStr(at(dates, 0))).toBe('2026-04-17');
    expect(toDateStr(at(dates, 4))).toBe('2026-04-21');
  });

  it('generates daily dates with interval 3', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'daily',
      recurrenceInterval: 3,
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 4,
    };
    const anchor = new Date(2026, 3, 1);
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates.map(toDateStr)).toEqual(['2026-04-01', '2026-04-04', '2026-04-07', '2026-04-10']);
  });
});

// ---------------------------------------------------------------------------
// Weekly
// ---------------------------------------------------------------------------

describe('weekly recurrence', () => {
  it('generates weekly Friday dates after_n_occurrences=4', () => {
    const rule = weeklyRule({ recurrenceOccurrenceCount: 4 });
    const anchor = new Date(2026, 3, 17); // Friday Apr 17
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates).toHaveLength(4);
    expect(dates.map(toDateStr)).toEqual(['2026-04-17', '2026-04-24', '2026-05-01', '2026-05-08']);
  });

  it('handles multiple days per week', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'weekly',
      recurrenceInterval: 1,
      recurrenceDayOfWeek: ['MON', 'WED', 'FRI'],
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 6,
    };
    const anchor = new Date(2026, 3, 13); // Monday
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates).toHaveLength(6);
    expect(toDateStr(at(dates, 0))).toBe('2026-04-13');
    expect(toDateStr(at(dates, 1))).toBe('2026-04-15');
    expect(toDateStr(at(dates, 2))).toBe('2026-04-17');
    expect(toDateStr(at(dates, 3))).toBe('2026-04-20');
  });

  it('biweekly skips every other week', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'weekly',
      recurrenceInterval: 2,
      recurrenceDayOfWeek: ['FRI'],
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 3,
    };
    const anchor = new Date(2026, 3, 17); // Friday
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates.map(toDateStr)).toEqual(['2026-04-17', '2026-05-01', '2026-05-15']);
  });

  it('weekly never-ending is not truncated after one year', () => {
    const rule = weeklyRule({
      recurrenceEndMode: 'never',
      recurrenceOccurrenceCount: null,
    });
    const anchor = new Date(2026, 3, 17);
    const horizon = computeHorizonDate(rule);
    const dates = generateOccurrenceDates(rule, anchor, 5000, horizon);
    const lastDate = at(dates, dates.length - 1);
    expect(lastDate.getFullYear()).toBeGreaterThanOrEqual(2027);
  });
});

// ---------------------------------------------------------------------------
// Monthly — day of month
// ---------------------------------------------------------------------------

describe('monthly day-of-month recurrence', () => {
  it('monthly on the 15th', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'monthly',
      recurrenceInterval: 1,
      recurrenceDayOfMonth: 15,
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 4,
    };
    const anchor = new Date(2026, 0, 15); // Jan 15
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates.map(toDateStr)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('monthly 31st skips months without 31 days', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'monthly',
      recurrenceInterval: 1,
      recurrenceDayOfMonth: 31,
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 5,
    };
    const anchor = new Date(2026, 0, 31); // Jan 31
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates.map(toDateStr)).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
      '2026-08-31',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Monthly — ordinal weekday
// ---------------------------------------------------------------------------

describe('monthly ordinal weekday recurrence', () => {
  it('second Friday of every month', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'monthly',
      recurrenceInterval: 1,
      recurrenceOrdinal: 'second',
      recurrenceDayOfWeek: ['FRI'],
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 3,
    };
    const anchor = new Date(2026, 0, 9); // Jan 9 = 2nd Friday
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates.map(toDateStr)).toEqual(['2026-01-09', '2026-02-13', '2026-03-13']);
  });

  it('fifth weekday skips months without that position', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'monthly',
      recurrenceInterval: 1,
      recurrenceOrdinal: 'fifth',
      recurrenceDayOfWeek: ['THU'],
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 4,
    };
    // Jan 29, 2026 is a Thursday (5th Thursday)
    const anchor = new Date(2026, 0, 29);
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates.map(toDateStr)).toEqual(['2026-01-29', '2026-04-30', '2026-07-30', '2026-10-29']);
  });

  it('last Monday of every month', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'monthly',
      recurrenceInterval: 1,
      recurrenceOrdinal: 'last',
      recurrenceDayOfWeek: ['MON'],
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 3,
    };
    const anchor = new Date(2026, 0, 26); // Jan 26 = last Monday
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates.map(toDateStr)).toEqual(['2026-01-26', '2026-02-23', '2026-03-30']);
  });
});

// ---------------------------------------------------------------------------
// Yearly
// ---------------------------------------------------------------------------

describe('yearly recurrence', () => {
  it('yearly on April 10', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'yearly',
      recurrenceInterval: 1,
      recurrenceMonthOfYear: 'APR',
      recurrenceDayOfMonth: 10,
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 3,
    };
    const anchor = new Date(2026, 3, 10);
    const horizon = new Date(2030, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates.map(toDateStr)).toEqual(['2026-04-10', '2027-04-10', '2028-04-10']);
  });

  it('yearly ordinal: 3rd Wednesday of May', () => {
    const rule: RecurrenceRule = {
      recurrenceFrequency: 'yearly',
      recurrenceInterval: 1,
      recurrenceOrdinal: 'third',
      recurrenceDayOfWeek: ['WED'],
      recurrenceMonthOfYear: 'MAY',
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 3,
    };
    const anchor = new Date(2026, 4, 20); // May 20, 2026 = 3rd Wednesday
    const horizon = new Date(2030, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates).toHaveLength(3);
    // Verify all are Wednesdays in May
    for (const d of dates) {
      expect(d.getDay()).toBe(3); // Wednesday
      expect(d.getMonth()).toBe(4); // May
    }
  });
});

// ---------------------------------------------------------------------------
// End modes
// ---------------------------------------------------------------------------

describe('end modes', () => {
  it('on_date stops at the end date', () => {
    const rule = weeklyRule({
      recurrenceEndMode: 'on_date',
      recurrenceEndDate: '2026-05-01',
      recurrenceOccurrenceCount: null,
    });
    const anchor = new Date(2026, 3, 17); // Apr 17 Friday
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates.map(toDateStr)).toEqual(['2026-04-17', '2026-04-24', '2026-05-01']);
  });

  it('after_n_occurrences stops at count', () => {
    const rule = weeklyRule({ recurrenceOccurrenceCount: 2 });
    const anchor = new Date(2026, 3, 17);
    const horizon = new Date(2027, 0, 1);
    const dates = generateOccurrenceDates(rule, anchor, 100, horizon);
    expect(dates).toHaveLength(2);
  });

  it('horizon limits results even for never-ending', () => {
    const rule = weeklyRule({
      recurrenceEndMode: 'never',
      recurrenceOccurrenceCount: null,
    });
    const anchor = new Date(2026, 3, 17);
    const shortHorizon = new Date(2026, 4, 10); // ~3 weeks away
    const dates = generateOccurrenceDates(rule, anchor, 1000, shortHorizon);
    expect(dates.length).toBeLessThanOrEqual(4);
    for (const d of dates) {
      expect(d <= shortHorizon).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// startIndex
// ---------------------------------------------------------------------------

describe('startIndex', () => {
  it('skips first N occurrences', () => {
    const rule = weeklyRule({ recurrenceOccurrenceCount: 5 });
    const anchor = new Date(2026, 3, 17);
    const horizon = new Date(2027, 0, 1);

    const all = generateOccurrenceDates(rule, anchor, 100, horizon, 0);
    const skipped = generateOccurrenceDates(rule, anchor, 100, horizon, 2);

    expect(all).toHaveLength(5);
    expect(skipped).toHaveLength(3);
    expect(toDateStr(at(skipped, 0))).toBe(toDateStr(at(all, 2)));
  });
});

// ---------------------------------------------------------------------------
// computeHorizonDate
// ---------------------------------------------------------------------------

describe('computeHorizonDate', () => {
  it('on_date returns end date', () => {
    const h = computeHorizonDate({
      recurrenceFrequency: 'weekly',
      recurrenceInterval: 1,
      recurrenceEndMode: 'on_date',
      recurrenceEndDate: '2030-06-15',
    });
    expect(h.getFullYear()).toBe(2030);
    expect(h.getMonth()).toBe(5); // June
    expect(h.getDate()).toBe(15);
  });

  it('never + daily gives now + 3 years', () => {
    const h = computeHorizonDate({
      recurrenceFrequency: 'daily',
      recurrenceInterval: 1,
      recurrenceEndMode: 'never',
    });
    const now = new Date();
    expect(h.getFullYear()).toBe(now.getFullYear() + 3);
  });

  it('never + weekly gives now + 20 years', () => {
    const h = computeHorizonDate({
      recurrenceFrequency: 'weekly',
      recurrenceInterval: 1,
      recurrenceEndMode: 'never',
    });
    const now = new Date();
    expect(h.getFullYear()).toBe(now.getFullYear() + 20);
  });

  it('never + yearly gives now + 50 years', () => {
    const h = computeHorizonDate({
      recurrenceFrequency: 'yearly',
      recurrenceInterval: 1,
      recurrenceEndMode: 'never',
    });
    const now = new Date();
    expect(h.getFullYear()).toBe(now.getFullYear() + 50);
  });

  it('after_n + yearly gives now + 5 years', () => {
    const h = computeHorizonDate({
      recurrenceFrequency: 'yearly',
      recurrenceInterval: 1,
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 10,
    });
    const now = new Date();
    expect(h.getFullYear()).toBe(now.getFullYear() + 5);
  });

  it('fallback gives now + 1 year', () => {
    const h = computeHorizonDate({
      recurrenceFrequency: 'weekly',
      recurrenceInterval: 1,
      recurrenceEndMode: 'after_n_occurrences',
      recurrenceOccurrenceCount: 10,
    });
    const now = new Date();
    expect(h.getFullYear()).toBe(now.getFullYear() + 1);
  });
});

// ---------------------------------------------------------------------------
// describeRecurrenceRule
// ---------------------------------------------------------------------------

describe('describeRecurrenceRule', () => {
  it('daily interval 1', () => {
    expect(
      describeRecurrenceRule({
        recurrenceFrequency: 'daily',
        recurrenceInterval: 1,
        recurrenceEndMode: 'never',
      }),
    ).toBe('Daily');
  });

  it('daily interval 3', () => {
    expect(
      describeRecurrenceRule({
        recurrenceFrequency: 'daily',
        recurrenceInterval: 3,
        recurrenceEndMode: 'never',
      }),
    ).toBe('Every 3 days');
  });

  it('weekly with days', () => {
    expect(
      describeRecurrenceRule({
        recurrenceFrequency: 'weekly',
        recurrenceInterval: 2,
        recurrenceEndMode: 'never',
        recurrenceDayOfWeek: ['MON', 'WED'],
      }),
    ).toBe('Every 2 weeks on MON, WED');
  });

  it('monthly ordinal', () => {
    expect(
      describeRecurrenceRule({
        recurrenceFrequency: 'monthly',
        recurrenceInterval: 1,
        recurrenceEndMode: 'never',
        recurrenceOrdinal: 'second',
        recurrenceDayOfWeek: ['FRI'],
      }),
    ).toBe('Monthly on the second FRI');
  });

  it('monthly day-of-month', () => {
    expect(
      describeRecurrenceRule({
        recurrenceFrequency: 'monthly',
        recurrenceInterval: 1,
        recurrenceEndMode: 'never',
        recurrenceDayOfMonth: 15,
      }),
    ).toBe('Monthly on day 15');
  });

  it('yearly', () => {
    expect(
      describeRecurrenceRule({
        recurrenceFrequency: 'yearly',
        recurrenceInterval: 1,
        recurrenceEndMode: 'never',
      }),
    ).toBe('Yearly');
  });
});
