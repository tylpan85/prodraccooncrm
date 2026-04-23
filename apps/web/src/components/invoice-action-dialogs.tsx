'use client';

import type { InvoiceDto, PaymentMethodDto } from '@openclaw/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ApiClientError } from '../lib/api-client';
import { cardsApi } from '../lib/cards-api';
import { customersApi } from '../lib/customers-api';
import { invoicesApi } from '../lib/invoices-api';
import { settingsApi } from '../lib/settings-api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function actionErrorMessage(error: unknown): string {
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
    if (error.code === 'CARD_NOT_FOUND') {
      return 'That card was not found.';
    }
    if (error.code === 'STRIPE_HTTP_ERROR' || error.code === 'STRIPE_API_ERROR') {
      return 'Stripe rejected the charge. Please try again or use a different card.';
    }
    return error.message;
  }
  return 'Action failed.';
}

export function DialogShell({
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

export function SmsDialog({
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

export function MarkPaidDialog({
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
          <Label htmlFor="pm-paidAt">
            Paid at <span className="text-slate-400">(optional)</span>
          </Label>
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

export function ReceiptDialog({
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

export function ChargeSavedCardDialog({
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
  const cardsQuery = useQuery({
    queryKey: ['customer-payment-methods', invoice.customerId],
    queryFn: () => cardsApi.listPaymentMethods(invoice.customerId),
  });
  const cards = useMemo(() => cardsQuery.data?.items ?? [], [cardsQuery.data]);

  const [pmId, setPmId] = useState('');

  useEffect(() => {
    if (pmId || cards.length === 0) return;
    const def = cards.find((c) => c.isDefault) ?? cards[0]!;
    setPmId(def.id);
  }, [cards, pmId]);

  const mutation = useMutation({
    mutationFn: () => invoicesApi.chargeSavedCard(invoice.id, { paymentMethodId: pmId }),
    onSuccess: onDone,
    onError: (err) => onError(actionErrorMessage(err)),
  });

  const noCards = !cardsQuery.isLoading && cards.length === 0;

  return (
    <DialogShell title="Charge saved card" onClose={onClose}>
      <p className="text-sm text-slate-600">
        Charges {formatCents(invoice.amountDueCents)} to a card on file via Stripe.
      </p>

      {cardsQuery.isLoading && (
        <p className="mt-4 text-sm text-slate-500">Loading saved cards…</p>
      )}

      {cardsQuery.error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionErrorMessage(cardsQuery.error)}
        </div>
      )}

      {noCards && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This customer has no saved cards. Add one from their profile first.
        </div>
      )}

      {cards.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200">
          {cards.map((c) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                <input
                  type="radio"
                  name="charge-pm"
                  className="text-brand-600"
                  checked={pmId === c.id}
                  onChange={() => setPmId(c.id)}
                  disabled={mutation.isPending}
                />
                <span className="flex-1 text-sm text-slate-800">
                  <span className="font-medium capitalize">{c.brand ?? 'Card'}</span>
                  <span className="ml-1">•••• {c.last4 ?? '----'}</span>
                  {c.expMonth && c.expYear && (
                    <span className="ml-2 text-xs text-slate-500">
                      {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                    </span>
                  )}
                  {c.isDefault && (
                    <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Default
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || pmId === '' || noCards}
        >
          {mutation.isPending ? 'Charging…' : `Charge ${formatCents(invoice.amountDueCents)}`}
        </Button>
      </div>
    </DialogShell>
  );
}

export function ConfirmDialog({
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
