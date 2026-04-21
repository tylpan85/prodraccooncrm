'use client';

import type { InvoiceSummaryDto } from '@openclaw/shared';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  invoicesApi,
  type InvoicesListFilters,
  type InvoiceStatusFilter,
} from '../lib/invoices-api';
import { Button } from './ui/button';
import { TableSkeleton } from './ui/skeleton';

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft:    { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Unsent' },
  unsent:   { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Unsent' },
  sent:     { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'Sent' },
  open:     { bg: 'bg-blue-100',  text: 'text-blue-700',  label: 'Open' },
  past_due: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Past Due' },
  paid:     { bg: 'bg-green-100', text: 'text-green-700', label: 'Paid' },
  void:     { bg: 'bg-red-100',   text: 'text-red-700',   label: 'Void' },
};

const STATUS_OPTIONS: { value: InvoiceStatusFilter; label: string }[] = [
  { value: 'unsent', label: 'Unsent' },
  { value: 'open', label: 'Open' },
  { value: 'past_due', label: 'Past Due' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
];

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${month} ${day} ${year}`;
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
  items: InvoiceSummaryDto[];
  nextCursorBefore: string | null;
  hasMoreBefore: boolean;
  nextCursorAfter: string | null;
  hasMoreAfter: boolean;
  anchorIso: string;
};

type FilterState = {
  q: string;
  status: '' | InvoiceStatusFilter;
  dateFrom: string;
  dateTo: string;
  amountMinDollars: string;
  amountMaxDollars: string;
};

const EMPTY_FILTERS: FilterState = {
  q: '',
  status: '',
  dateFrom: '',
  dateTo: '',
  amountMinDollars: '',
  amountMaxDollars: '',
};

function toApiFilters(f: FilterState, customerId?: string): InvoicesListFilters {
  const out: InvoicesListFilters = {};
  if (customerId) out.customerId = customerId;
  if (f.q.trim()) out.q = f.q.trim();
  if (f.status) out.status = f.status;
  if (f.dateFrom) out.dateFrom = new Date(`${f.dateFrom}T00:00:00.000Z`).toISOString();
  if (f.dateTo) out.dateTo = new Date(`${f.dateTo}T23:59:59.999Z`).toISOString();
  const minCents = f.amountMinDollars ? Math.round(Number(f.amountMinDollars) * 100) : NaN;
  const maxCents = f.amountMaxDollars ? Math.round(Number(f.amountMaxDollars) * 100) : NaN;
  if (!Number.isNaN(minCents) && minCents >= 0) out.amountMinCents = minCents;
  if (!Number.isNaN(maxCents) && maxCents >= 0) out.amountMaxCents = maxCents;
  return out;
}

export interface InvoicesListProps {
  customerId?: string;
  headerActions?: ReactNode;
  title?: string;
  emptyMessage?: string;
  hideHeader?: boolean;
  initialStatus?: InvoiceStatusFilter;
}

export function InvoicesList({
  customerId,
  headerActions,
  title = 'Invoices',
  emptyMessage,
  hideHeader = false,
  initialStatus,
}: InvoicesListProps) {
  const lockedCustomer = !!customerId;

  const initial: FilterState = { ...EMPTY_FILTERS, status: initialStatus ?? '' };
  const [pending, setPending] = useState<FilterState>(initial);
  const [applied, setApplied] = useState<FilterState>(initial);
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

  useEffect(() => {
    let cancelled = false;
    setWin(null);
    setError(null);
    scrolledRef.current = false;
    setInitialLoading(true);
    const anchorIso = apiFilters.dateFrom ?? new Date().toISOString();
    invoicesApi
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
      const res = await invoicesApi.list({
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
      const res = await invoicesApi.list({
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
    if (applied.status) n++;
    if (applied.dateFrom) n++;
    if (applied.dateTo) n++;
    if (applied.amountMinDollars) n++;
    if (applied.amountMaxDollars) n++;
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
              placeholder="Invoice #, customer, service…"
              value={pending.q}
              onChange={(v) => setPending({ ...pending, q: v })}
            />
            <LabelSelect
              label="Status"
              value={pending.status}
              onChange={(v) => setPending({ ...pending, status: v as FilterState['status'] })}
              options={[{ value: '', label: 'Any' }, ...STATUS_OPTIONS]}
            />
            <div /> {/* spacer */}
            <LabelInput
              label="Created from"
              type="date"
              value={pending.dateFrom}
              onChange={(v) => setPending({ ...pending, dateFrom: v })}
            />
            <LabelInput
              label="Created to"
              type="date"
              value={pending.dateTo}
              onChange={(v) => setPending({ ...pending, dateTo: v })}
            />
            <div /> {/* spacer */}
            <LabelInput
              label="Min amount ($)"
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={pending.amountMinDollars}
              onChange={(v) => setPending({ ...pending, amountMinDollars: v })}
            />
            <LabelInput
              label="Max amount ($)"
              type="number"
              inputMode="decimal"
              placeholder=""
              value={pending.amountMaxDollars}
              onChange={(v) => setPending({ ...pending, amountMaxDollars: v })}
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
        <p className="mt-6 text-sm text-red-600">Could not load invoices.</p>
      )}
      {win && win.items.length === 0 && !initialLoading && (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
          {emptyMessage ?? (activeFilterCount > 0
            ? 'No invoices match the current filters.'
            : 'No invoices yet.')}
        </div>
      )}

      {win && win.items.length > 0 && (() => {
        const todayIdx = showTodayLine
          ? win.items.findIndex((inv) => new Date(inv.createdAt).getTime() >= todayMs)
          : -1;

        return (
          <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Number</th>
                  {!lockedCustomer && <th className="px-4 py-3 font-medium">Customer</th>}
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Status</th>
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
                {win.items.flatMap((inv, idx) => {
                  const s = STATUS_STYLES[inv.status] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: inv.status };
                  const row = (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        <Link href={`/invoices/${inv.id}` as Route} className="text-brand-700 hover:underline">
                          #{inv.invoiceNumber}
                        </Link>
                      </td>
                      {!lockedCustomer && (
                        <td className="px-4 py-3 text-sm text-slate-700">
                          <Link href={`/customers/${inv.customerId}` as Route} className="hover:underline">
                            {inv.customerDisplayName ?? 'Unknown'}
                          </Link>
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm text-slate-700">{inv.serviceNameSnapshot ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-slate-900">
                        {formatCents(inv.totalCents)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{formatDate(inv.createdAt)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{inv.dueDate ?? 'Upon receipt'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
                          {s.label}
                        </span>
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
