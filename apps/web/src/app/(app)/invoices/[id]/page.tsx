'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { DetailSkeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { invoicesApi } from '../../../../lib/invoices-api';

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
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${colors[status] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {status === 'past_due' ? 'Past Due' : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;
  const [error, setError] = useState<string | null>(null);

  const invoiceQuery = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoicesApi.get(id),
    retry: false,
  });

  const sendMutation = useMutation({
    mutationFn: () => invoicesApi.send(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed'),
  });

  const markPaidMutation = useMutation({
    mutationFn: () => invoicesApi.markPaid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed'),
  });

  const voidMutation = useMutation({
    mutationFn: () => invoicesApi.void(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed'),
  });

  if (invoiceQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (invoiceQuery.error || !invoiceQuery.data) {
    return <div className="px-6 py-8 text-sm text-slate-700">Could not load invoice.</div>;
  }

  const inv = invoiceQuery.data;
  const busy = sendMutation.isPending || markPaidMutation.isPending || voidMutation.isPending;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">Invoice #{inv.invoiceNumber}</h1>
            {statusBadge(inv.status)}
          </div>
          {inv.customerDisplayName && (
            <p className="mt-1 text-sm text-slate-500">
              <Link
                href={`/customers/${inv.customerId}` as Route}
                className="text-brand-600 hover:underline"
              >
                {inv.customerDisplayName}
              </Link>
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-slate-900">{formatCents(inv.totalCents)}</p>
          {inv.amountDueCents > 0 && inv.amountDueCents !== inv.totalCents && (
            <p className="text-sm text-slate-500">Due: {formatCents(inv.amountDueCents)}</p>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {inv.status === 'past_due' && (
        <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This invoice is past due (due {inv.dueDate}).
        </div>
      )}

      {/* Body */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        {/* Line detail */}
        <div className="rounded-md border border-slate-200 p-4">
          <h2 className="text-sm font-medium text-slate-500">Line Item</h2>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Service</span>
              <span className="text-slate-900">{inv.serviceNameSnapshot ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Price</span>
              <span className="text-slate-900">
                {inv.servicePriceCentsSnapshot != null
                  ? formatCents(inv.servicePriceCentsSnapshot)
                  : '-'}
              </span>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-200 pt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Subtotal</span>
              <span>{formatCents(inv.subtotalCents)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-slate-700">Total</span>
              <span className="text-slate-900">{formatCents(inv.totalCents)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-slate-700">Amount Due</span>
              <span className="text-slate-900">{formatCents(inv.amountDueCents)}</span>
            </div>
          </div>
        </div>

        {/* Info sidebar */}
        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 p-4 text-sm">
            <h2 className="font-medium text-slate-500">Details</h2>
            <div className="mt-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-600">Due Date</span>
                <span className="text-slate-900">{inv.dueDate ?? 'Upon receipt'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Linked Job</span>
                <Link
                  href={`/jobs/${inv.jobId}` as Route}
                  className="text-brand-600 hover:underline"
                >
                  {inv.jobNumber ?? inv.jobId.slice(0, 8)}
                </Link>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Created</span>
                <span className="text-slate-900">
                  {new Date(inv.createdAt).toLocaleDateString('en-US')}
                </span>
              </div>
              {inv.sentAt && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Sent</span>
                  <span className="text-slate-900">
                    {new Date(inv.sentAt).toLocaleDateString('en-US')}
                  </span>
                </div>
              )}
              {inv.paidAt && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Paid</span>
                  <span className="text-slate-900">
                    {new Date(inv.paidAt).toLocaleDateString('en-US')}
                  </span>
                </div>
              )}
              {inv.voidedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Voided</span>
                  <span className="text-slate-900">
                    {new Date(inv.voidedAt).toLocaleDateString('en-US')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {inv.status === 'draft' && (
              <>
                <Button onClick={() => sendMutation.mutate()} disabled={busy}>
                  Mark as sent
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => router.push(`/invoices/${id}/edit` as Route)}
                  disabled={busy}
                >
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (confirm('Void this invoice?')) voidMutation.mutate();
                  }}
                  disabled={busy}
                >
                  Void
                </Button>
              </>
            )}
            {(inv.status === 'sent' || inv.status === 'past_due') && (
              <>
                <Button onClick={() => markPaidMutation.mutate()} disabled={busy}>
                  Mark paid
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (confirm('Void this invoice?')) voidMutation.mutate();
                  }}
                  disabled={busy}
                >
                  Void
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Link
          href={'/customers/invoices' as Route}
          className="text-sm text-brand-600 hover:underline"
        >
          Back to invoices
        </Link>
      </div>
    </div>
  );
}
