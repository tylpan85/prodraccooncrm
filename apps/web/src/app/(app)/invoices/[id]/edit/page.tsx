'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../../lib/api-client';
import { invoicesApi } from '../../../../../lib/invoices-api';

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

  const [serviceName, setServiceName] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (invoiceQuery.data && !loaded) {
      const inv = invoiceQuery.data;
      setServiceName(inv.serviceNameSnapshot ?? '');
      setPriceStr(
        inv.servicePriceCentsSnapshot != null
          ? (inv.servicePriceCentsSnapshot / 100).toFixed(2)
          : '',
      );
      setDueDate(inv.dueDate ?? '');
      setLoaded(true);
    }
  }, [invoiceQuery.data, loaded]);

  const editMutation = useMutation({
    mutationFn: () => {
      const priceDollars = Number.parseFloat(priceStr);
      const priceCents = Number.isNaN(priceDollars) ? undefined : Math.round(priceDollars * 100);
      return invoicesApi.edit(id, {
        serviceNameSnapshot: serviceName || undefined,
        servicePriceCentsSnapshot: priceCents,
        dueDate: dueDate || null,
      });
    },
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
  if (invoiceQuery.error) {
    return <div className="px-6 py-8 text-sm text-slate-700">Could not load invoice.</div>;
  }

  const saving = editMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">Edit invoice</h1>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          editMutation.mutate();
        }}
      >
        <div>
          <Label>Service Name</Label>
          <Input
            className="mt-1"
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            maxLength={255}
            disabled={saving}
          />
        </div>

        <div>
          <Label>Price ($)</Label>
          <Input
            className="mt-1"
            type="number"
            step="0.01"
            min="0"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            disabled={saving}
          />
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
    </div>
  );
}
