'use client';

import type { CustomerSummaryDto } from '@openclaw/shared';
import { US_STATES } from '@openclaw/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { TableSkeleton } from '../../../components/ui/skeleton';
import { customersApi, type ListCustomersParams } from '../../../lib/customers-api';

type Tab = 'active' | 'archived';

type TriState = '' | 'true' | 'false';

type FilterState = {
  q: string;
  customerType: '' | 'Homeowner' | 'Business';
  subcontractor: TriState;
  doNotService: TriState;
  sendNotifications: TriState;
  tag: string;
  city: string;
  state: string;
  leadSource: string;
};

const EMPTY_FILTERS: FilterState = {
  q: '',
  customerType: '',
  subcontractor: '',
  doNotService: '',
  sendNotifications: '',
  tag: '',
  city: '',
  state: '',
  leadSource: '',
};

function triToBool(v: TriState): boolean | undefined {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function toApiParams(
  f: FilterState,
  tab: Tab,
  cursor: string | null,
): ListCustomersParams {
  const out: ListCustomersParams = {
    limit: 25,
    archived: tab === 'archived',
  };
  if (cursor) out.cursor = cursor;
  if (f.q.trim()) out.q = f.q.trim();
  if (f.customerType) out.customerType = f.customerType;
  const sub = triToBool(f.subcontractor);
  if (sub !== undefined) out.subcontractor = sub;
  const dns = triToBool(f.doNotService);
  if (dns !== undefined) out.doNotService = dns;
  const sn = triToBool(f.sendNotifications);
  if (sn !== undefined) out.sendNotifications = sn;
  if (f.tag.trim()) out.tag = f.tag.trim();
  if (f.city.trim()) out.city = f.city.trim();
  if (f.state) out.state = f.state;
  if (f.leadSource.trim()) out.leadSource = f.leadSource.trim();
  return out;
}

export default function CustomersPage() {
  const [tab, setTab] = useState<Tab>('active');
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const apiParams = useMemo(() => toApiParams(applied, tab, cursor), [applied, tab, cursor]);

  const customersQuery = useQuery({
    queryKey: ['customers', tab, applied, cursor],
    queryFn: () => customersApi.list(apiParams),
  });

  const items: CustomerSummaryDto[] = customersQuery.data?.items ?? [];
  const nextCursor = customersQuery.data?.nextCursor ?? null;

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (applied.q) n++;
    if (applied.customerType) n++;
    if (applied.subcontractor) n++;
    if (applied.doNotService) n++;
    if (applied.sendNotifications) n++;
    if (applied.tag) n++;
    if (applied.city) n++;
    if (applied.state) n++;
    if (applied.leadSource) n++;
    return n;
  }, [applied]);

  const applyFilters = () => {
    setCursor(null);
    setApplied(pending);
  };
  const resetFilters = () => {
    setCursor(null);
    setPending(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setCursor(null);
    setPending(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  return (
    <div className="px-6 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Search by name, email, or phone digits.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
          <Link href={'/customers/new' as Route}>
            <Button>New customer</Button>
          </Link>
        </div>
      </div>

      <div className="mt-6 flex gap-4 border-b border-slate-200">
        {(['active', 'archived'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchTab(t)}
            className={`-mb-px border-b-2 pb-3 text-sm font-medium capitalize ${
              tab === t
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <LabelInput
              label="Search"
              placeholder="Name, email, phone digits…"
              value={pending.q}
              onChange={(v) => setPending({ ...pending, q: v })}
            />
            <LabelSelect
              label="Customer type"
              value={pending.customerType}
              onChange={(v) => setPending({ ...pending, customerType: v as FilterState['customerType'] })}
              options={[
                { value: '', label: 'Any' },
                { value: 'Homeowner', label: 'Homeowner' },
                { value: 'Business', label: 'Business' },
              ]}
            />
            <LabelSelect
              label="Subcontractor"
              value={pending.subcontractor}
              onChange={(v) => setPending({ ...pending, subcontractor: v as TriState })}
              options={TRI_OPTIONS}
            />
            <LabelSelect
              label="Do not service"
              value={pending.doNotService}
              onChange={(v) => setPending({ ...pending, doNotService: v as TriState })}
              options={TRI_OPTIONS}
            />
            <LabelSelect
              label="Send notifications"
              value={pending.sendNotifications}
              onChange={(v) => setPending({ ...pending, sendNotifications: v as TriState })}
              options={TRI_OPTIONS}
            />
            <LabelInput
              label="Tag"
              placeholder="exact match"
              value={pending.tag}
              onChange={(v) => setPending({ ...pending, tag: v })}
            />
            <LabelInput
              label="City"
              placeholder="contains…"
              value={pending.city}
              onChange={(v) => setPending({ ...pending, city: v })}
            />
            <LabelSelect
              label="State"
              value={pending.state}
              onChange={(v) => setPending({ ...pending, state: v })}
              options={[
                { value: '', label: 'Any' },
                ...US_STATES.map((s) => ({ value: s, label: s })),
              ]}
            />
            <LabelInput
              label="Lead source"
              placeholder="contains…"
              value={pending.leadSource}
              onChange={(v) => setPending({ ...pending, leadSource: v })}
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={applyFilters}>Apply filters</Button>
            <Button size="sm" variant="secondary" onClick={resetFilters}>Reset</Button>
          </div>
        </div>
      )}

      {customersQuery.isLoading ? (
        <div className="mt-6">
          <TableSkeleton rows={5} cols={7} />
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">City</th>
                <th className="px-4 py-3 font-medium text-right">Jobs</th>
                <th className="px-4 py-3 font-medium text-right">Open inv</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-sm text-slate-500">
                    {activeFilterCount > 0
                      ? 'No customers match the current filters.'
                      : 'No customers yet — create your first one.'}
                  </td>
                </tr>
              )}
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    <Link href={`/customers/${c.id}` as Route} className="hover:underline">
                      {c.displayName}
                    </Link>
                    {c.doNotService && (
                      <span className="ml-2 inline-block rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        DNS
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{c.customerType}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{c.primaryPhone ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{c.primaryEmail ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-700">{c.city ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">{c.jobsCount}</td>
                  <td className="px-4 py-3 text-right text-sm text-slate-700">
                    {c.openInvoicesCount}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    <Link
                      href={`/customers/${c.id}/edit` as Route}
                      className="text-brand-700 hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Showing {items.length} customer{items.length === 1 ? '' : 's'}
        </p>
        <div className="flex gap-2">
          {cursor && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setCursor(null)}>
              First page
            </Button>
          )}
          {nextCursor && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCursor(nextCursor)}
            >
              Next page
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const TRI_OPTIONS: { value: TriState; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

function LabelInput({
  label,
  value,
  onChange,
  type,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <input
        type={type ?? 'text'}
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
