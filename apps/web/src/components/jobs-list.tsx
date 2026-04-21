'use client';

import type { JobSummaryDto } from '@openclaw/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  jobsApi,
  type JobsListFilters,
  type JobStageFilter,
} from '../lib/jobs-api';
import { settingsApi } from '../lib/settings-api';
import { Button } from './ui/button';
import { TableSkeleton } from './ui/skeleton';

const STAGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  scheduled:         { bg: 'bg-slate-100',   text: 'text-slate-600', label: 'Scheduled' },
  confirmation_sent: { bg: 'bg-blue-100',    text: 'text-blue-700',  label: 'Conf. Sent' },
  confirmed:         { bg: 'bg-green-100',   text: 'text-green-700', label: 'Confirmed' },
  job_done:          { bg: 'bg-emerald-600', text: 'text-white',     label: 'Done' },
  cancelled:         { bg: 'bg-red-100',     text: 'text-red-700',   label: 'Cancelled' },
};

const STAGE_OPTIONS: { value: JobStageFilter; label: string }[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'confirmation_sent', label: 'Confirmation sent' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'job_done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

function fmtHour(d: Date): string {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

function formatSchedule(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const month = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = start.getUTCDate();
  const year = start.getUTCFullYear();
  return `${month} ${day} ${year} ${fmtHour(start)}–${fmtHour(end)}`;
}

function TodayLine() {
  return (
    <div className="flex items-center gap-2 px-4 py-1">
      <div className="h-px flex-1 bg-red-400" />
      <span className="whitespace-nowrap text-xs font-medium text-red-500">Today</span>
      <div className="h-px flex-1 bg-red-400" />
    </div>
  );
}

type PaginationWindow = {
  items: JobSummaryDto[];
  nextCursorBefore: string | null;
  hasMoreBefore: boolean;
  nextCursorAfter: string | null;
  hasMoreAfter: boolean;
  anchorIso: string;
};

type FilterState = {
  q: string;
  stage: '' | JobStageFilter;
  serviceId: string;
  assigneeTeamMemberId: string;
  tag: string;
  dateFrom: string; // yyyy-mm-dd (date input)
  dateTo: string;   // yyyy-mm-dd
  priceMinDollars: string;
  priceMaxDollars: string;
};

const EMPTY_FILTERS: FilterState = {
  q: '',
  stage: '',
  serviceId: '',
  assigneeTeamMemberId: '',
  tag: '',
  dateFrom: '',
  dateTo: '',
  priceMinDollars: '',
  priceMaxDollars: '',
};

function toApiFilters(f: FilterState, customerId?: string): JobsListFilters {
  const out: JobsListFilters = {};
  if (customerId) out.customerId = customerId;
  if (f.q.trim()) out.q = f.q.trim();
  if (f.stage) out.stage = f.stage;
  if (f.serviceId) out.serviceId = f.serviceId;
  if (f.assigneeTeamMemberId) out.assigneeTeamMemberId = f.assigneeTeamMemberId;
  if (f.tag.trim()) out.tag = f.tag.trim();
  if (f.dateFrom) out.dateFrom = new Date(`${f.dateFrom}T00:00:00.000Z`).toISOString();
  if (f.dateTo) out.dateTo = new Date(`${f.dateTo}T23:59:59.999Z`).toISOString();
  const minCents = f.priceMinDollars ? Math.round(Number(f.priceMinDollars) * 100) : NaN;
  const maxCents = f.priceMaxDollars ? Math.round(Number(f.priceMaxDollars) * 100) : NaN;
  if (!Number.isNaN(minCents) && minCents >= 0) out.priceMinCents = minCents;
  if (!Number.isNaN(maxCents) && maxCents >= 0) out.priceMaxCents = maxCents;
  return out;
}

export interface JobsListProps {
  customerId?: string;
  headerActions?: ReactNode;
  title?: string;
  emptyMessage?: string;
  hideHeader?: boolean;
}

export function JobsList({
  customerId,
  headerActions,
  title = 'Jobs',
  emptyMessage,
  hideHeader = false,
}: JobsListProps) {
  const lockedCustomer = !!customerId;

  const [pending, setPending] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const apiFilters = useMemo(() => toApiFilters(applied, customerId), [applied, customerId]);
  const filterKey = useMemo(() => JSON.stringify(apiFilters), [apiFilters]);

  const [win, setWin] = useState<PaginationWindow | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [beforeLoading, setBeforeLoading] = useState(false);
  const [afterLoading, setAfterLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const scrolledRef = useRef(false);
  const todayRowRef = useRef<HTMLTableRowElement>(null);

  const servicesQuery = useQuery({
    queryKey: ['services', { includeInactive: false }],
    queryFn: () => settingsApi.listServices(),
  });
  const teamQuery = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => settingsApi.listTeamMembers(),
  });

  useEffect(() => {
    let cancelled = false;
    setWin(null);
    setError(null);
    scrolledRef.current = false;
    setInitialLoading(true);
    const anchorIso = apiFilters.dateFrom ?? new Date().toISOString();
    jobsApi
      .list({ ...apiFilters, anchor: anchorIso })
      .then((res) => {
        if (cancelled) return;
        setWin({
          items: res.items,
          nextCursorBefore: res.nextCursorBefore ?? null,
          hasMoreBefore: !!res.hasMoreBefore,
          nextCursorAfter: res.nextCursorAfter ?? null,
          hasMoreAfter: !!res.hasMoreAfter,
          anchorIso,
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterKey, apiFilters]);

  const loadMoreBefore = async () => {
    if (!win || !win.nextCursorBefore || beforeLoading) return;
    setBeforeLoading(true);
    try {
      const res = await jobsApi.list({
        ...apiFilters,
        direction: 'before',
        cursor: win.nextCursorBefore,
        limit: 15,
      });
      setWin((s) =>
        s
          ? {
              ...s,
              items: [...res.items, ...s.items],
              nextCursorBefore: res.nextCursorBefore ?? null,
              hasMoreBefore: !!res.hasMoreBefore,
            }
          : s,
      );
    } finally {
      setBeforeLoading(false);
    }
  };

  const loadMoreAfter = async () => {
    if (!win || !win.nextCursorAfter || afterLoading) return;
    setAfterLoading(true);
    try {
      const res = await jobsApi.list({
        ...apiFilters,
        direction: 'after',
        cursor: win.nextCursorAfter,
        limit: 15,
      });
      setWin((s) =>
        s
          ? {
              ...s,
              items: [...s.items, ...res.items],
              nextCursorAfter: res.nextCursorAfter ?? null,
              hasMoreAfter: !!res.hasMoreAfter,
            }
          : s,
      );
    } finally {
      setAfterLoading(false);
    }
  };

  const todayMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const showTodayLine = useMemo(() => {
    if (applied.dateFrom) {
      const fromMs = new Date(`${applied.dateFrom}T00:00:00.000Z`).getTime();
      if (todayMs < fromMs) return false;
    }
    if (applied.dateTo) {
      const toMs = new Date(`${applied.dateTo}T23:59:59.999Z`).getTime();
      if (todayMs > toMs) return false;
    }
    return true;
  }, [applied.dateFrom, applied.dateTo, todayMs]);

  useEffect(() => {
    if (!win || scrolledRef.current || !showTodayLine) return;
    if (todayRowRef.current) {
      todayRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolledRef.current = true;
    }
  }, [win, showTodayLine]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (applied.q) n++;
    if (applied.stage) n++;
    if (applied.serviceId) n++;
    if (applied.assigneeTeamMemberId) n++;
    if (applied.tag) n++;
    if (applied.dateFrom) n++;
    if (applied.dateTo) n++;
    if (applied.priceMinDollars) n++;
    if (applied.priceMaxDollars) n++;
    return n;
  }, [applied]);

  const applyFilters = () => {
    setApplied(pending);
  };
  const resetFilters = () => {
    setPending(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const colCount = lockedCustomer ? 6 : 7;

  return (
    <div>
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Button>
            {headerActions}
          </div>
        </div>
      )}

      {hideHeader && (
        <div className="mb-3 flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
          {headerActions ? (
            <div className="flex items-center gap-2">{headerActions}</div>
          ) : null}
        </div>
      )}

      {showFilters && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <LabelInput
              label="Search"
              placeholder="Title, job #, customer…"
              value={pending.q}
              onChange={(v) => setPending({ ...pending, q: v })}
            />
            <LabelSelect
              label="Stage"
              value={pending.stage}
              onChange={(v) => setPending({ ...pending, stage: v as FilterState['stage'] })}
              options={[{ value: '', label: 'Any' }, ...STAGE_OPTIONS]}
            />
            <LabelSelect
              label="Service"
              value={pending.serviceId}
              onChange={(v) => setPending({ ...pending, serviceId: v })}
              options={[
                { value: '', label: 'Any' },
                ...(servicesQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <LabelSelect
              label="Assignee"
              value={pending.assigneeTeamMemberId}
              onChange={(v) => setPending({ ...pending, assigneeTeamMemberId: v })}
              options={[
                { value: '', label: 'Any' },
                ...(teamQuery.data?.items ?? []).map((m) => ({ value: m.id, label: m.displayName })),
              ]}
            />
            <LabelInput
              label="Tag"
              placeholder="exact match"
              value={pending.tag}
              onChange={(v) => setPending({ ...pending, tag: v })}
            />
            <div /> {/* spacer */}
            <LabelInput
              label="Date from"
              type="date"
              value={pending.dateFrom}
              onChange={(v) => setPending({ ...pending, dateFrom: v })}
            />
            <LabelInput
              label="Date to"
              type="date"
              value={pending.dateTo}
              onChange={(v) => setPending({ ...pending, dateTo: v })}
            />
            <div /> {/* spacer */}
            <LabelInput
              label="Min price ($)"
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={pending.priceMinDollars}
              onChange={(v) => setPending({ ...pending, priceMinDollars: v })}
            />
            <LabelInput
              label="Max price ($)"
              type="number"
              inputMode="decimal"
              placeholder=""
              value={pending.priceMaxDollars}
              onChange={(v) => setPending({ ...pending, priceMaxDollars: v })}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={applyFilters}>Apply filters</Button>
            <Button size="sm" variant="secondary" onClick={resetFilters}>Reset</Button>
          </div>
        </div>
      )}

      {initialLoading && !win && (
        <div className="mt-6">
          <TableSkeleton rows={5} cols={colCount} />
        </div>
      )}
      {!initialLoading && error != null && !win && (
        <p className="mt-6 text-sm text-red-600">Could not load jobs.</p>
      )}
      {win && win.items.length === 0 && !initialLoading && (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
          {emptyMessage ?? (activeFilterCount > 0
            ? 'No jobs match the current filters.'
            : 'No jobs yet — create one from a customer or the scheduler.')}
        </div>
      )}

      {win && win.items.length > 0 && (() => {
        const todayIdx = showTodayLine
          ? win.items.findIndex((j) => new Date(j.scheduledStartAt).getTime() >= todayMs)
          : -1;

        return (
          <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Job #</th>
                  {!lockedCustomer && <th className="px-4 py-3 font-medium">Customer</th>}
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Schedule</th>
                  <th className="px-4 py-3 font-medium">Assignee</th>
                  <th className="px-4 py-3 font-medium text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {win.hasMoreBefore && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-2 text-center">
                      <button
                        type="button"
                        onClick={loadMoreBefore}
                        disabled={beforeLoading}
                        className="text-sm font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        {beforeLoading ? 'Loading…' : 'Load earlier'}
                      </button>
                    </td>
                  </tr>
                )}
                {win.items.flatMap((j, idx) => {
                  const s = STAGE_STYLES[j.jobStage] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: j.jobStage };
                  const row = (
                    <tr key={j.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        <Link href={`/jobs/${j.id}` as Route} className="text-brand-700 hover:underline">
                          {j.jobNumber}
                        </Link>
                      </td>
                      {!lockedCustomer && (
                        <td className="px-4 py-3 text-sm text-slate-700">
                          <Link href={`/customers/${j.customerId}` as Route} className="hover:underline">
                            {j.customerDisplayName}
                          </Link>
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm text-slate-700">{j.titleOrSummary ?? '—'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatSchedule(j.scheduledStartAt, j.scheduledEndAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{j.assigneeDisplayName ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">
                        ${(j.priceCents / 100).toFixed(2)}
                      </td>
                    </tr>
                  );
                  if (idx === todayIdx) {
                    return [
                      <tr key="today-line" ref={todayRowRef}>
                        <td colSpan={colCount} className="px-0 py-0"><TodayLine /></td>
                      </tr>,
                      row,
                    ];
                  }
                  return [row];
                })}
                {showTodayLine && todayIdx === -1 && win.items.length > 0 && !win.hasMoreAfter && (
                  <tr ref={todayRowRef}>
                    <td colSpan={colCount} className="px-0 py-0"><TodayLine /></td>
                  </tr>
                )}
                {win.hasMoreAfter && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-2 text-center">
                      <button
                        type="button"
                        onClick={loadMoreAfter}
                        disabled={afterLoading}
                        className="text-sm font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        {afterLoading ? 'Loading…' : 'Load later'}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}

function LabelInput({
  label,
  value,
  onChange,
  type,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
}) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <input
        type={type ?? 'text'}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
    </label>
  );
}

function LabelSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
