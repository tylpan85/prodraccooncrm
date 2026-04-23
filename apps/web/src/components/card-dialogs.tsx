'use client';

import type { CustomerCardRequestDto } from '@openclaw/shared';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { type Stripe, loadStripe } from '@stripe/stripe-js';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ApiClientError } from '../lib/api-client';
import { cardsApi } from '../lib/cards-api';
import { Button } from './ui/button';
import { DialogShell } from './invoice-action-dialogs';

function cardErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'INTEGRATION_DISABLED') {
      return 'Stripe integration is disabled. Enable it in Settings → Integrations.';
    }
    if (error.code === 'INTEGRATION_NOT_CONFIGURED') {
      return 'Stripe is missing required configuration. Check Settings → Integrations.';
    }
    if (error.code === 'CARD_NOT_FOUND') {
      return 'That card was not found.';
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

const stripeCache = new Map<string, Promise<Stripe | null>>();
function getStripe(publishableKey: string): Promise<Stripe | null> {
  let p = stripeCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripeCache.set(publishableKey, p);
  }
  return p;
}

export function AddCardDialog({
  customerId,
  onClose,
  onDone,
}: {
  customerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const intentQuery = useQuery({
    queryKey: ['card-setup-intent', customerId],
    queryFn: () => cardsApi.createSetupIntent(customerId),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: false,
  });

  const stripePromise = useMemo(
    () => (intentQuery.data ? getStripe(intentQuery.data.publishableKey) : null),
    [intentQuery.data],
  );

  return (
    <DialogShell title="Add card" onClose={onClose}>
      <p className="text-sm text-slate-600">
        Enter the customer's card details. The card is saved on file via Stripe — you can charge it
        later against any invoice.
      </p>

      {intentQuery.isLoading && (
        <p className="mt-4 text-sm text-slate-500">Loading secure card form…</p>
      )}

      {intentQuery.error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {cardErrorMessage(intentQuery.error)}
        </div>
      )}

      {intentQuery.data && stripePromise && (
        <Elements
          stripe={stripePromise}
          options={{ clientSecret: intentQuery.data.clientSecret }}
        >
          <AddCardForm onClose={onClose} onDone={onDone} />
        </Elements>
      )}

      {!intentQuery.data && !intentQuery.isLoading && (
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </DialogShell>
  );
}

function AddCardForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: confirmError } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (confirmError) {
        setError(confirmError.message ?? 'Card could not be saved.');
        setSubmitting(false);
        return;
      }
      onDone();
    } catch (err) {
      setError(cardErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4">
      <PaymentElement />
      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!stripe || !elements || submitting}>
          {submitting ? 'Saving…' : 'Save card'}
        </Button>
      </div>
    </div>
  );
}

export function RequestCardDialog({
  customerId,
  onClose,
  onDone,
}: {
  customerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [created, setCreated] = useState<CustomerCardRequestDto | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => cardsApi.createCardRequest(customerId),
    onSuccess: (cr) => {
      setCreated(cr);
      onDone();
    },
  });

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <DialogShell title="Request card from client" onClose={onClose}>
      {!created && !mutation.isPending && !mutation.error && (
        <>
          <p className="text-sm text-slate-600">
            Generates a secure link the client can open to enter their card themselves. The card is
            stored on file in Stripe so you can charge it against future invoices.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => mutation.mutate()}>Generate link</Button>
          </div>
        </>
      )}

      {mutation.isPending && (
        <p className="mt-2 text-sm text-slate-500">Generating secure link…</p>
      )}

      {mutation.error && !created && (
        <>
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {cardErrorMessage(mutation.error)}
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}

      {created && (
        <>
          <p className="text-sm text-slate-600">
            Send this link to the client. It expires{' '}
            {new Date(created.expiresAt).toLocaleDateString()}.
          </p>
          <div className="mt-3 flex items-stretch gap-2">
            <input
              readOnly
              value={created.publicUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <Button variant="secondary" onClick={copyLink}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div className="mt-5 flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </>
      )}
    </DialogShell>
  );
}
