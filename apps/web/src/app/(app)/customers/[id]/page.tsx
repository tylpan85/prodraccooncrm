'use client';

import type {
  CustomerCardRequestDto,
  CustomerDto,
  CustomerPaymentMethodDto,
  NoteOp,
} from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AddCardDialog, RequestCardDialog } from '../../../../components/card-dialogs';
import { ConfirmDialog } from '../../../../components/invoice-action-dialogs';
import { InvoicesList } from '../../../../components/invoices-list';
import { JobsList } from '../../../../components/jobs-list';
import { NotesPanel, dedupeByNoteGroup } from '../../../../components/notes/notes-panel';
import { Button } from '../../../../components/ui/button';
import { DetailSkeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { cardsApi } from '../../../../lib/cards-api';
import { customersApi } from '../../../../lib/customers-api';

type Tab = 'overview' | 'jobs' | 'invoices';

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [tab, setTab] = useState<Tab>('overview');
  const queryClient = useQueryClient();

  const customerQuery = useQuery({
    queryKey: ['customer', id],
    queryFn: () => customersApi.get(id),
    retry: false,
  });

  const notesQuery = useQuery({
    queryKey: ['customer-notes', id],
    queryFn: () => customersApi.getNotes(id),
  });

  const [noteOps, setNoteOps] = useState<NoteOp[]>([]);

  const saveNotesMutation = useMutation({
    mutationFn: () => customersApi.saveNotes(id, { noteOps }),
    onSuccess: () => {
      setNoteOps([]);
      queryClient.invalidateQueries({ queryKey: ['customer-notes', id] });
    },
  });

  const dedupedNotes = useMemo(
    () => (notesQuery.data ? dedupeByNoteGroup(notesQuery.data.notes) : []),
    [notesQuery.data],
  );

  const archiveMutation = useMutation({
    mutationFn: () => customersApi.archiveCustomer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer', id] }),
  });

  const unarchiveMutation = useMutation({
    mutationFn: () => customersApi.unarchiveCustomer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer', id] }),
  });

  const [openCardDialog, setOpenCardDialog] = useState<'add' | 'request' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomerPaymentMethodDto | null>(null);
  const [cardActionError, setCardActionError] = useState<string | null>(null);

  const cardsQuery = useQuery({
    queryKey: ['customer-cards', id],
    queryFn: () => cardsApi.listPaymentMethods(id),
  });
  const requestsQuery = useQuery({
    queryKey: ['customer-card-requests', id],
    queryFn: () => cardsApi.listCardRequests(id),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (pmId: string) => cardsApi.setDefault(id, pmId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer-cards', id] }),
    onError: (err) =>
      setCardActionError(err instanceof Error ? err.message : 'Could not set default card.'),
  });

  const paymentMethods = cardsQuery.data?.items ?? [];
  const pendingCardRequests = (requestsQuery.data?.items ?? []).filter(
    (r) => r.status === 'pending' && new Date(r.expiresAt).getTime() > Date.now(),
  );

  if (customerQuery.isLoading) {
    return (
      <div className="px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (customerQuery.error) {
    const err = customerQuery.error;
    const notFound = err instanceof ApiClientError && err.code === 'CUSTOMER_NOT_FOUND';
    return (
      <div className="px-6 py-8 text-sm text-slate-700">
        {notFound ? 'Customer not found.' : 'Could not load customer.'}
        <div className="mt-3">
          <Link href="/customers" className="text-brand-700 hover:underline">
            Back to customers
          </Link>
        </div>
      </div>
    );
  }
  const c = customerQuery.data as CustomerDto;
  const initials = c.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  const primaryAddress = c.addresses[0];
  const additionalAddresses = c.addresses.slice(1);

  return (
    <div className="px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-base font-semibold text-brand-700">
            {initials}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{c.displayName}</h1>
            <div className="mt-1 flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                {c.customerType}
              </span>
              {c.subcontractor && (
                <span className="inline-flex items-center rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
                  Subcontractor
                </span>
              )}
              {c.archived && (
                <span className="inline-flex items-center rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                  Archived
                </span>
              )}
              {c.doNotService && (
                <span className="inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                  Do not service
                </span>
              )}
              {!c.sendNotifications && !c.doNotService && (
                <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Notifications off
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.archived ? (
            <Button
              variant="secondary"
              disabled={unarchiveMutation.isPending}
              onClick={() => unarchiveMutation.mutate()}
            >
              {unarchiveMutation.isPending ? 'Restoring…' : 'Restore'}
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={archiveMutation.isPending}
              onClick={() => archiveMutation.mutate()}
            >
              {archiveMutation.isPending ? 'Archiving…' : 'Archive'}
            </Button>
          )}
          <Link href={`/customers/${c.id}/edit` as Route}>
            <Button variant="secondary">Edit</Button>
          </Link>
          <Link href={`/jobs/new?customerId=${c.id}` as Route}>
            <Button>New job</Button>
          </Link>
        </div>
      </div>

      <nav className="mt-6 flex gap-6 border-b border-slate-200">
        {(['overview', 'jobs', 'invoices'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`-mb-px border-b-2 px-1 py-3 text-sm font-medium capitalize ${
              tab === t
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="Contact">
            <Stack>
              {c.phones.length === 0 ? (
                <p className="text-sm text-slate-500">No phones on file.</p>
              ) : (
                c.phones.map((p) => (
                  <p key={p.id} className="text-sm text-slate-700">
                    <span className="font-medium">{p.value}</span>
                    {p.type && <span className="ml-2 text-xs text-slate-500">{p.type}</span>}
                    {p.note && <span className="ml-2 text-xs text-slate-500">· {p.note}</span>}
                  </p>
                ))
              )}
              {c.emails.length === 0 ? (
                <p className="text-sm text-slate-500">No emails on file.</p>
              ) : (
                c.emails.map((e) => (
                  <p key={e.id} className="text-sm text-slate-700">
                    {e.value}
                  </p>
                ))
              )}
            </Stack>
          </Card>

          <Card title="Primary address">
            {primaryAddress ? (
              <AddressLines a={primaryAddress} />
            ) : (
              <p className="text-sm text-slate-500">No primary address.</p>
            )}
          </Card>

          {additionalAddresses.length > 0 && (
            <Card title="Additional addresses">
              <Stack>
                {additionalAddresses.map((a) => (
                  <AddressLines key={a.id} a={a} />
                ))}
              </Stack>
            </Card>
          )}

          <Card title="Tags">
            {c.tags.length === 0 ? (
              <p className="text-sm text-slate-500">No tags.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {c.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card title="Notes">
            <NotesPanel
              notes={dedupedNotes}
              noteOps={noteOps}
              setNoteOps={setNoteOps}
              saving={saveNotesMutation.isPending}
              loading={notesQuery.isLoading}
              title=""
              emptyMessage="No notes."
            />
            {noteOps.length > 0 && (
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setNoteOps([])}
                  disabled={saveNotesMutation.isPending}
                >
                  Discard
                </Button>
                <Button
                  onClick={() => saveNotesMutation.mutate()}
                  disabled={saveNotesMutation.isPending}
                >
                  {saveNotesMutation.isPending ? 'Saving…' : 'Save notes'}
                </Button>
              </div>
            )}
          </Card>

          <Card title="Lead">
            <Stack>
              <Field label="Lead source" value={c.leadSource ?? '—'} />
              <Field label="Referred by" value={c.referredBy ?? '—'} />
              <Field label="Role" value={c.role ?? '—'} />
            </Stack>
          </Card>

          <Card title="Billing">
            <Stack>
              <Field label="Billing address" value={c.billingAddress ?? '—'} />
              <Field label="Send notifications" value={c.sendNotifications ? 'Yes' : 'No'} />
            </Stack>
          </Card>

          <Card
            title="Payment methods"
            className="lg:col-span-2"
            actions={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setOpenCardDialog('request')}>
                  Request card
                </Button>
                <Button size="sm" onClick={() => setOpenCardDialog('add')}>
                  Add card
                </Button>
              </div>
            }
          >
            {cardActionError && (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {cardActionError}
              </div>
            )}

            {cardsQuery.isLoading ? (
              <p className="text-sm text-slate-500">Loading cards…</p>
            ) : cardsQuery.error ? (
              <p className="text-sm text-red-700">
                {cardsQuery.error instanceof ApiClientError &&
                cardsQuery.error.code === 'INTEGRATION_DISABLED'
                  ? 'Stripe integration is disabled. Enable it in Settings → Integrations.'
                  : 'Could not load saved cards.'}
              </p>
            ) : paymentMethods.length === 0 ? (
              <p className="text-sm text-slate-500">No saved cards.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {paymentMethods.map((pm) => (
                  <li key={pm.id} className="flex flex-wrap items-center gap-3 py-2">
                    <div className="text-sm text-slate-700">
                      <span className="font-medium capitalize">{pm.brand ?? 'Card'}</span>
                      <span className="ml-1">•••• {pm.last4 ?? '----'}</span>
                      {pm.expMonth && pm.expYear && (
                        <span className="ml-2 text-xs text-slate-500">
                          exp {String(pm.expMonth).padStart(2, '0')}/
                          {String(pm.expYear).slice(-2)}
                        </span>
                      )}
                    </div>
                    {pm.isDefault && (
                      <span className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Default
                      </span>
                    )}
                    <div className="ml-auto flex gap-2">
                      {!pm.isDefault && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={setDefaultMutation.isPending}
                          onClick={() => {
                            setCardActionError(null);
                            setDefaultMutation.mutate(pm.id);
                          }}
                        >
                          Set default
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setCardActionError(null);
                          setPendingDelete(pm);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {pendingCardRequests.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Pending requests
                </h3>
                <ul className="space-y-2">
                  {pendingCardRequests.map((r) => (
                    <PendingRequestRow key={r.id} req={r} />
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      )}

      {openCardDialog === 'add' && (
        <AddCardDialog
          customerId={id}
          onClose={() => setOpenCardDialog(null)}
          onDone={() => {
            setOpenCardDialog(null);
            queryClient.invalidateQueries({ queryKey: ['customer-cards', id] });
          }}
        />
      )}

      {openCardDialog === 'request' && (
        <RequestCardDialog
          customerId={id}
          onClose={() => setOpenCardDialog(null)}
          onDone={() =>
            queryClient.invalidateQueries({ queryKey: ['customer-card-requests', id] })
          }
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Remove card?"
          message={`Remove the card ending in ${pendingDelete.last4 ?? '----'}? It will no longer be available for charges.`}
          confirmLabel="Remove"
          danger
          mutationFn={() => cardsApi.deletePaymentMethod(id, pendingDelete.id)}
          onClose={() => setPendingDelete(null)}
          onDone={() => {
            setPendingDelete(null);
            queryClient.invalidateQueries({ queryKey: ['customer-cards', id] });
          }}
          onError={(msg) => {
            setPendingDelete(null);
            setCardActionError(msg);
          }}
        />
      )}

      {tab === 'jobs' && (
        <div className="mt-6">
          <JobsList customerId={id} hideHeader emptyMessage="No jobs yet for this customer." />
        </div>
      )}

      {tab === 'invoices' && (
        <div className="mt-6">
          <InvoicesList
            customerId={id}
            hideHeader
            emptyMessage="No invoices yet for this customer."
          />
        </div>
      )}
    </div>
  );
}

function Card({
  title,
  children,
  actions,
  className,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${className ?? ''}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1">{children}</div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm text-slate-700">
      <span className="text-slate-500">{label}:</span> {value}
    </p>
  );
}

function PendingRequestRow({ req }: { req: CustomerCardRequestDto }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(req.publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <li className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={req.publicUrl}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-800"
      />
      <Button size="sm" variant="secondary" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <span className="text-xs text-slate-500">
        expires {new Date(req.expiresAt).toLocaleDateString()}
      </span>
    </li>
  );
}

function AddressLines({
  a,
}: {
  a: {
    street: string | null;
    unit: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    notes: string | null;
  };
}) {
  const line1 = [a.street, a.unit].filter(Boolean).join(', ');
  const line2 = [a.city, a.state, a.zip].filter(Boolean).join(' ');
  return (
    <div className="text-sm text-slate-700">
      {line1 && <p>{line1}</p>}
      {line2 && <p>{line2}</p>}
      {a.notes && <p className="text-xs text-slate-500">{a.notes}</p>}
      {!line1 && !line2 && <p className="text-sm text-slate-500">No address details.</p>}
    </div>
  );
}
