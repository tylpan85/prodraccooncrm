'use client';

import type { EventDto, JobDto, TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Repeat2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { ApiClientError } from '../../../lib/api-client';
import { cn } from '../../../lib/cn';
import { eventsApi } from '../../../lib/events-api';
import { jobsApi } from '../../../lib/jobs-api';
import type { DayResponse, RangeResponse } from '../../../lib/scheduler-api';
import { schedulerApi } from '../../../lib/scheduler-api';
import { settingsApi } from '../../../lib/settings-api';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function formatDayHeader(date: string): string {
  const [y, m, dd] = date.split('-').map(Number) as [number, number, number];
  const d = new Date(y, m - 1, dd, 12);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatMonthHeader(date: string): string {
  const [y, m, dd] = date.split('-').map(Number) as [number, number, number];
  const d = new Date(y, m - 1, dd, 12);
  return d.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

/** Get calendar grid dates for a month (6 rows × 7 cols, Sunday-start) */
function getMonthGrid(date: string): string[] {
  const first = new Date(`${startOfMonth(date)}T12:00:00Z`);
  const dayOfWeek = first.getUTCDay(); // 0=Sunday
  const gridStart = new Date(first);
  gridStart.setUTCDate(gridStart.getUTCDate() - dayOfWeek);

  const dates: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function isSameMonth(date: string, refDate: string): boolean {
  return date.slice(0, 7) === refDate.slice(0, 7);
}

function parseHour(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatScheduleRange(startIso: string, endIso: string): string {
  return `${formatDate(startIso)} · ${formatTime(startIso)} – ${formatTime(endIso)}`;
}

function formatSnappedHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const period = h < 12 ? 'AM' : 'PM';
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
}

function formatDateShort(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  const dt = new Date(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const STAGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  scheduled:         { bg: 'bg-slate-200',   text: 'text-slate-700', label: 'Scheduled' },
  confirmation_sent: { bg: 'bg-blue-100',    text: 'text-blue-700',  label: 'Conf. Sent' },
  confirmed:         { bg: 'bg-green-100',   text: 'text-green-700', label: 'Confirmed' },
  job_done:          { bg: 'bg-emerald-600', text: 'text-white',     label: 'Done' },
  cancelled:         { bg: 'bg-red-100',     text: 'text-red-700',   label: 'Cancelled' },
};

function StageBadge({ stage, size = 'sm' }: { stage: string; size?: 'xs' | 'sm' }) {
  const s = STAGE_STYLES[stage] ?? { bg: 'bg-slate-200', text: 'text-slate-700', label: 'Scheduled' };
  const cls = size === 'xs'
    ? 'rounded-full px-1.5 py-px text-[9px] font-semibold'
    : 'rounded-full px-2 py-px text-[10px] font-semibold';
  return (
    <span className={`${cls} ${s.bg} ${s.text}`}>{s.label}</span>
  );
}

interface ColumnInfo {
  col: number;
  totalCols: number;
}

function computeColumns(jobs: Array<{ id: string; scheduledStartAt: string; scheduledEndAt: string }>): Map<string, ColumnInfo> {
  if (jobs.length === 0) return new Map();

  const sorted = [...jobs].sort(
    (a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime(),
  );

  const colEnds: number[] = [];
  const jobColMap = new Map<string, number>();

  for (const job of sorted) {
    const start = new Date(job.scheduledStartAt).getTime();
    const end = new Date(job.scheduledEndAt).getTime();
    let assigned = -1;
    for (let c = 0; c < colEnds.length; c++) {
      if ((colEnds[c] ?? Infinity) <= start) {
        colEnds[c] = end;
        assigned = c;
        break;
      }
    }
    if (assigned === -1) {
      assigned = colEnds.length;
      colEnds.push(end);
    }
    jobColMap.set(job.id, assigned);
  }

  const result = new Map<string, ColumnInfo>();
  for (const job of jobs) {
    const start = new Date(job.scheduledStartAt).getTime();
    const end = new Date(job.scheduledEndAt).getTime();
    let maxCol = jobColMap.get(job.id) ?? 0;
    for (const other of jobs) {
      if (other.id === job.id) continue;
      const os = new Date(other.scheduledStartAt).getTime();
      const oe = new Date(other.scheduledEndAt).getTime();
      if (os < end && oe > start) {
        maxCol = Math.max(maxCol, jobColMap.get(other.id) ?? 0);
      }
    }
    result.set(job.id, { col: jobColMap.get(job.id) ?? 0, totalCols: maxCol + 1 });
  }

  return result;
}

function formatRecurrence(info: {
  frequency: string;
  interval: number;
  daysOfWeek: string[];
  dayOfMonth: number | null;
  ordinal: string | null;
}): string {
  const DAY: Record<string, string> = {
    SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday',
    THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday',
  };
  const ORD: Record<string, string> = {
    first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', last: 'last',
  };
  const { frequency, interval, daysOfWeek, dayOfMonth, ordinal } = info;
  const days = daysOfWeek.map((d) => DAY[d] ?? d).join(', ');

  if (frequency === 'daily') {
    return interval === 1 ? 'Every day' : `Every ${interval} days`;
  }
  if (frequency === 'weekly') {
    const suffix = days ? ` on ${days}` : '';
    if (interval === 1) return `Every week${suffix}`;
    if (interval === 2) return `Biweekly${suffix}`;
    return `Every ${interval} weeks${suffix}`;
  }
  if (frequency === 'monthly') {
    const prefix = interval === 1 ? 'Every month' : `Every ${interval} months`;
    if (ordinal && daysOfWeek.length > 0) return `${prefix} on ${ORD[ordinal] ?? ordinal} ${DAY[daysOfWeek[0]!] ?? daysOfWeek[0]}`;
    if (dayOfMonth) return `${prefix} on day ${dayOfMonth}`;
    return prefix;
  }
  if (frequency === 'yearly') {
    return interval === 1 ? 'Every year' : `Every ${interval} years`;
  }
  return 'Recurring';
}

function hourToDatetimeLocal(date: string, hour: number): string {
  const h = String(Math.floor(hour)).padStart(2, '0');
  const m = String(Math.round((hour % 1) * 60)).padStart(2, '0');
  return `${date}T${h}:${m}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOUR_HEIGHT = 60; // px per hour
const MIN_HOUR = 6;
const MAX_HOUR = 23;
const DEFAULT_START_HOUR = 7;
const MIN_BLOCK_DURATION = 0.5; // 30 min minimum display

// ---------------------------------------------------------------------------
// Calendar display preferences
// ---------------------------------------------------------------------------

type CalendarPrefs = {
  showJobNumber: boolean;
  showCustomerName: boolean;
  showService: boolean;
  showAddress: boolean;
  showTime: boolean;
  showPrice: boolean;
  showTags: boolean;
  showRecurringText: boolean;
};

const DEFAULT_PREFS: CalendarPrefs = {
  showJobNumber: true,
  showCustomerName: true,
  showService: false,
  showAddress: false,
  showTime: true,
  showPrice: true,
  showTags: true,
  showRecurringText: true,
};

const PREFS_STORAGE_KEY = 'raccoon_calendar_prefs';

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SchedulerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const view = (searchParams.get('view') as 'day' | 'month') || 'day';
  const date = searchParams.get('date') || today();

  // Navigation helpers
  const navigate = useCallback(
    (params: { view?: string; date?: string; team?: string; showUnassigned?: string }) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        if (v === '') {
          sp.delete(k);
        } else {
          sp.set(k, v);
        }
      }
      router.push(`/scheduler?${sp.toString()}` as Route);
    },
    [router, searchParams],
  );

  const goToday = useCallback(() => navigate({ date: today() }), [navigate]);
  const goPrev = useCallback(
    () => navigate({ date: view === 'day' ? addDays(date, -1) : addMonths(date, -1) }),
    [navigate, view, date],
  );
  const goNext = useCallback(
    () => navigate({ date: view === 'day' ? addDays(date, 1) : addMonths(date, 1) }),
    [navigate, view, date],
  );
  const setView = useCallback((v: 'day' | 'month') => navigate({ view: v }), [navigate]);
  const setDate = useCallback((d: string) => navigate({ date: d }), [navigate]);

  // Team filter from URL
  const teamParam = searchParams.get('team') || '';
  const showUnassigned = searchParams.get('showUnassigned') !== '0';
  const activeTeamIds = useMemo(() => {
    if (!teamParam) return null; // null = show all
    return new Set(teamParam.split(',').filter(Boolean));
  }, [teamParam]);

  const toggleTeamMember = useCallback(
    (id: string) => {
      const current = activeTeamIds ? new Set(activeTeamIds) : null;
      if (!current) {
        // First filter: show only this one
        navigate({ team: id, showUnassigned: '0' });
        return;
      }
      if (current.has(id)) {
        current.delete(id);
      } else {
        current.add(id);
      }
      const teamStr = [...current].join(',');
      navigate({ team: teamStr || '' });
    },
    [activeTeamIds, navigate],
  );

  const toggleUnassigned = useCallback(() => {
    navigate({ showUnassigned: showUnassigned ? '0' : '1' });
  }, [showUnassigned, navigate]);

  const showAllTeams = useCallback(() => {
    navigate({ team: '', showUnassigned: '1' });
  }, [navigate]);

  // Slide-over state
  const [slideOver, setSlideOver] = useState<
    { type: 'job'; id: string } | { type: 'event'; id: string } | null
  >(null);

  // Calendar display prefs (persisted to localStorage)
  const [calendarPrefs, setCalendarPrefs] = useState<CalendarPrefs>(() => {
    if (typeof window === 'undefined') return DEFAULT_PREFS;
    try {
      const saved = localStorage.getItem(PREFS_STORAGE_KEY);
      return saved ? { ...DEFAULT_PREFS, ...JSON.parse(saved) } : DEFAULT_PREFS;
    } catch {
      return DEFAULT_PREFS;
    }
  });

  const updatePref = useCallback((key: keyof CalendarPrefs, value: boolean) => {
    setCalendarPrefs((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't fire when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (e.key) {
        case 't':
          goToday();
          break;
        case 'ArrowLeft':
          goPrev();
          break;
        case 'ArrowRight':
          goNext();
          break;
        case 'd':
          setView('day');
          break;
        case 'm':
          setView('month');
          break;
        case 'Escape':
          setSlideOver(null);
          break;
        case 'n':
          document.getElementById('new-menu-trigger')?.click();
          break;
        case '/':
          e.preventDefault();
          document.getElementById('scheduler-filter')?.focus();
          break;
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToday, goPrev, goNext, setView]);

  // Team members query (for left rail)
  const teamMembersQuery = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => settingsApi.listTeamMembers(),
  });

  const allTeamMembers: TeamMemberDto[] = useMemo(
    () => (teamMembersQuery.data?.items ?? []).filter((t) => t.activeOnSchedule),
    [teamMembersQuery.data],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* ── Scheduler topbar ──────────────────────────────────────── */}
      <SchedulerTopbar
        view={view}
        date={date}
        onToday={goToday}
        onPrev={goPrev}
        onNext={goNext}
        onViewChange={setView}
        onDateChange={setDate}
        calendarPrefs={calendarPrefs}
        onPrefChange={updatePref}
      />

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left rail — day view only */}
        {view === 'day' && (
          <LeftRail
            date={date}
            onDateChange={(d) => navigate({ date: d, view: 'day' })}
            teamMembers={allTeamMembers}
            activeTeamIds={activeTeamIds}
            showUnassigned={showUnassigned}
            onToggleTeamMember={toggleTeamMember}
            onToggleUnassigned={toggleUnassigned}
            onShowAll={showAllTeams}
          />
        )}

        {/* Main content */}
        <div className="flex-1 overflow-auto">
          {view === 'day' ? (
            <DayView
              date={date}
              activeTeamIds={activeTeamIds}
              showUnassigned={showUnassigned}
              calendarPrefs={calendarPrefs}
              onJobClick={(id) => setSlideOver({ type: 'job', id })}
              onEventClick={(id) => setSlideOver({ type: 'event', id })}
              onEmptySlotClick={(d, startHour, assigneeTeamMemberId) => {
                const sp = new URLSearchParams();
                sp.set('scheduledStartAt', hourToDatetimeLocal(d, startHour));
                sp.set('scheduledEndAt', hourToDatetimeLocal(d, startHour + 1));
                if (assigneeTeamMemberId) sp.set('assigneeTeamMemberId', assigneeTeamMemberId);
                router.push(`/jobs/new?${sp.toString()}` as import('next').Route);
              }}
            />
          ) : (
            <MonthView
              date={date}
              calendarPrefs={calendarPrefs}
              onDayClick={(d) => navigate({ view: 'day', date: d })}
              onJobClick={(id) => setSlideOver({ type: 'job', id })}
              onEventClick={(id) => setSlideOver({ type: 'event', id })}
            />
          )}
        </div>
      </div>

      {/* ── Slide-over ────────────────────────────────────────────── */}
      {slideOver && (
        <SlideOver onClose={() => setSlideOver(null)}>
          {slideOver.type === 'job' ? (
            <JobSlideOver jobId={slideOver.id} onClose={() => setSlideOver(null)} />
          ) : (
            <EventSlideOver eventId={slideOver.id} onClose={() => setSlideOver(null)} />
          )}
        </SlideOver>
      )}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduler topbar
// ---------------------------------------------------------------------------

function SchedulerTopbar({
  view,
  date,
  onToday,
  onPrev,
  onNext,
  onViewChange,
  onDateChange,
  calendarPrefs,
  onPrefChange,
}: {
  view: 'day' | 'month';
  date: string;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  onViewChange: (v: 'day' | 'month') => void;
  onDateChange: (d: string) => void;
  calendarPrefs: CalendarPrefs;
  onPrefChange: (key: keyof CalendarPrefs, value: boolean) => void;
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPrefsPanel, setShowPrefsPanel] = useState(false);
  const prefsPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPrefsPanel) return;
    function onClick(e: MouseEvent) {
      if (prefsPanelRef.current && !prefsPanelRef.current.contains(e.target as Node)) {
        setShowPrefsPanel(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showPrefsPanel]);

  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onToday}>
          Today
        </Button>
        <button
          type="button"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          onClick={onPrev}
          aria-label="Previous"
        >
          <ChevronLeft />
        </button>
        <button
          type="button"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          onClick={onNext}
          aria-label="Next"
        >
          <ChevronRight />
        </button>
        <div className="relative">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            onClick={() => setShowDatePicker(!showDatePicker)}
          >
            {view === 'day' ? formatDayHeader(date) : formatMonthHeader(date)}
          </button>
          {showDatePicker && (
            <div className="absolute left-0 top-full z-20 mt-1 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              <input
                type="date"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                value={date}
                onChange={(e) => {
                  onDateChange(e.target.value);
                  setShowDatePicker(false);
                }}
              />
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-md border border-slate-300">
          <button
            type="button"
            className={cn(
              'rounded-l-md px-3 py-1.5 text-sm font-medium',
              view === 'day' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50',
            )}
            onClick={() => onViewChange('day')}
          >
            Day
          </button>
          <button
            type="button"
            className={cn(
              'rounded-r-md border-l border-slate-300 px-3 py-1.5 text-sm font-medium',
              view === 'month' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50',
            )}
            onClick={() => onViewChange('month')}
          >
            Month
          </button>
        </div>
        <div ref={prefsPanelRef} className="relative">
          <button
            type="button"
            className={cn(
              'rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700',
              showPrefsPanel && 'bg-slate-100 text-slate-700',
            )}
            aria-label="Calendar settings"
            onClick={() => setShowPrefsPanel((v) => !v)}
          >
            <CogIcon />
          </button>
          {showPrefsPanel && (
            <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Show in calendar
              </p>
              {(
                [
                  ['showJobNumber', 'Job number'],
                  ['showCustomerName', 'Customer name'],
                  ['showService', 'Service'],
                  ['showAddress', 'Address'],
                  ['showTime', 'Start / end time'],
                  ['showPrice', 'Price'],
                  ['showTags', 'Tags'],
                  ['showRecurringText', 'Recurring schedule'],
                ] as [keyof CalendarPrefs, string][]
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-brand-600"
                    checked={calendarPrefs[key]}
                    onChange={(e) => onPrefChange(key, e.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left rail (day view only)
// ---------------------------------------------------------------------------

function LeftRail({
  date,
  onDateChange,
  teamMembers,
  activeTeamIds,
  showUnassigned,
  onToggleTeamMember,
  onToggleUnassigned,
  onShowAll,
}: {
  date: string;
  onDateChange: (d: string) => void;
  teamMembers: TeamMemberDto[];
  activeTeamIds: Set<string> | null;
  showUnassigned: boolean;
  onToggleTeamMember: (id: string) => void;
  onToggleUnassigned: () => void;
  onShowAll: () => void;
}) {
  const [filterText, setFilterText] = useState('');

  const filteredMembers = useMemo(() => {
    if (!filterText.trim()) return teamMembers;
    const q = filterText.toLowerCase();
    return teamMembers.filter((tm) => tm.displayName.toLowerCase().includes(q));
  }, [teamMembers, filterText]);

  return (
    <aside className="hidden w-60 flex-shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
      {/* Mini calendar */}
      <div className="border-b border-slate-200 p-3">
        <MiniCalendar date={date} onDateChange={onDateChange} />
      </div>

      {/* Filter input */}
      <div className="border-b border-slate-200 p-3">
        <input
          id="scheduler-filter"
          type="text"
          placeholder="Filter by name…"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
      </div>

      {/* Team members */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Employees
          </h3>
          {activeTeamIds && (
            <button
              type="button"
              className="text-xs text-brand-600 hover:text-brand-700"
              onClick={onShowAll}
            >
              Show all
            </button>
          )}
        </div>
        <div className="space-y-1">
          {filteredMembers.map((tm) => {
            const checked = activeTeamIds === null || activeTeamIds.has(tm.id);
            return (
              <label
                key={tm.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-slate-300"
                  checked={checked}
                  onChange={() => onToggleTeamMember(tm.id)}
                />
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tm.color }} />
                <span className="text-slate-700">{tm.displayName}</span>
              </label>
            );
          })}
          {/* Unassigned pseudo-row */}
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300"
              checked={showUnassigned}
              onChange={onToggleUnassigned}
            />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
            <span className="text-slate-500">Unassigned</span>
          </label>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Mini calendar
// ---------------------------------------------------------------------------

function MiniCalendar({
  date,
  onDateChange,
}: {
  date: string;
  onDateChange: (d: string) => void;
}) {
  const [viewMonth, setViewMonth] = useState(date.slice(0, 7));
  const todayStr = today();
  const gridDates = getMonthGrid(`${viewMonth}-15`);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className="rounded p-0.5 text-slate-400 hover:text-slate-600"
          onClick={() => {
            const d = new Date(`${viewMonth}-15T12:00:00Z`);
            d.setUTCMonth(d.getUTCMonth() - 1);
            setViewMonth(d.toISOString().slice(0, 7));
          }}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-medium text-slate-700">
          {formatMonthHeader(`${viewMonth}-15`)}
        </span>
        <button
          type="button"
          className="rounded p-0.5 text-slate-400 hover:text-slate-600"
          onClick={() => {
            const d = new Date(`${viewMonth}-15T12:00:00Z`);
            d.setUTCMonth(d.getUTCMonth() + 1);
            setViewMonth(d.toISOString().slice(0, 7));
          }}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-slate-400">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="py-0.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {gridDates.map((gd) => {
          const inMonth = gd.slice(0, 7) === viewMonth;
          const isToday = gd === todayStr;
          const isSelected = gd === date;
          return (
            <button
              key={gd}
              type="button"
              className={cn(
                'mx-auto flex h-6 w-6 items-center justify-center rounded-full',
                !inMonth && 'text-slate-300',
                inMonth && !isSelected && !isToday && 'text-slate-700 hover:bg-slate-100',
                isToday && !isSelected && 'font-semibold text-brand-600',
                isSelected && 'bg-brand-600 text-white',
              )}
              onClick={() => onDateChange(gd)}
            >
              {Number.parseInt(gd.slice(8), 10)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day view
// ---------------------------------------------------------------------------

interface DragPayload {
  jobId: string;
  recurringSeriesId: string | null;
  originalStartIso: string;
  originalEndIso: string;
  originalAssigneeId: string | null;
}

interface PendingDrop {
  jobId: string;
  newStart: string;
  newEnd: string;
  newAssigneeId: string | null;
}

function DayView({
  date,
  activeTeamIds,
  showUnassigned,
  calendarPrefs,
  onJobClick,
  onEventClick,
  onEmptySlotClick,
}: {
  date: string;
  activeTeamIds: Set<string> | null;
  showUnassigned: boolean;
  calendarPrefs: CalendarPrefs;
  onJobClick: (id: string) => void;
  onEventClick: (id: string) => void;
  onEmptySlotClick: (date: string, startHour: number, assigneeTeamMemberId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const dayQuery = useQuery({
    queryKey: ['schedule', 'day', date],
    queryFn: () => schedulerApi.getDay(date),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);

  // Drag-and-drop state
  const [draggingJobId, setDraggingJobId] = useState<string | null>(null);
  const [hoverLaneKey, setHoverLaneKey] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [showScopeDialog, setShowScopeDialog] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ snappedHour: number; displayName: string; x: number; y: number } | null>(null);

  const dropMutation = useMutation({
    mutationFn: async (vars: PendingDrop & { scope?: 'this' | 'this_and_future' }) => {
      if (vars.scope) {
        return jobsApi.occurrenceEdit(vars.jobId, {
          scope: vars.scope,
          changes: {
            scheduledStartAt: vars.newStart,
            scheduledEndAt: vars.newEnd,
            assigneeTeamMemberId: vars.newAssigneeId,
          },
        });
      }
      return jobsApi.schedule(vars.jobId, {
        scheduledStartAt: vars.newStart,
        scheduledEndAt: vars.newEnd,
        assigneeTeamMemberId: vars.newAssigneeId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day', date] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
  });

  function handleDrop(e: React.DragEvent<HTMLDivElement>, laneTeamMemberId: string | null) {
    e.preventDefault();
    setHoverLaneKey(null);
    setDraggingJobId(null);

    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    let payload: DragPayload;
    try {
      payload = JSON.parse(raw) as DragPayload;
    } catch {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const droppedHour = MIN_HOUR + offsetY / HOUR_HEIGHT;
    const snappedHour = Math.round(droppedHour * 4) / 4;

    const durationMs =
      new Date(payload.originalEndIso).getTime() - new Date(payload.originalStartIso).getTime();
    const durationHours = durationMs / 3_600_000;

    if (snappedHour < MIN_HOUR) return;
    if (snappedHour + durationHours > MAX_HOUR) return;

    const [yStr, mStr, dStr] = date.split('-');
    const year = Number.parseInt(yStr ?? '', 10);
    const month = Number.parseInt(mStr ?? '', 10);
    const day = Number.parseInt(dStr ?? '', 10);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return;

    const hour = Math.floor(snappedHour);
    const minute = Math.round((snappedHour - hour) * 60);
    const newStart = new Date(year, month - 1, day, hour, minute, 0, 0);
    const newEnd = new Date(newStart.getTime() + durationMs);
    const newStartIso = newStart.toISOString();
    const newEndIso = newEnd.toISOString();

    if (
      payload.originalStartIso === newStartIso &&
      payload.originalEndIso === newEndIso &&
      payload.originalAssigneeId === laneTeamMemberId
    ) {
      return;
    }

    const drop: PendingDrop = {
      jobId: payload.jobId,
      newStart: newStartIso,
      newEnd: newEndIso,
      newAssigneeId: laneTeamMemberId,
    };

    if (payload.recurringSeriesId) {
      setPendingDrop(drop);
      setShowScopeDialog(true);
    } else {
      dropMutation.mutate(drop);
    }
  }

  function handleScopeChoice(scope: 'this' | 'this_and_future') {
    if (!pendingDrop) return;
    dropMutation.mutate({ ...pendingDrop, scope });
    setPendingDrop(null);
    setShowScopeDialog(false);
  }

  function cancelScopeDialog() {
    setPendingDrop(null);
    setShowScopeDialog(false);
  }

  // Scroll to DEFAULT_START_HOUR on first load
  useEffect(() => {
    if (scrollRef.current && !didScroll.current) {
      didScroll.current = true;
      scrollRef.current.scrollTop = (DEFAULT_START_HOUR - MIN_HOUR) * HOUR_HEIGHT;
    }
  }, []);

  // Now line
  const isToday = date === today();
  const [nowHour, setNowHour] = useState(() => {
    const n = new Date();
    return n.getHours() + n.getMinutes() / 60;
  });
  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => {
      const n = new Date();
      setNowHour(n.getHours() + n.getMinutes() / 60);
    }, 60_000);
    return () => clearInterval(interval);
  }, [isToday]);

  if (dayQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading schedule…
      </div>
    );
  }

  if (dayQuery.error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-600">
        Failed to load schedule.
      </div>
    );
  }

  const data = dayQuery.data as DayResponse;

  // Filter lanes
  const visibleLanes = data.lanes.filter((lane) => {
    if (lane.teamMemberId === null) return showUnassigned;
    if (activeTeamIds === null) return true;
    return activeTeamIds.has(lane.teamMemberId);
  });

  // Empty state
  if (
    visibleLanes.length === 0 ||
    visibleLanes.every((l) => l.jobs.length === 0 && l.events.length === 0)
  ) {
    const hasNoTeam = data.lanes.length <= 1; // only Unassigned
    const isEmpty = visibleLanes.every((l) => l.jobs.length === 0 && l.events.length === 0);

    if (hasNoTeam) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
          <p>Add team members in Settings to use the scheduler.</p>
          <Link href={'/settings/team' as Route}>
            <Button variant="secondary" size="sm">
              Go to Settings
            </Button>
          </Link>
        </div>
      );
    }

    if (isEmpty && visibleLanes.length > 0) {
      // Show the grid anyway with empty lanes — fall through
    } else if (visibleLanes.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-500">
          <p>No lanes visible. Adjust your team filter.</p>
        </div>
      );
    }
  }

  const totalHours = MAX_HOUR - MIN_HOUR;

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div className="flex" style={{ minWidth: visibleLanes.length * 180 }}>
        {/* Time gutter */}
        <div className="sticky left-0 z-10 w-16 flex-shrink-0 bg-slate-50 border-r border-slate-200">
          <div className="h-10 border-b border-slate-200" /> {/* header spacer */}
          <div className="relative" style={{ height: totalHours * HOUR_HEIGHT }}>
            {Array.from({ length: totalHours }, (_, i) => {
              const hour = MIN_HOUR + i;
              const label =
                hour === 0
                  ? '12 AM'
                  : hour < 12
                    ? `${hour} AM`
                    : hour === 12
                      ? '12 PM'
                      : `${hour - 12} PM`;
              return (
                <div
                  key={hour}
                  className="absolute right-2 text-[11px] text-slate-400"
                  style={{ top: i * HOUR_HEIGHT - 7 }}
                >
                  {label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Lanes */}
        {visibleLanes.map((lane) => {
          const laneKey = lane.teamMemberId ?? '__unassigned';
          const isHovered = hoverLaneKey === laneKey;
          const columnMap = computeColumns(lane.jobs);
          return (
          <div
            key={laneKey}
            className="flex-1 border-r border-slate-200"
            style={{ minWidth: 180, maxWidth: 320 }}
          >
            {/* Lane header */}
            <div className="flex h-10 items-center gap-2 border-b border-slate-200 px-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: lane.color }} />
              <span className="truncate text-sm font-medium text-slate-700">
                {lane.displayName}
              </span>
            </div>
            {/* Time grid (drop target) */}
            <div
              className={cn(
                'relative transition-colors',
                isHovered && 'bg-brand-50',
              )}
              style={{ height: totalHours * HOUR_HEIGHT }}
              onDragOver={(e) => {
                if (!draggingJobId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (hoverLaneKey !== laneKey) setHoverLaneKey(laneKey);
                const rect = e.currentTarget.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const droppedHour = MIN_HOUR + offsetY / HOUR_HEIGHT;
                const snappedHour = Math.min(Math.max(Math.round(droppedHour * 4) / 4, MIN_HOUR), MAX_HOUR);
                setDragPreview({ snappedHour, displayName: lane.displayName, x: e.clientX, y: e.clientY });
              }}
              onDragLeave={(e) => {
                // Only clear if leaving the grid for a non-child element
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (hoverLaneKey === laneKey) setHoverLaneKey(null);
                setDragPreview(null);
              }}
              onDrop={(e) => handleDrop(e, lane.teamMemberId)}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const raw = MIN_HOUR + offsetY / HOUR_HEIGHT;
                const snapped = Math.max(MIN_HOUR, Math.min(Math.round(raw * 4) / 4, MAX_HOUR - 0.25));
                onEmptySlotClick(date, snapped, lane.teamMemberId);
              }}
            >
              {/* Hour lines */}
              {Array.from({ length: totalHours }, (_, i) => {
                const hourKey = MIN_HOUR + i;
                return (
                  <div
                    key={`hour-${hourKey}`}
                    className="pointer-events-none absolute left-0 right-0 border-t border-slate-100"
                    style={{ top: i * HOUR_HEIGHT }}
                  />
                );
              })}

              {/* Now line */}
              {isToday && nowHour >= MIN_HOUR && nowHour <= MAX_HOUR && (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-red-500"
                  style={{ top: (nowHour - MIN_HOUR) * HOUR_HEIGHT }}
                >
                  <div className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-red-500" />
                </div>
              )}

              {/* Job blocks */}
              {lane.jobs.map((job) => {
                const start = Math.max(parseHour(job.scheduledStartAt), MIN_HOUR);
                const end = Math.min(parseHour(job.scheduledEndAt), MAX_HOUR);
                const duration = Math.max(end - start, MIN_BLOCK_DURATION);
                const top = (start - MIN_HOUR) * HOUR_HEIGHT;
                const height = duration * HOUR_HEIGHT;
                const isDragging = draggingJobId === job.id;
                const { col, totalCols } = columnMap.get(job.id) ?? { col: 0, totalCols: 1 };
                const colWidthPct = 100 / totalCols;
                const leftPct = col * colWidthPct;

                return (
                  <button
                    key={job.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      const payload: DragPayload = {
                        jobId: job.id,
                        recurringSeriesId: job.recurringSeriesId,
                        originalStartIso: job.scheduledStartAt,
                        originalEndIso: job.scheduledEndAt,
                        originalAssigneeId: job.assigneeTeamMemberId,
                      };
                      e.dataTransfer.setData('application/json', JSON.stringify(payload));
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggingJobId(job.id);
                    }}
                    onDragEnd={() => {
                      setDraggingJobId(null);
                      setHoverLaneKey(null);
                      setDragPreview(null);
                    }}
                    className={cn(
                      'absolute cursor-grab overflow-hidden rounded px-2 py-1 text-left text-xs shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing border',
                      job.jobStage === 'job_done'
                        ? 'bg-slate-100 text-slate-600 border-slate-200'
                        : '',
                      isDragging && 'opacity-50',
                    )}
                    style={{
                      top,
                      height: Math.max(height, 28),
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${colWidthPct}% - 4px)`,
                      zIndex: 5,
                      ...(job.jobStage !== 'job_done' && {
                        backgroundColor: lane.color + '22',
                        borderColor: lane.color + '88',
                        color: lane.color,
                      }),
                    }}
                    onClick={() => onJobClick(job.id)}
                  >
                    {calendarPrefs.showCustomerName && (
                      <div className="flex items-center gap-0.5 font-medium min-w-0">
                        <span className="truncate">{job.customerDisplayName}</span>
                        {job.recurringSeriesId && <Repeat2 size={10} className="shrink-0 opacity-60" />}
                      </div>
                    )}
                    {job.recurringSeriesId && calendarPrefs.showRecurringText && job.recurrenceInfo && (
                      <div className="truncate text-[10px] opacity-65">
                        {formatRecurrence(job.recurrenceInfo)}
                      </div>
                    )}
                    {calendarPrefs.showService && job.serviceName && (
                      <div className="truncate text-[11px] opacity-75">{job.serviceName}</div>
                    )}
                    {calendarPrefs.showTime && (
                      <div className="truncate text-[11px] opacity-75">
                        {formatTime(job.scheduledStartAt)} – {formatTime(job.scheduledEndAt)}
                      </div>
                    )}
                    {calendarPrefs.showAddress && job.customerAddress && (
                      <div className="truncate text-[11px] opacity-70">{job.customerAddress}</div>
                    )}
                    {calendarPrefs.showJobNumber && height > 36 && (
                      <div className="truncate text-[11px] opacity-75">
                        {job.titleOrSummary ?? job.jobNumber}
                      </div>
                    )}
                    {calendarPrefs.showPrice && job.priceCents > 0 && (
                      <div className="text-[11px] opacity-60">{formatCents(job.priceCents)}</div>
                    )}
                    {calendarPrefs.showTags && job.tags.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {job.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-current px-1 py-px text-[9px] font-medium opacity-70"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {job.jobStage && (
                      <div className="mt-0.5">
                        <StageBadge stage={job.jobStage} size="xs" />
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Event blocks */}
              {lane.events.map((evt) => {
                const start = Math.max(parseHour(evt.scheduledStartAt), MIN_HOUR);
                const end = Math.min(parseHour(evt.scheduledEndAt), MAX_HOUR);
                const duration = Math.max(end - start, MIN_BLOCK_DURATION);
                const top = (start - MIN_HOUR) * HOUR_HEIGHT;
                const height = duration * HOUR_HEIGHT;

                return (
                  <button
                    key={evt.id}
                    type="button"
                    className="absolute left-1 right-1 overflow-hidden rounded border border-violet-200 bg-violet-50 px-2 py-1 text-left text-xs text-violet-900 shadow-sm transition-shadow hover:shadow-md"
                    style={{ top, height: Math.max(height, 28), zIndex: 5 }}
                    onClick={() => onEventClick(evt.id)}
                  >
                    <div className="truncate font-medium">{evt.name ?? '(no name)'}</div>
                    {height > 36 && (
                      <div className="text-[11px] opacity-75">
                        {formatTime(evt.scheduledStartAt)} – {formatTime(evt.scheduledEndAt)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      {/* Drag preview tooltip */}
      {dragPreview && draggingJobId && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white shadow-lg"
          style={{ left: dragPreview.x + 16, top: dragPreview.y - 64 }}
        >
          Move visit to {formatSnappedHour(dragPreview.snappedHour)} · {formatDateShort(date)} · {dragPreview.displayName}
        </div>
      )}

      {/* Scope dialog for recurring job drops */}
      {showScopeDialog && pendingDrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Move recurring job</h3>
            <p className="mt-2 text-sm text-slate-600">
              This job is part of a recurring series. Apply changes to:
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                onClick={() => handleScopeChoice('this')}
                disabled={dropMutation.isPending}
              >
                {dropMutation.isPending ? 'Saving…' : 'Only this job'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleScopeChoice('this_and_future')}
                disabled={dropMutation.isPending}
              >
                {dropMutation.isPending ? 'Saving…' : 'This and all future jobs'}
              </Button>
              <Button
                variant="ghost"
                onClick={cancelScopeDialog}
                disabled={dropMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

function MonthView({
  date,
  calendarPrefs,
  onDayClick,
  onJobClick,
  onEventClick,
}: {
  date: string;
  calendarPrefs: CalendarPrefs;
  onDayClick: (d: string) => void;
  onJobClick: (id: string) => void;
  onEventClick: (id: string) => void;
}) {
  const gridDates = getMonthGrid(date);
  const rangeStart = gridDates[0] ?? date;
  const rangeEnd = gridDates[gridDates.length - 1] ?? date;

  const rangeQuery = useQuery({
    queryKey: ['schedule', 'range', rangeStart, rangeEnd],
    queryFn: () => schedulerApi.getRange(rangeStart, rangeEnd),
  });

  const todayStr = today();
  const days = (rangeQuery.data as RangeResponse | undefined)?.days ?? {};
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="flex h-full flex-col">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {weekdays.map((wd) => (
          <div key={wd} className="px-2 py-2 text-center text-xs font-medium text-slate-500">
            {wd}
          </div>
        ))}
      </div>
      {/* Grid */}
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {gridDates.map((gd) => {
          const inMonth = isSameMonth(gd, date);
          const isToday = gd === todayStr;
          const dayData = days[gd];
          const jobItems = dayData?.jobs ?? [];
          const eventItems = dayData?.events ?? [];
          const totalItems = jobItems.length + eventItems.length;
          const maxChips = 3;
          const visibleJobs = jobItems.slice(0, maxChips);
          const visibleEvents = eventItems.slice(0, Math.max(0, maxChips - visibleJobs.length));
          const overflow = totalItems - visibleJobs.length - visibleEvents.length;

          return (
            <div
              key={gd}
              className={cn(
                'flex min-h-[100px] flex-col border-b border-r border-slate-200 p-1',
                !inMonth && 'bg-slate-50',
              )}
            >
              <button
                type="button"
                className={cn(
                  'mb-1 self-end rounded-full px-1.5 py-0.5 text-xs',
                  isToday
                    ? 'bg-brand-600 font-semibold text-white'
                    : inMonth
                      ? 'text-slate-700 hover:bg-slate-100'
                      : 'text-slate-400',
                )}
                onClick={() => onDayClick(gd)}
              >
                {Number.parseInt(gd.slice(8), 10)}
              </button>
              <div className="flex flex-col gap-0.5">
                {visibleJobs.map((j) => (
                  <button
                    key={j.id}
                    type="button"
                    className="rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
                    style={{ backgroundColor: j.assigneeColor }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onJobClick(j.id);
                    }}
                  >
                    <span className="flex items-center gap-0.5 min-w-0">
                      {calendarPrefs.showTime && (
                        <span className="shrink-0 opacity-90">
                          {formatTime(j.scheduledStartAt).replace(':00', '').replace(' ', '')}
                        </span>
                      )}
                      {calendarPrefs.showCustomerName && (
                        <span className="flex items-center gap-0.5 truncate min-w-0">
                          <span className="truncate">{j.customerDisplayName}{j.titleOrSummary ? ` · ${j.titleOrSummary}` : ''}</span>
                          {j.recurringSeriesId && <Repeat2 size={8} className="shrink-0 opacity-75" />}
                        </span>
                      )}
                      {calendarPrefs.showPrice && j.priceCents > 0 && (
                        <span className="shrink-0 opacity-90">{formatCents(j.priceCents)}</span>
                      )}
                    </span>
                    {j.recurringSeriesId && calendarPrefs.showRecurringText && j.recurrenceInfo && (
                      <span className="block truncate text-[9px] opacity-65">
                        {formatRecurrence(j.recurrenceInfo)}
                      </span>
                    )}
                    {calendarPrefs.showService && j.serviceName && (
                      <span className="block truncate text-[10px] opacity-85">{j.serviceName}</span>
                    )}
                    {calendarPrefs.showAddress && j.customerAddress && (
                      <span className="block truncate text-[10px] opacity-85">{j.customerAddress}</span>
                    )}
                    {calendarPrefs.showTags && j.tags.length > 0 && (
                      <span className="flex flex-wrap gap-0.5 mt-0.5">
                        {j.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className="rounded-full border border-white/50 px-1 text-[9px] opacity-90">
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                    {j.jobStage && (
                      <span className="mt-0.5 block">
                        <StageBadge stage={j.jobStage} size="xs" />
                      </span>
                    )}
                  </button>
                ))}
                {visibleEvents.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className="truncate rounded bg-violet-500 px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(ev.id);
                    }}
                  >
                    {ev.name ?? '(no name)'}
                  </button>
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    className="text-left text-[11px] text-slate-500 hover:text-slate-700"
                    onClick={() => onDayClick(gd)}
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slide-over panel
// ---------------------------------------------------------------------------

function SlideOver({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-slate-900/20"
        onClick={onClose}
        onKeyDown={() => {}}
        role="presentation"
      />
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-xl">
        {children}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Job slide-over content
// ---------------------------------------------------------------------------

const SLIDE_STAGE_OPTIONS = [
  { value: 'scheduled',         label: 'Scheduled',     bg: 'bg-slate-100',   text: 'text-slate-700' },
  { value: 'confirmation_sent', label: 'Conf. Sent',    bg: 'bg-blue-100',    text: 'text-blue-700' },
  { value: 'confirmed',         label: 'Confirmed',     bg: 'bg-green-100',   text: 'text-green-700' },
  { value: 'job_done',          label: 'Done',          bg: 'bg-emerald-600', text: 'text-white' },
  { value: 'cancelled',         label: 'Cancelled',     bg: 'bg-red-100',     text: 'text-red-700' },
] as const;

function JobSlideOver({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelScopeDialog, setShowCancelScopeDialog] = useState(false);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobsApi.get(jobId),
    retry: false,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
  }

  const reopenMutation = useMutation({
    mutationFn: () => jobsApi.reopen(jobId),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (scope?: 'this' | 'this_and_future') =>
      scope
        ? jobsApi.occurrenceDelete(jobId, { scope }).then(() => {})
        : jobsApi.delete(jobId),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed to delete job'),
  });

  const stageMutation = useMutation({
    mutationFn: (vars: { stage: string; scope?: 'this' | 'this_and_future' }) =>
      jobsApi.setStage(jobId, vars),
    onSuccess: () => invalidate(),
  });

  if (jobQuery.isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }
  if (jobQuery.error) {
    return <div className="p-6 text-sm text-red-600">Failed to load job.</div>;
  }

  const job = jobQuery.data as JobDto;

  const stageColor: Record<string, string> = {
    scheduled: 'bg-slate-100 text-slate-700',
    confirmation_sent: 'bg-blue-100 text-blue-700',
    confirmed: 'bg-green-100 text-green-700',
    job_done: 'bg-emerald-600 text-white',
    cancelled: 'bg-red-100 text-red-700',
  };
  const stageLabel: Record<string, string> = {
    scheduled: 'Scheduled',
    confirmation_sent: 'Conf. Sent',
    confirmed: 'Confirmed',
    job_done: 'Done',
    cancelled: 'Cancelled',
  };

  return (
    <div className="p-6">
      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{job.jobNumber}</h2>
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${stageColor[job.jobStage] ?? 'bg-slate-100 text-slate-700'}`}
            >
              {stageLabel[job.jobStage] ?? job.jobStage}
            </span>
          </div>
          <Link
            href={`/customers/${job.customerId}` as Route}
            className="text-sm text-brand-700 hover:underline"
          >
            {job.customerDisplayName}
          </Link>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-400 hover:text-slate-600"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>

      <dl className="space-y-2 text-sm">
        <DetailRow label="Service" value={job.serviceName ?? '—'} />
        <DetailRow label="Price" value={formatCents(job.priceCents)} />
        <DetailRow label="Lead source" value={job.leadSource ?? '—'} />
        <DetailRow
          label="Schedule"
          value={formatScheduleRange(job.scheduledStartAt, job.scheduledEndAt)}
        />
        <DetailRow label="Assignee" value={job.assigneeDisplayName ?? 'Unassigned'} />
      </dl>

      {job.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1">
          {job.tags.map((t) => (
            <span
              key={t}
              className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {job.privateNotes && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">{job.privateNotes}</p>
      )}

      <div className="mt-4">
        <p className="mb-1.5 text-xs font-medium text-slate-500">Stage</p>
        {job.jobStage === 'job_done' ? (
          <div className="flex items-center gap-2">
            {(() => {
              const opt = SLIDE_STAGE_OPTIONS.find((o) => o.value === 'job_done')!;
              return (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${opt.bg} ${opt.text}`}>
                  {opt.label}
                </span>
              );
            })()}
            <span className="text-xs text-slate-400">Use Reopen to change</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {SLIDE_STAGE_OPTIONS.map((opt) => {
              const isActive = job.jobStage === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={stageMutation.isPending}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-all ${opt.bg} ${opt.text} ${isActive ? 'ring-2 ring-offset-1 ring-slate-400' : 'opacity-70 hover:opacity-100'}`}
                  onClick={() => {
                    if (isActive) return;
                    if (opt.value === 'cancelled' && job.recurringSeriesId) {
                      setShowCancelScopeDialog(true);
                    } else {
                      stageMutation.mutate({ stage: opt.value });
                    }
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        <Link href={`/jobs/${job.id}/edit` as Route}>
          <Button variant="secondary" size="sm">
            Edit
          </Button>
        </Link>
        <Link href={`/jobs/${job.id}` as Route}>
          <Button variant="secondary" size="sm">
            Full detail
          </Button>
        </Link>
        {job.jobStage === 'job_done' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowReopenConfirm(true)}
            disabled={reopenMutation.isPending}
          >
            {reopenMutation.isPending ? 'Reopening…' : 'Reopen'}
          </Button>
        )}
        {job.jobStage !== 'job_done' && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            disabled={deleteMutation.isPending}
          >
            Delete
          </Button>
        )}
      </div>

      {showReopenConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <p className="text-sm text-slate-800">
              Are you sure you want to reopen this job?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  reopenMutation.mutate();
                  setShowReopenConfirm(false);
                }}
                disabled={reopenMutation.isPending}
              >
                {reopenMutation.isPending ? 'Reopening…' : 'Reopen'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowReopenConfirm(false)}
                disabled={reopenMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {showCancelScopeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Cancel recurring job</h3>
            <p className="mt-2 text-sm text-slate-600">
              This job is part of a recurring series. Cancel:
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  stageMutation.mutate({ stage: 'cancelled', scope: 'this' });
                  setShowCancelScopeDialog(false);
                }}
                disabled={stageMutation.isPending}
              >
                {stageMutation.isPending ? 'Saving…' : 'Only this job'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  stageMutation.mutate({ stage: 'cancelled', scope: 'this_and_future' });
                  setShowCancelScopeDialog(false);
                }}
                disabled={stageMutation.isPending}
              >
                {stageMutation.isPending ? 'Saving…' : 'This and all future jobs'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowCancelScopeDialog(false)}
                disabled={stageMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            {job.recurringSeriesId ? (
              <>
                <h3 className="text-lg font-semibold text-slate-900">Delete recurring job</h3>
                <p className="mt-2 text-sm text-slate-600">
                  This job is part of a recurring series. Delete:
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Button
                    variant="danger"
                    onClick={() => deleteMutation.mutate('this')}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Only this job'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => deleteMutation.mutate('this_and_future')}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'This and all future jobs'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowDeleteDialog(false)}
                    disabled={deleteMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-slate-900">Delete job?</h3>
                <p className="mt-2 text-sm text-slate-600">
                  This action cannot be undone.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Button
                    variant="danger"
                    onClick={() => deleteMutation.mutate(undefined)}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowDeleteDialog(false)}
                    disabled={deleteMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event slide-over content (stub — events module is Phase 7)
// ---------------------------------------------------------------------------

function EventSlideOver({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const eventQuery = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => eventsApi.get(eventId),
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.delete(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      onClose();
    },
  });

  if (eventQuery.isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }
  if (eventQuery.error) {
    return <div className="p-6 text-sm text-red-600">Failed to load event.</div>;
  }

  const event = eventQuery.data as EventDto;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{event.name ?? '(no name)'}</h2>
          <p className="text-sm text-slate-500">Event</p>
        </div>
        <button
          type="button"
          className="rounded p-1 text-slate-400 hover:text-slate-600"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>

      <dl className="space-y-2 text-sm">
        <DetailRow label="Start" value={formatTime(event.scheduledStartAt)} />
        <DetailRow label="End" value={formatTime(event.scheduledEndAt)} />
        <DetailRow label="Assignee" value={event.assigneeDisplayName ?? 'Unassigned'} />
        <DetailRow label="Location" value={event.location ?? '—'} />
      </dl>

      {event.note && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">{event.note}</p>
      )}

      <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        <Link href={`/events/${event.id}/edit` as Route}>
          <Button variant="secondary" size="sm">
            Edit
          </Button>
        </Link>
        <Link href={`/events/${event.id}` as Route}>
          <Button variant="secondary" size="sm">
            Full detail
          </Button>
        </Link>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (window.confirm('Delete this event?')) {
              deleteMutation.mutate();
            }
          }}
          disabled={deleteMutation.isPending}
        >
          {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function ChevronLeft({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <title>Previous</title>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRight({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <title>Next</title>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <title>Settings</title>
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <title>Close</title>
      <line x1={18} y1={6} x2={6} y2={18} />
      <line x1={6} y1={6} x2={18} y2={18} />
    </svg>
  );
}
