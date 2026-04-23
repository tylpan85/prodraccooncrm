'use client';

import type { InvoiceDto, PaymentMethodDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { DetailSkeleton } from '../../../../components/ui/skeleton';
import { ChargeSavedCardDialog } from '../../../../components/invoice-action-dialogs';
import { ApiClientError } from '../../../../lib/api-client';
import { customersApi } from '../../../../lib/customers-api';
import { invoicesApi } from '../../../../lib/invoices-api';
import { settingsApi } from '../../../../lib/settings-api';

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'INTEGRATION_DISABLED') {
      return 'RingCentral integration is disabled. Enable it in Settings → Integrations.';
    }
    if (error.code === 'INTEGRATION_NOT_CONFIGURED') {
      return 'RingCentral is missing required configuration. Check Settings → Integrations.';
    }
    if (error.code === 'INVOICE_NOT_PAYABLE') {
      return 'This invoice cannot be marked paid in its current state.';
    }
    if (error.code === 'INVOICE_NOT_PAID_CANNOT_REOPEN') {
      return 'Only paid invoices can be reopened.';
    }
    if (error.code === 'INVOICE_ALREADY_PAID') {
      return 'This invoice is already paid.';
    }
    if (error.code === 'PAYMENT_METHOD_INACTIVE') {
      return 'That payment method is no longer active.';
    }
    return error.message;
  }
  return 'Action failed.';
}

type Dialog =
  | { kind: 'sms' }
  | { kind: 'mark-paid' }
  | { kind: 'charge-card' }
  | { kind: 'receipt' }
  | { kind: 'reopen' }
  | { kind: 'void' }
  | null;

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const id = params.id;
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const invoiceQuery = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoicesApi.get(id),
    retry: false,
  });

  const inv = invoiceQuery.data;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
  }

  function closeDialog() {
    setDialog(null);
  }

  if (invoiceQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (invoiceQuery.error || !inv) {
    return <div className="px-6 py-8 text-sm text-slate-700">Could not load invoice.</div>;
  }

  const isDraft = inv.status === 'draft';
  const isSentLike = inv.status === 'sent' || inv.status === 'past_due';
  const isPaid = inv.status === 'paid';
  const isVoid = inv.status === 'void';
  const locked = inv.lockedAt !== null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
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
          {inv.lastSentAt && (
            <p className="mt-1 text-xs text-slate-500">
              Last sent via {inv.lastSentVia ?? 'unknown'} on {formatDateTime(inv.lastSentAt)}
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

      {/* Toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={invoicesApi.pdfUrl(inv.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Download PDF
        </a>
        <CopyPayLinkButton token={inv.publicToken} onCopied={() => setInfo('Pay link copied.')} />
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}
      {info && (
        <div className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {info}
        </div>
      )}

      {inv.status === 'past_due' && (
        <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This invoice is past due (due {inv.dueDate}).
        </div>
      )}
      {locked && (
        <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          This invoice is locked (paid via Stripe). Editing and reopening are disabled.
        </div>
      )}

      {/* Body */}
      <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_320px]">
        {/* Line items + payments */}
        <div className="space-y-6">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-medium text-slate-500">
              {inv.lineItems.length > 0 ? 'Line Items' : 'Line Item'}
            </h2>
            <div className="mt-3 space-y-2 text-sm">
              {inv.lineItems.length > 0 ? (
                inv.lineItems.map((li) => (
                  <div key={li.id} className="flex justify-between">
                    <span className="text-slate-600">{li.description}</span>
                    <span className="text-slate-900">{formatCents(li.priceCents)}</span>
                  </div>
                ))
              ) : (
                <>
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
                </>
              )}
            </div>
            <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Subtotal</span>
                <span>{formatCents(inv.subtotalCents)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span className="text-slate-700">Total</span>
                <span className="text-slate-900">{formatCents(inv.totalCents)}</span>
              </div>
              {inv.paidCents > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Paid</span>
                  <span>{formatCents(inv.paidCents)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium">
                <span className="text-slate-700">Amount Due</span>
                <span className="text-slate-900">{formatCents(inv.amountDueCents)}</span>
              </div>
            </div>
          </div>

          <PaymentsList payments={inv.payments} />
        </div>

        {/* Sidebar: details + actions */}
        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">
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

          <div className="flex flex-wrap gap-2">
            {(isDraft || isSentLike) && (
              <Button onClick={() => { setError(null); setDialog({ kind: 'sms' }); }}>
                Send SMS
              </Button>
            )}
            {(isDraft || isSentLike) && (
              <Button onClick={() => { setError(null); setDialog({ kind: 'mark-paid' }); }}>
                Mark paid
              </Button>
            )}
            {(isDraft || isSentLike) && inv.amountDueCents > 0 && (
              <Button onClick={() => { setError(null); setDialog({ kind: 'charge-card' }); }}>
                Charge saved card
              </Button>
            )}
            {isPaid && !locked && (
              <Button
                variant="secondary"
                onClick={() => { setError(null); setDialog({ kind: 'reopen' }); }}
              >
                Reopen
              </Button>
            )}
            {isPaid && (
              <Button
                variant="secondary"
                onClick={() => { setError(null); setDialog({ kind: 'receipt' }); }}
              >
                Send receipt
              </Button>
            )}
            {!isPaid && !isVoid && (
              <Button
                variant="secondary"
                onClick={() => { setError(null); setDialog({ kind: 'void' }); }}
              >
                Void
              </Button>
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

      {dialog?.kind === 'sms' && (
        <SmsDialog
          invoice={inv}
          onClose={closeDialog}
          onDone={() => { setInfo('SMS sent.'); closeDialog(); refresh(); }}
          onError={(msg) => setError(msg)}
        />
      )}
      {dialog?.kind === 'mark-paid' && (
        <MarkPaidDialog
          invoice={inv}
          onClose={closeDialog}
          onDone={() => { setInfo('Marked paid.'); closeDialog(); refresh(); }}
          onError={(msg) => setError(msg)}
        />
      )}
      {dialog?.kind === 'charge-card' && (
        <ChargeSavedCardDialog
          invoice={inv}
          onClose={closeDialog}
          onDone={() => { setInfo('Charge initiated.'); closeDialog(); refresh(); }}
          onError={(msg) => setError(msg)}
        />
      )}
      {dialog?.kind === 'receipt' && (
        <ReceiptDialog
          invoice={inv}
          onClose={closeDialog}
          onDone={() => { setInfo('Receipt sent.'); closeDialog(); refresh(); }}
          onError={(msg) => setError(msg)}
        />
      )}
      {dialog?.kind === 'reopen' && (
        <ConfirmDialog
          title="Reopen invoice?"
          message="This will delete all recorded payments and return the invoice to its previous sent/draft state."
          confirmLabel="Reopen"
          mutationFn={() => invoicesApi.reopen(id)}
          onClose={closeDialog}
          onDone={() => { setInfo('Invoice reopened.'); closeDialog(); refresh(); }}
          onError={(msg) => setError(msg)}
        />
      )}
      {dialog?.kind === 'void' && (
        <ConfirmDialog
          title="Void invoice?"
          message="Voided invoices cannot be edited or marked paid."
          confirmLabel="Void"
          danger
          mutationFn={() => invoicesApi.void(id)}
          onClose={closeDialog}
          onDone={() => { setInfo('Invoice voided.'); closeDialog(); refresh(); }}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function CopyPayLinkButton({ token, onCopied }: { token: string; onCopied: () => void }) {
  const [copying, setCopying] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      disabled={copying}
      onClick={async () => {
        setCopying(true);
        try {
          await navigator.clipboard.writeText(invoicesApi.publicPayUrl(token));
          onCopied();
        } finally {
          setCopying(false);
        }
      }}
    >
      Copy pay link
    </button>
  );
}

function PaymentsList({ payments }: { payments: InvoiceDto['payments'] }) {
  if (payments.length === 0) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-medium text-slate-500">Payments</h2>
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {payments.map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2">
            <div>
              <div className="font-medium text-slate-900">
                {p.paymentMethodName}
                <span
                  className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    p.source === 'stripe'
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {p.source}
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {formatDateTime(p.paidAt)}
                {p.reference ? ` · ${p.reference}` : ''}
              </div>
            </div>
            <div className="font-medium text-slate-900">{formatCents(p.amountCents)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function SmsDialog({
  invoice,
  onClose,
  onDone,
  onError,
}: {
  invoice: InvoiceDto;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const customerQuery = useQuery({
    queryKey: ['customer', invoice.customerId],
    queryFn: () => customersApi.get(invoice.customerId),
  });
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (!customerQuery.data || phone) return;
    const first = customerQuery.data.phones[0]?.value;
    if (first) setPhone(first);
  }, [customerQuery.data, phone]);

  const mutation = useMutation({
    mutationFn: () => invoicesApi.sendSms(invoice.id, { toPhone: phone.trim() }),
    onSuccess: onDone,
    onError: (err) => onError(actionErrorMessage(err)),
  });

  return (
    <DialogShell title="Send invoice SMS" onClose={onClose}>
      <p className="text-sm text-slate-600">
        Texts a pay link to the recipient. Uses the RingCentral integration configured in Settings.
      </p>
      <div className="mt-4">
        <Label htmlFor="sms-to">To phone</Label>
        <Input
          id="sms-to"
          type="tel"
          className="mt-1"
          placeholder="+15551234567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={mutation.isPending}
        />
        {customerQuery.data && customerQuery.data.phones.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">
            This customer has no phone on file — enter one above.
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || phone.trim().length < 7}
        >
          {mutation.isPending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </DialogShell>
  );
}

function MarkPaidDialog({
  invoice,
  onClose,
  onDone,
  onError,
}: {
  invoice: InvoiceDto;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const methodsQuery = useQuery({
    queryKey: ['payment-methods', 'manual'],
    queryFn: () => settingsApi.listPaymentMethods(false).then((r) => r.items),
  });

  const manualMethods = useMemo<PaymentMethodDto[]>(
    () => (methodsQuery.data ?? []).filter((m) => m.source !== 'stripe' && m.active),
    [methodsQuery.data],
  );

  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState('');

  useEffect(() => {
    if (!methodId && manualMethods.length > 0) {
      setMethodId(manualMethods[0]!.id);
    }
  }, [manualMethods, methodId]);

  const selected = manualMethods.find((m) => m.id === methodId);
  const referenceRequired = Boolean(selected?.referenceLabel);

  const mutation = useMutation({
    mutationFn: () =>
      invoicesApi.markPaid(invoice.id, {
        paymentMethodId: methodId,
        reference: reference.trim() === '' ? undefined : reference.trim(),
        paidAt: paidAt === '' ? undefined : new Date(paidAt).toISOString(),
      }),
    onSuccess: onDone,
    onError: (err) => onError(actionErrorMessage(err)),
  });

  const canSubmit =
    methodId !== '' && (!referenceRequired || reference.trim() !== '') && !mutation.isPending;

  return (
    <DialogShell title="Mark invoice paid" onClose={onClose}>
      <p className="text-sm text-slate-600">
        Records a manual payment for {formatCents(invoice.amountDueCents)}.
      </p>
      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor="pm-method">Payment method</Label>
          <select
            id="pm-method"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100"
            value={methodId}
            onChange={(e) => setMethodId(e.target.value)}
            disabled={methodsQuery.isLoading || mutation.isPending}
          >
            {methodsQuery.isLoading && <option value="">Loading…</option>}
            {!methodsQuery.isLoading && manualMethods.length === 0 && (
              <option value="">No active manual payment methods</option>
            )}
            {manualMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {!methodsQuery.isLoading && manualMethods.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">
              Add a payment method in Settings → Payment Methods.
            </p>
          )}
        </div>

        {selected && (
          <div>
            <Label htmlFor="pm-ref">
              {selected.referenceLabel ?? 'Reference'}{' '}
              {!referenceRequired && <span className="text-slate-400">(optional)</span>}
            </Label>
            <Input
              id="pm-ref"
              className="mt-1"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              disabled={mutation.isPending}
              placeholder={selected.referenceLabel ?? ''}
            />
          </div>
        )}

        <div>
          <Label htmlFor="pm-paidAt">Paid at <span className="text-slate-400">(optional)</span></Label>
          <Input
            id="pm-paidAt"
            type="datetime-local"
            className="mt-1"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            disabled={mutation.isPending}
          />
          <p className="mt-1 text-xs text-slate-500">Leave blank to use now.</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
          {mutation.isPending ? 'Saving…' : 'Mark paid'}
        </Button>
      </div>
    </DialogShell>
  );
}

function ReceiptDialog({
  invoice,
  onClose,
  onDone,
  onError,
}: {
  invoice: InvoiceDto;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const customerQuery = useQuery({
    queryKey: ['customer', invoice.customerId],
    queryFn: () => customersApi.get(invoice.customerId),
  });
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!customerQuery.data || email) return;
    const first = customerQuery.data.emails[0]?.value;
    if (first) setEmail(first);
  }, [customerQuery.data, email]);

  const mutation = useMutation({
    mutationFn: () => invoicesApi.sendReceipt(invoice.id, { toEmail: email.trim() }),
    onSuccess: onDone,
    onError: (err) => onError(actionErrorMessage(err)),
  });

  return (
    <DialogShell title="Send receipt email" onClose={onClose}>
      <p className="text-sm text-slate-600">Emails the receipt PDF to the recipient.</p>
      <div className="mt-4">
        <Label htmlFor="receipt-to">To email</Label>
        <Input
          id="receipt-to"
          type="email"
          className="mt-1"
          placeholder="customer@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={mutation.isPending}
        />
        {customerQuery.data && customerQuery.data.emails.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">
            This customer has no email on file — enter one above.
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || email.trim() === ''}
        >
          {mutation.isPending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </DialogShell>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  mutationFn,
  onClose,
  onDone,
  onError,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  mutationFn: () => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const mutation = useMutation({
    mutationFn,
    onSuccess: onDone,
    onError: (err) => onError(actionErrorMessage(err)),
  });

  return (
    <DialogShell title={title} onClose={onClose}>
      <p className="text-sm text-slate-600">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </DialogShell>
  );
}
