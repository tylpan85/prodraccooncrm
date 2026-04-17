'use client';

import type { InvoiceSummaryDto } from '@openclaw/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { TableSkeleton } from '../../../../components/ui/skeleton';
import { invoicesApi } from '../../../../lib/invoices-api';

const TABS = [
  { key: 'unsent', label: 'Unsent' },
  { key: 'open', label: 'Open' },
  { key: 'past_due', label: 'Past Due' },
  { key: 'paid', label: 'Paid' },
  { key: 'void', label: 'Void' },
] as const;

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    sent: 'bg-blue-100 text-blue-700',
    past_due: 'bg-amber-100 text-amber-700',
    paid: 'bg-green-100 text-green-700',
    void: 'bg-red-100 text-red-700',
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {status === 'past_due' ? 'Past Due' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function InvoicesPage() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('status') ?? 'unsent';
  const [activeTab, setActiveTab] = useState(initialTab);

  const invoicesQuery = useQuery({
    queryKey: ['invoices', activeTab],
    queryFn: () => invoicesApi.list({ status: activeTab }),
  });

  const invoices: InvoiceSummaryDto[] = invoicesQuery.data?.items ?? [];

  return (
    <div className="px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">Invoices</h1>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab.key
                ? 'border-b-2 border-brand-600 text-brand-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {invoicesQuery.isLoading ? (
        <div className="mt-4">
          <TableSkeleton rows={5} cols={6} />
        </div>
      ) : invoices.length === 0 ? (
        <div className="mt-8 rounded-md border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
          No invoices in this tab.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase text-slate-500">
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">Due Date</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/invoices/${inv.id}` as Route}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      #{inv.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {inv.customerDisplayName ?? 'Unknown'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{inv.serviceNameSnapshot ?? '-'}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-900">
                    {formatCents(inv.totalCents)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{inv.dueDate ?? 'Upon receipt'}</td>
                  <td className="px-3 py-2">{statusBadge(inv.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
