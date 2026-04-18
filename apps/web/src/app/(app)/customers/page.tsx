'use client';

import type { CustomerSummaryDto } from '@openclaw/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { TableSkeleton } from '../../../components/ui/skeleton';
import { customersApi } from '../../../lib/customers-api';

type Tab = 'active' | 'archived';

export default function CustomersPage() {
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  const customersQuery = useQuery({
    queryKey: ['customers', tab, appliedQuery, cursor],
    queryFn: () => customersApi.list({ q: appliedQuery, cursor, limit: 25, archived: tab === 'archived' }),
  });

  const items: CustomerSummaryDto[] = customersQuery.data?.items ?? [];
  const nextCursor = customersQuery.data?.nextCursor ?? null;

  return (
    <div className="px-6 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Search by name, email, or phone digits.</p>
        </div>
        <Link href={'/customers/new' as Route}>
          <Button>New customer</Button>
        </Link>
      </div>

      <div className="mt-6 flex gap-4 border-b border-slate-200">
        {(['active', 'archived'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setAppliedQuery(''); setSearch(''); setCursor(null); }}
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

      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setCursor(null);
          setAppliedQuery(search);
        }}
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="max-w-md"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {appliedQuery && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearch('');
              setAppliedQuery('');
              setCursor(null);
            }}
          >
            Clear
          </Button>
        )}
      </form>

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
                    {appliedQuery
                      ? 'No customers match that search.'
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
