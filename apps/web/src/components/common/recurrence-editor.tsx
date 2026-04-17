'use client';

import type { RecurrenceRuleInput } from '@openclaw/shared';
import { useEffect, useMemo, useState } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

// ── Types ──────────────────────────────────────────────────────────────

type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
type EndMode = 'never' | 'after_n_occurrences' | 'on_date';
type DayOfWeek = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

const ALL_DAYS: DayOfWeek[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_LABELS: Record<DayOfWeek, string> = {
  SUN: 'S',
  MON: 'M',
  TUE: 'T',
  WED: 'W',
  THU: 'T',
  FRI: 'F',
  SAT: 'S',
};
const DAY_NAMES: Record<DayOfWeek, string> = {
  SUN: 'Sunday',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
};

type Ordinal = 'first' | 'second' | 'third' | 'fourth' | 'fifth' | 'last';
const ORDINALS: { value: Ordinal; label: string }[] = [
  { value: 'first', label: 'First' },
  { value: 'second', label: 'Second' },
  { value: 'third', label: 'Third' },
  { value: 'fourth', label: 'Fourth' },
  { value: 'fifth', label: 'Fifth' },
  { value: 'last', label: 'Last' },
];

const FREQ_LABELS: Record<Frequency, string> = {
  daily: 'Day',
  weekly: 'Week',
  monthly: 'Month',
  yearly: 'Year',
};
const FREQ_LABELS_PLURAL: Record<Frequency, string> = {
  daily: 'Days',
  weekly: 'Weeks',
  monthly: 'Months',
  yearly: 'Years',
};

// ── Presets ─────────────────────────────────────────────────────────────

type PresetKey = 'none' | 'daily' | 'weekly' | 'monthly_day' | 'monthly_ordinal' | 'yearly' | 'weekdays' | 'custom';

function getPresetsForDate(date: Date | null): { key: PresetKey; label: string }[] {
  const presets: { key: PresetKey; label: string }[] = [
    { key: 'none', label: 'Does not repeat' },
    { key: 'daily', label: 'Daily' },
  ];

  if (date) {
    const dayName = DAY_NAMES[dayOfWeekFromDate(date)];
    presets.push({ key: 'weekly', label: `Weekly on ${dayName}` });

    const dom = date.getDate();
    presets.push({ key: 'monthly_day', label: `Monthly on day ${dom}` });

    const ordinalInMonth = getOrdinalForDate(date);
    presets.push({
      key: 'monthly_ordinal',
      label: `Monthly on the ${ordinalInMonth.label.toLowerCase()} ${dayName}`,
    });

    const monthName = date.toLocaleString('en-US', { month: 'long' });
    presets.push({ key: 'yearly', label: `Annually on ${monthName} ${dom}` });
  } else {
    presets.push({ key: 'weekly', label: 'Weekly' });
    presets.push({ key: 'monthly_day', label: 'Monthly' });
    presets.push({ key: 'yearly', label: 'Annually' });
  }

  presets.push({ key: 'weekdays', label: 'Every weekday (Mon – Fri)' });
  presets.push({ key: 'custom', label: 'Custom…' });

  return presets;
}

function dayOfWeekFromDate(d: Date): DayOfWeek {
  return ALL_DAYS[d.getDay()] ?? 'SUN';
}

function getOrdinalForDate(d: Date): { value: Ordinal; label: string } {
  const dom = d.getDate();
  const weekNum = Math.ceil(dom / 7);
  const idx = weekNum <= 5 ? weekNum - 1 : 5;
  return ORDINALS[idx] ?? ORDINALS[0]!;
}

function presetToRule(key: PresetKey, date: Date | null): RecurrenceRuleInput | null {
  if (key === 'none') return null;

  const base = {
    recurrenceInterval: 1,
    recurrenceEndMode: 'never' as EndMode,
    recurrenceOccurrenceCount: null,
    recurrenceEndDate: null,
    recurrenceDayOfWeek: null,
    recurrenceDayOfMonth: null,
    recurrenceOrdinal: null,
    recurrenceMonthOfYear: null,
  };

  switch (key) {
    case 'daily':
      return { ...base, recurrenceFrequency: 'daily' };
    case 'weekly':
      return {
        ...base,
        recurrenceFrequency: 'weekly',
        recurrenceDayOfWeek: date ? [dayOfWeekFromDate(date)] : ['MON'],
      };
    case 'monthly_day':
      return {
        ...base,
        recurrenceFrequency: 'monthly',
        recurrenceDayOfMonth: date ? date.getDate() : 1,
      };
    case 'monthly_ordinal': {
      const ordinal = date ? getOrdinalForDate(date) : ORDINALS[0]!;
      const dow = date ? dayOfWeekFromDate(date) : 'MON';
      return {
        ...base,
        recurrenceFrequency: 'monthly',
        recurrenceOrdinal: ordinal.value,
        recurrenceDayOfWeek: [dow],
      };
    }
    case 'yearly': {
      const month = date
        ? (['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const)[date.getMonth()]
        : 'JAN';
      return {
        ...base,
        recurrenceFrequency: 'yearly',
        recurrenceDayOfMonth: date ? date.getDate() : 1,
        recurrenceMonthOfYear: month,
      };
    }
    case 'weekdays':
      return {
        ...base,
        recurrenceFrequency: 'weekly',
        recurrenceDayOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      };
    case 'custom':
      return {
        ...base,
        recurrenceFrequency: 'weekly',
        recurrenceDayOfWeek: date ? [dayOfWeekFromDate(date)] : ['MON'],
      };
  }
}

// ── Component ──────────────────────────────────────────────────────────

export interface RecurrenceEditorProps {
  /** The job's scheduled start date (used for smart presets). Null if unscheduled. */
  scheduledDate: Date | null;
  /** Current rule, or null for "Does not repeat" */
  value: RecurrenceRuleInput | null;
  /** Callback when rule changes */
  onChange: (rule: RecurrenceRuleInput | null) => void;
  disabled?: boolean;
}

export function RecurrenceEditor({ scheduledDate, value, onChange, disabled }: RecurrenceEditorProps) {
  const [showCustom, setShowCustom] = useState(false);
  const presets = useMemo(() => getPresetsForDate(scheduledDate), [scheduledDate]);

  // Determine which preset matches the current value
  const activePreset = useMemo((): PresetKey => {
    if (!value) return 'none';
    if (showCustom) return 'custom';

    // Try to match each preset
    for (const p of presets) {
      if (p.key === 'none' || p.key === 'custom') continue;
      const rule = presetToRule(p.key, scheduledDate);
      if (rule && rulesMatch(value, rule)) return p.key;
    }
    return 'custom';
  }, [value, showCustom, presets, scheduledDate]);

  function handlePresetChange(key: PresetKey) {
    if (key === 'custom') {
      setShowCustom(true);
      if (!value) {
        onChange(presetToRule('weekly', scheduledDate));
      }
      return;
    }
    setShowCustom(false);
    onChange(presetToRule(key, scheduledDate));
  }

  return (
    <div className="space-y-4">
      {/* Preset dropdown */}
      <div>
        <Label>Repeats</Label>
        <select
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          value={activePreset}
          onChange={(e) => handlePresetChange(e.target.value as PresetKey)}
          disabled={disabled}
        >
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Custom editor */}
      {showCustom && value && (
        <CustomRecurrenceEditor value={value} onChange={onChange} disabled={disabled} />
      )}
    </div>
  );
}

// ── Custom editor ──────────────────────────────────────────────────────

function CustomRecurrenceEditor({
  value,
  onChange,
  disabled,
}: {
  value: RecurrenceRuleInput;
  onChange: (rule: RecurrenceRuleInput) => void;
  disabled?: boolean;
}) {
  const freq = value.recurrenceFrequency;
  const interval = value.recurrenceInterval;

  function patch(partial: Partial<RecurrenceRuleInput>) {
    onChange({ ...value, ...partial });
  }

  function onFrequencyChange(newFreq: Frequency) {
    const updates: Partial<RecurrenceRuleInput> = { recurrenceFrequency: newFreq };
    // Reset sub-fields when frequency changes
    if (newFreq !== 'weekly') updates.recurrenceDayOfWeek = null;
    if (newFreq !== 'monthly' && newFreq !== 'yearly') {
      updates.recurrenceDayOfMonth = null;
      updates.recurrenceOrdinal = null;
    }
    if (newFreq !== 'yearly') updates.recurrenceMonthOfYear = null;
    if (newFreq === 'weekly') updates.recurrenceDayOfWeek = value.recurrenceDayOfWeek ?? ['MON'];
    patch(updates);
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {/* Repeats every N {unit} */}
      <div>
        <Label className="text-sm font-semibold">Repeats every</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={999}
            className="w-20"
            value={interval}
            onChange={(e) => patch({ recurrenceInterval: Math.max(1, Number(e.target.value) || 1) })}
            disabled={disabled}
          />
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={freq}
            onChange={(e) => onFrequencyChange(e.target.value as Frequency)}
            disabled={disabled}
          >
            {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((f) => (
              <option key={f} value={f}>
                {interval === 1 ? FREQ_LABELS[f] : FREQ_LABELS_PLURAL[f]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Weekly: day-of-week circles */}
      {freq === 'weekly' && (
        <WeekdayPicker
          selected={value.recurrenceDayOfWeek ?? []}
          onChange={(days) => patch({ recurrenceDayOfWeek: days })}
          disabled={disabled}
        />
      )}

      {/* Monthly: day-of-month or ordinal+day */}
      {freq === 'monthly' && (
        <MonthlyOptions value={value} onChange={patch} disabled={disabled} />
      )}

      {/* Yearly: month + day-of-month */}
      {freq === 'yearly' && (
        <YearlyOptions value={value} onChange={patch} disabled={disabled} />
      )}

      {/* Ends */}
      <EndModeEditor value={value} onChange={patch} disabled={disabled} />
    </div>
  );
}

// ── Weekday picker (circle buttons) ────────────────────────────────────

function WeekdayPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: DayOfWeek[];
  onChange: (days: DayOfWeek[]) => void;
  disabled?: boolean;
}) {
  function toggle(day: DayOfWeek) {
    if (selected.includes(day)) {
      if (selected.length === 1) return; // must have at least one
      onChange(selected.filter((d) => d !== day));
    } else {
      onChange([...selected, day]);
    }
  }

  return (
    <div>
      <Label className="text-sm font-semibold">Repeats on</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {ALL_DAYS.map((day) => {
          const active = selected.includes(day);
          return (
            <button
              key={day}
              type="button"
              className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-medium transition-colors ${
                active
                  ? 'border-blue-500 bg-blue-500 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50'
              }`}
              onClick={() => toggle(day)}
              disabled={disabled}
              title={DAY_NAMES[day]}
            >
              {DAY_LABELS[day]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Monthly options ────────────────────────────────────────────────────

type MonthlyMode = 'day_of_month' | 'ordinal_day';

function MonthlyOptions({
  value,
  onChange,
  disabled,
}: {
  value: RecurrenceRuleInput;
  onChange: (partial: Partial<RecurrenceRuleInput>) => void;
  disabled?: boolean;
}) {
  const mode: MonthlyMode = value.recurrenceOrdinal ? 'ordinal_day' : 'day_of_month';

  return (
    <div className="space-y-3">
      <Label className="text-sm font-semibold">Repeats on</Label>
      <div className="space-y-2">
        {/* Day of month */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="monthlyMode"
            className="h-4 w-4"
            checked={mode === 'day_of_month'}
            onChange={() =>
              onChange({
                recurrenceDayOfMonth: value.recurrenceDayOfMonth || 1,
                recurrenceOrdinal: null,
                recurrenceDayOfWeek: null,
              })
            }
            disabled={disabled}
          />
          <span>Day</span>
          <Input
            type="number"
            min={1}
            max={31}
            className="w-16"
            value={mode === 'day_of_month' ? value.recurrenceDayOfMonth ?? 1 : 1}
            onChange={(e) => onChange({ recurrenceDayOfMonth: Number(e.target.value) || 1 })}
            disabled={disabled || mode !== 'day_of_month'}
          />
        </label>

        {/* Ordinal + day of week */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="monthlyMode"
            className="h-4 w-4"
            checked={mode === 'ordinal_day'}
            onChange={() =>
              onChange({
                recurrenceOrdinal: value.recurrenceOrdinal || 'first',
                recurrenceDayOfWeek: value.recurrenceDayOfWeek?.length
                  ? value.recurrenceDayOfWeek
                  : ['MON'],
                recurrenceDayOfMonth: null,
              })
            }
            disabled={disabled}
          />
          <span>The</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            value={value.recurrenceOrdinal ?? 'first'}
            onChange={(e) => onChange({ recurrenceOrdinal: e.target.value as Ordinal })}
            disabled={disabled || mode !== 'ordinal_day'}
          >
            {ORDINALS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            value={value.recurrenceDayOfWeek?.[0] ?? 'MON'}
            onChange={(e) => onChange({ recurrenceDayOfWeek: [e.target.value as DayOfWeek] })}
            disabled={disabled || mode !== 'ordinal_day'}
          >
            {ALL_DAYS.map((d) => (
              <option key={d} value={d}>
                {DAY_NAMES[d]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// ── Yearly options ─────────────────────────────────────────────────────

const MONTHS = [
  { value: 'JAN', label: 'January' },
  { value: 'FEB', label: 'February' },
  { value: 'MAR', label: 'March' },
  { value: 'APR', label: 'April' },
  { value: 'MAY', label: 'May' },
  { value: 'JUN', label: 'June' },
  { value: 'JUL', label: 'July' },
  { value: 'AUG', label: 'August' },
  { value: 'SEP', label: 'September' },
  { value: 'OCT', label: 'October' },
  { value: 'NOV', label: 'November' },
  { value: 'DEC', label: 'December' },
] as const;

function YearlyOptions({
  value,
  onChange,
  disabled,
}: {
  value: RecurrenceRuleInput;
  onChange: (partial: Partial<RecurrenceRuleInput>) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label className="text-sm font-semibold">On</Label>
      <div className="mt-1.5 flex items-center gap-2">
        <select
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          value={value.recurrenceMonthOfYear ?? 'JAN'}
          onChange={(e) => onChange({ recurrenceMonthOfYear: e.target.value as typeof MONTHS[number]['value'] })}
          disabled={disabled}
        >
          {MONTHS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <Input
          type="number"
          min={1}
          max={31}
          className="w-16"
          value={value.recurrenceDayOfMonth ?? 1}
          onChange={(e) => onChange({ recurrenceDayOfMonth: Number(e.target.value) || 1 })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// ── End mode editor ────────────────────────────────────────────────────

function EndModeEditor({
  value,
  onChange,
  disabled,
}: {
  value: RecurrenceRuleInput;
  onChange: (partial: Partial<RecurrenceRuleInput>) => void;
  disabled?: boolean;
}) {
  const endMode = value.recurrenceEndMode;

  return (
    <div>
      <Label className="text-sm font-semibold">Ends</Label>
      <div className="mt-1.5 space-y-2">
        {/* Never */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="endMode"
            className="h-4 w-4"
            checked={endMode === 'never'}
            onChange={() =>
              onChange({
                recurrenceEndMode: 'never',
                recurrenceOccurrenceCount: null,
                recurrenceEndDate: null,
              })
            }
            disabled={disabled}
          />
          Never
        </label>

        {/* After N occurrences */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="endMode"
            className="h-4 w-4"
            checked={endMode === 'after_n_occurrences'}
            onChange={() =>
              onChange({
                recurrenceEndMode: 'after_n_occurrences',
                recurrenceOccurrenceCount: value.recurrenceOccurrenceCount || 2,
                recurrenceEndDate: null,
              })
            }
            disabled={disabled}
          />
          After
          <Input
            type="number"
            min={1}
            className="w-16"
            value={value.recurrenceOccurrenceCount ?? 2}
            onChange={(e) => onChange({ recurrenceOccurrenceCount: Math.max(1, Number(e.target.value) || 1) })}
            disabled={disabled || endMode !== 'after_n_occurrences'}
          />
          occurrence{(value.recurrenceOccurrenceCount ?? 2) !== 1 ? 's' : ''}
        </label>

        {/* On date */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="endMode"
            className="h-4 w-4"
            checked={endMode === 'on_date'}
            onChange={() =>
              onChange({
                recurrenceEndMode: 'on_date',
                recurrenceOccurrenceCount: null,
                recurrenceEndDate: value.recurrenceEndDate || todayString(),
              })
            }
            disabled={disabled}
          />
          On
          <input
            type="date"
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm"
            value={value.recurrenceEndDate ?? ''}
            onChange={(e) => onChange({ recurrenceEndDate: e.target.value })}
            disabled={disabled || endMode !== 'on_date'}
          />
        </label>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function rulesMatch(a: RecurrenceRuleInput, b: RecurrenceRuleInput): boolean {
  if (a.recurrenceFrequency !== b.recurrenceFrequency) return false;
  if (a.recurrenceInterval !== b.recurrenceInterval) return false;
  if (a.recurrenceEndMode !== b.recurrenceEndMode) return false;

  const aDays = (a.recurrenceDayOfWeek ?? []).slice().sort();
  const bDays = (b.recurrenceDayOfWeek ?? []).slice().sort();
  if (aDays.length !== bDays.length || aDays.some((d, i) => d !== bDays[i])) return false;

  if ((a.recurrenceDayOfMonth ?? null) !== (b.recurrenceDayOfMonth ?? null)) return false;
  if ((a.recurrenceOrdinal ?? null) !== (b.recurrenceOrdinal ?? null)) return false;
  if ((a.recurrenceMonthOfYear ?? null) !== (b.recurrenceMonthOfYear ?? null)) return false;

  return true;
}
