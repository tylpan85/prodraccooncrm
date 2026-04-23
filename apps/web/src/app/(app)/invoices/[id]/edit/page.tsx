'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  SmsDialog,
  formatCents,
} from '../../../../../components/invoice-action-dialogs';
import { Button } from '../../../../../components/ui/button';
import { Label } from '../../../../../components/ui/label';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../../lib/api-client';
import { invoicesApi } from '../../../../../lib/invoices-api';

type DialogKind = 'sms' | null;

export default function EditInvoicePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;

  const invoiceQuery = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoicesApi.get(id),
    retry: false,
  });

  const [dueDate, setDueDate] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);

  useEffect(() => {
    if (invoiceQuery.data && !loaded) {
      setDueDate(invoiceQuery.data.dueDate ?? '');
      setLoaded(true);
    }
  }, [invoiceQuery.data, loaded]);

  const editMutation = useMutation({
    mutationFn: () =>
      invoicesApi.edit(id, {
        dueDate: dueDate || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      router.push(`/invoices/${id}` as Route);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update invoice');
    },
  });

  if (invoiceQuery.isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Skeleton className="mb-6 h-7 w-40" />
        <div className="space-y-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }
  if (invoiceQuery.error || !invoiceQuery.data) {
    return <div className="px-6 py-8 text-sm text-slate-700">Could not load invoice.</div>;
  }

  const invoice = invoiceQuery.data;
  const saving = editMutation.isPending;
  const canAct = invoice.status !== 'paid' && invoice.status !== 'void';

  const afterAction = (message: string) => {
    setDialog(null);
    setInfo(message);
    queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Edit invoice {invoice.invoiceNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Line items are pulled from the source job and cannot be edited here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setError(null);
              setInfo(null);
              setDialog('sms');
            }}
            disabled={!canAct || saving}
          >
            Send Invoice via SMS
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}
      {info && (
        <div className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {info}
        </div>
      )}

      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setInfo(null);
          editMutation.mutate();
        }}
      >
        <div>
          <Label>Line items</Label>
          <div className="mt-2 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {invoice.lineItems.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-500">No line items.</div>
            ) : (
              invoice.lineItems.map((li) => (
                <div
                  key={li.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="text-slate-800">{li.description}</span>
                  <span className="font-medium text-slate-900">
                    {formatCents(li.priceCents)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex justify-end text-sm text-slate-700">
            <span className="font-medium">Total: {formatCents(invoice.totalCents)}</span>
          </div>
        </div>

        <div>
          <Label>Due Date</Label>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={saving}
          />
          <p className="mt-1 text-xs text-slate-500">Leave blank for "Upon receipt"</p>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>

      {dialog === 'sms' && (
        <SmsDialog
          invoice={invoice}
          onClose={() => setDialog(null)}
          onDone={() => afterAction('Invoice SMS sent.')}
          onError={(msg) => {
            setDialog(null);
            setError(msg);
          }}
        />
      )}
    </div>
  );
}
