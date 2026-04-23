'use client';

import type { PaymentMethodDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Skeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { settingsApi } from '../../../../lib/settings-api';

function paymentMethodErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'PAYMENT_METHOD_DUPLICATE') {
      return 'A payment method with that name already exists.';
    }
    if (error.code === 'PAYMENT_METHOD_IN_USE') {
      return 'This payment method has been used on invoices and cannot be deleted. Deactivate it instead.';
    }
    return error.message;
  }
  return 'Could not save payment methods right now.';
}

interface NewMethodForm {
  name: string;
  referenceLabel: string;
}

export default function SettingsPaymentMethodsPage() {
  const queryClient = useQueryClient();
  const [newForm, setNewForm] = useState<NewMethodForm>({ name: '', referenceLabel: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editReferenceLabel, setEditReferenceLabel] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const methodsQuery = useQuery({
    queryKey: ['payment-methods', 'settings'],
    queryFn: () => settingsApi.listPaymentMethods(true).then((r) => r.items),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['payment-methods'] });

  const createMutation = useMutation({
    mutationFn: (form: NewMethodForm) =>
      settingsApi.createPaymentMethod({
        name: form.name,
        referenceLabel: form.referenceLabel.trim() === '' ? null : form.referenceLabel.trim(),
      }),
    onSuccess: async () => {
      setNewForm({ name: '', referenceLabel: '' });
      setFeedback(null);
      await invalidate();
    },
    onError: (error) => setFeedback(paymentMethodErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: {
      id: string;
      payload: { name?: string; referenceLabel?: string | null; active?: boolean };
    }) => settingsApi.updatePaymentMethod(id, payload),
    onSuccess: async () => {
      setEditingId(null);
      setFeedback(null);
      await invalidate();
    },
    onError: (error) => setFeedback(paymentMethodErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deletePaymentMethod(id),
    onSuccess: async () => {
      setFeedback(null);
      await invalidate();
    },
    onError: (error) => setFeedback(paymentMethodErrorMessage(error)),
  });

  const methods = useMemo(() => methodsQuery.data ?? [], [methodsQuery.data]);
  const updateBusyId = (updateMutation.variables as { id?: string } | undefined)?.id;

  function startEdit(method: PaymentMethodDto) {
    setEditingId(method.id);
    setEditName(method.name);
    setEditReferenceLabel(method.referenceLabel ?? '');
    setFeedback(null);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newForm.name.trim();
    if (!name) {
      setFeedback('Payment method name is required.');
      return;
    }
    await createMutation.mutateAsync({ name, referenceLabel: newForm.referenceLabel });
  }

  async function handleSaveEdit(method: PaymentMethodDto) {
    const name = editName.trim();
    if (!name) {
      setFeedback('Payment method name is required.');
      return;
    }
    const trimmedRef = editReferenceLabel.trim();
    await updateMutation.mutateAsync({
      id: method.id,
      payload: {
        name,
        referenceLabel: trimmedRef === '' ? null : trimmedRef,
      },
    });
  }

  async function handleDelete(method: PaymentMethodDto) {
    setFeedback(null);
    if (!window.confirm(`Delete "${method.name}"?`)) return;
    await deleteMutation.mutateAsync(method.id);
  }

  return (
    <div className="px-6 py-8">
      <div className="max-w-5xl">
        <h1 className="text-xl font-semibold text-slate-900">Payment Methods</h1>
        <p className="mt-2 text-sm text-slate-500">
          Catalog of how you accept payment. Each invoice payment must reference one of these.
        </p>

        <form
          className="mt-6 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={handleCreate}
        >
          <div>
            <label htmlFor="new-pm-name" className="block text-sm font-medium text-slate-700">
              Name
            </label>
            <Input
              id="new-pm-name"
              value={newForm.name}
              onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Cash, Check, Zelle…"
              className="mt-1"
              disabled={createMutation.isPending}
            />
          </div>
          <div>
            <label htmlFor="new-pm-ref" className="block text-sm font-medium text-slate-700">
              Reference label <span className="text-slate-400">(optional)</span>
            </label>
            <Input
              id="new-pm-ref"
              value={newForm.referenceLabel}
              onChange={(e) => setNewForm((f) => ({ ...f, referenceLabel: e.target.value }))}
              placeholder="Check #"
              className="mt-1"
              disabled={createMutation.isPending}
            />
          </div>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Adding…' : 'Add'}
          </Button>
        </form>

        {feedback && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{feedback}</p>
        )}

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Reference label</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {methodsQuery.isLoading &&
                Array.from({ length: 3 }, (_, i) => (
                  <tr key={`skel-${i}`}>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                  </tr>
                ))}

              {!methodsQuery.isLoading && methods.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-slate-500">
                    No payment methods yet.
                  </td>
                </tr>
              )}

              {methods.map((method) => {
                const editing = editingId === method.id;
                const rowBusy =
                  (deleteMutation.isPending && deleteMutation.variables === method.id) ||
                  (updateMutation.isPending && updateBusyId === method.id);

                return (
                  <tr key={method.id} className="align-top">
                    <td className="px-4 py-3">
                      {editing ? (
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          disabled={rowBusy}
                        />
                      ) : (
                        <div className="text-sm font-medium text-slate-900">{method.name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 capitalize">{method.source}</td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <Input
                          value={editReferenceLabel}
                          onChange={(e) => setEditReferenceLabel(e.target.value)}
                          placeholder="Check #"
                          disabled={rowBusy}
                        />
                      ) : (
                        <div className="text-sm text-slate-600">
                          {method.referenceLabel ?? <span className="text-slate-400">—</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          method.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {method.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" disabled={rowBusy} onClick={() => handleSaveEdit(method)}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" disabled={rowBusy} onClick={() => startEdit(method)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() => updateMutation.mutate({ id: method.id, payload: { active: !method.active } })}
                          >
                            {method.active ? 'Deactivate' : 'Activate'}
                          </Button>
                          {method.source !== 'stripe' && (
                            <Button size="sm" variant="danger" disabled={rowBusy} onClick={() => handleDelete(method)}>
                              Delete
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
