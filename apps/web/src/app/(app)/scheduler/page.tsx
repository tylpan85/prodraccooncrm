'use client';

import type { EventDto, JobDto, TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
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
  return new Date().toISOString().slice(0, 10);
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
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMonthHeader(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
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
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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
              onJobClick={(id) => setSlideOver({ type: 'job', id })}
              onEventClick={(id) => setSlideOver({ type: 'event', id })}
            />
          ) : (
            <MonthView
              date={date}
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
}: {
  view: 'day' | 'month';
  date: string;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  onViewChange: (v: 'day' | 'month') => void;
  onDateChange: (d: string) => void;
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);

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
        <Link href={'/settings/team' as Route}>
          <button
            type="button"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Settings"
          >
            <CogIcon />
          </button>
        </Link>
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
          {new Date(`${viewMonth}-15T12:00:00Z`).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          })}
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

function DayView({
  date,
  activeTeamIds,
  showUnassigned,
  onJobClick,
  onEventClick,
}: {
  date: string;
  activeTeamIds: Set<string> | null;
  showUnassigned: boolean;
  onJobClick: (id: string) => void;
  onEventClick: (id: string) => void;
}) {
  const dayQuery = useQuery({
    queryKey: ['schedule', 'day', date],
    queryFn: () => schedulerApi.getDay(date),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);

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
    return n.getUTCHours() + n.getUTCMinutes() / 60;
  });
  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => {
      const n = new Date();
      setNowHour(n.getUTCHours() + n.getUTCMinutes() / 60);
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
        {visibleLanes.map((lane) => (
          <div
            key={lane.teamMemberId ?? '__unassigned'}
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
            {/* Time grid */}
            <div className="relative" style={{ height: totalHours * HOUR_HEIGHT }}>
              {/* Hour lines */}
              {Array.from({ length: totalHours }, (_, i) => {
                const hourKey = MIN_HOUR + i;
                return (
                  <div
                    key={`hour-${hourKey}`}
                    className="absolute left-0 right-0 border-t border-slate-100"
                    style={{ top: i * HOUR_HEIGHT }}
                  />
                );
              })}

              {/* Now line */}
              {isToday && nowHour >= MIN_HOUR && nowHour <= MAX_HOUR && (
                <div
                  className="absolute left-0 right-0 z-10 border-t-2 border-red-500"
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

                return (
                  <button
                    key={job.id}
                    type="button"
                    className={cn(
                      'absolute left-1 right-1 overflow-hidden rounded px-2 py-1 text-left text-xs shadow-sm transition-shadow hover:shadow-md',
                      job.jobStatus === 'finished'
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-blue-50 text-blue-900 border border-blue-200',
                    )}
                    style={{ top, height: Math.max(height, 28), zIndex: 5 }}
                    onClick={() => onJobClick(job.id)}
                  >
                    <div className="truncate font-medium">{job.customerDisplayName}</div>
                    {height > 36 && (
                      <div className="truncate text-[11px] opacity-75">
                        {job.titleOrSummary ?? job.jobNumber}
                      </div>
                    )}
                    {height > 52 && job.priceCents > 0 && (
                      <div className="text-[11px] opacity-60">{formatCents(job.priceCents)}</div>
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
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

function MonthView({
  date,
  onDayClick,
  onJobClick,
  onEventClick,
}: {
  date: string;
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
                    className="truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white"
                    style={{ backgroundColor: j.assigneeColor }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onJobClick(j.id);
                    }}
                  >
                    {j.customerDisplayName}
                    {j.titleOrSummary ? ` · ${j.titleOrSummary}` : ''}
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

function JobSlideOver({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobsApi.get(jobId),
    retry: false,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
  }

  const finishMutation = useMutation({
    mutationFn: () => jobsApi.finish(jobId),
    onSuccess: () => invalidate(),
  });

  const reopenMutation = useMutation({
    mutationFn: () => jobsApi.reopen(jobId),
    onSuccess: () => invalidate(),
  });

  const unscheduleMutation = useMutation({
    mutationFn: () => jobsApi.unschedule(jobId),
    onSuccess: () => invalidate(),
  });

  if (jobQuery.isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }
  if (jobQuery.error) {
    return <div className="p-6 text-sm text-red-600">Failed to load job.</div>;
  }

  const job = jobQuery.data as JobDto;

  const statusColor: Record<string, string> = {
    open: 'bg-blue-100 text-blue-800',
    finished: 'bg-slate-200 text-slate-700',
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{job.jobNumber}</h2>
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium capitalize ${statusColor[job.jobStatus] ?? 'bg-slate-100 text-slate-700'}`}
            >
              {job.jobStatus}
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
        <DetailRow label="Title" value={job.titleOrSummary ?? '—'} />
        <DetailRow label="Service" value={job.serviceName ?? '—'} />
        <DetailRow label="Price" value={formatCents(job.priceCents)} />
        <DetailRow label="Lead source" value={job.leadSource ?? '—'} />
        <DetailRow
          label="Schedule"
          value={
            job.scheduleState === 'scheduled' && job.scheduledStartAt && job.scheduledEndAt
              ? `${formatTime(job.scheduledStartAt)} – ${formatTime(job.scheduledEndAt)}`
              : 'Unscheduled'
          }
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
        {job.jobStatus === 'open' && (
          <Button
            size="sm"
            onClick={() => finishMutation.mutate()}
            disabled={finishMutation.isPending}
          >
            {finishMutation.isPending ? 'Finishing…' : 'Finish'}
          </Button>
        )}
        {job.jobStatus === 'finished' && job.invoice?.status === 'draft' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => reopenMutation.mutate()}
            disabled={reopenMutation.isPending}
          >
            {reopenMutation.isPending ? 'Reopening…' : 'Reopen'}
          </Button>
        )}
        {job.scheduleState === 'scheduled' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => unscheduleMutation.mutate()}
            disabled={unscheduleMutation.isPending}
          >
            Unschedule
          </Button>
        )}
      </div>
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
