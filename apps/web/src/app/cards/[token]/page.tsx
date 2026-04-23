'use client';

import type {
  ErrorEnvelope,
  ItemEnvelope,
  PublicCardRequestDto,
  PublicCardSetupIntentResponse,
} from '@openclaw/shared';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { type Stripe, loadStripe } from '@stripe/stripe-js';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/button';

const API_PORT = 4000;

function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') return '';
  return `http://localhost:${API_PORT}`;
}

class PublicApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const env = json as ErrorEnvelope | null;
    throw new PublicApiError(
      res.status,
      env?.error?.code ?? 'UNKNOWN',
      env?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return json as T;
}

function fetchCardRequest(token: string): Promise<PublicCardRequestDto> {
  return publicFetch<ItemEnvelope<PublicCardRequestDto>>(
    `/api/public/card-requests/${token}`,
  ).then((env) => env.item);
}

function createPublicSetupIntent(token: string): Promise<PublicCardSetupIntentResponse> {
  return publicFetch<ItemEnvelope<PublicCardSetupIntentResponse>>(
    `/api/public/card-requests/${token}/setup-intent`,
    { method: 'POST' },
  ).then((env) => env.item);
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

function setupErrorMessage(err: unknown): string {
  if (err instanceof PublicApiError) {
    if (err.code === 'CARD_REQUEST_EXPIRED') return 'This link has expired. Please ask for a new one.';
    if (err.code === 'CARD_REQUEST_ALREADY_COMPLETED') return 'A card has already been saved using this link.';
    if (err.code === 'CARD_REQUEST_NOT_FOUND') return 'This link is no longer valid.';
    if (err.code === 'INTEGRATION_DISABLED' || err.code === 'INTEGRATION_NOT_CONFIGURED')
      return 'Card capture is temporarily unavailable. Please contact us.';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

export default function PublicCardRequestPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const [submitted, setSubmitted] = useState(false);

  const requestQuery = useQuery({
    queryKey: ['public-card-request', token],
    queryFn: () => fetchCardRequest(token),
    enabled: token.length > 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const intentQuery = useQuery({
    queryKey: ['public-card-setup-intent', token],
    queryFn: () => createPublicSetupIntent(token),
    enabled:
      token.length > 0 &&
      !submitted &&
      requestQuery.data?.status === 'pending' &&
      new Date(requestQuery.data.expiresAt).getTime() > Date.now(),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    retry: false,
  });

  const stripePromise = useMemo(
    () => (intentQuery.data ? getStripe(intentQuery.data.publishableKey) : null),
    [intentQuery.data],
  );

  if (requestQuery.isLoading) {
    return (
      <Shell>
        <p className="text-center text-sm text-slate-500">Loading…</p>
      </Shell>
    );
  }

  if (requestQuery.isError) {
    const err = requestQuery.error;
    const notFound = err instanceof PublicApiError && err.status === 404;
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-slate-900">
          {notFound ? 'Link not found' : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {notFound
            ? 'This card link is no longer valid. Please contact us for a new one.'
            : 'We could not load this page. Please try refreshing.'}
        </p>
      </Shell>
    );
  }

  const cr = requestQuery.data;
  if (!cr) return null;

  const expired =
    cr.status === 'expired' || new Date(cr.expiresAt).getTime() <= Date.now();
  const completed = cr.status === 'completed';

  return (
    <Shell company={cr}>
      {submitted ? (
        <SuccessPanel />
      ) : completed ? (
        <Banner kind="success">
          A card has already been saved using this link. You can close this page.
        </Banner>
      ) : expired ? (
        <Banner kind="error">
          This link has expired. Please ask {cr.companyName} for a new one.
        </Banner>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {cr.customerDisplayName ? `Hi ${cr.customerDisplayName} — ` : ''}
            enter your card details below to save them on file with{' '}
            <span className="font-medium text-slate-900">{cr.companyName}</span>. Your card
            information is sent directly to Stripe and never touches our servers.
          </p>

          {intentQuery.isLoading && (
            <p className="mt-4 text-sm text-slate-500">Loading secure card form…</p>
          )}

          {intentQuery.isError && (
            <Banner kind="error" className="mt-4">
              {setupErrorMessage(intentQuery.error)}
            </Banner>
          )}

          {intentQuery.data && stripePromise && (
            <Elements
              stripe={stripePromise}
              options={{ clientSecret: intentQuery.data.clientSecret }}
            >
              <SetupForm onSuccess={() => setSubmitted(true)} />
            </Elements>
          )}

          <p className="mt-6 text-center text-xs text-slate-400">
            Link expires {new Date(cr.expiresAt).toLocaleDateString()}
          </p>
        </>
      )}
    </Shell>
  );
}

function SetupForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = useMutation({
    mutationFn: async () => {
      if (!stripe || !elements) throw new Error('Card form is not ready yet.');
      const { error: confirmError } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (confirmError) {
        throw new Error(confirmError.message ?? 'Card could not be saved.');
      }
    },
    onSuccess,
    onError: (err) => setError(err instanceof Error ? err.message : 'Card could not be saved.'),
  });

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await confirm.mutateAsync();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4">
      <PaymentElement />
      {error && (
        <Banner kind="error" className="mt-3">
          {error}
        </Banner>
      )}
      <div className="mt-5 flex justify-end">
        <Button onClick={handleSubmit} disabled={!stripe || !elements || submitting}>
          {submitting ? 'Saving…' : 'Save card'}
        </Button>
      </div>
    </div>
  );
}

function SuccessPanel() {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        ✓
      </div>
      <h2 className="mt-3 text-lg font-semibold text-slate-900">Card saved</h2>
      <p className="mt-1 text-sm text-slate-600">
        Thanks! Your card is now on file. You can close this page.
      </p>
    </div>
  );
}

function Banner({
  kind,
  className,
  children,
}: {
  kind: 'success' | 'error';
  className?: string;
  children: React.ReactNode;
}) {
  const styles =
    kind === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-700';
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${styles} ${className ?? ''}`}>
      {children}
    </div>
  );
}

function Shell({
  company,
  children,
}: {
  company?: PublicCardRequestDto;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-lg px-4 py-10">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {company && (
            <header className="border-b border-slate-200 px-6 py-5">
              <div className="text-base font-semibold text-slate-900">{company.companyName}</div>
              <div className="mt-1 text-xs text-slate-500">
                {company.companyPhone && <span>{company.companyPhone}</span>}
                {company.companyPhone && company.companyWebsite && (
                  <span className="px-2 text-slate-400">•</span>
                )}
                {company.companyWebsite && (
                  <a
                    href={company.companyWebsite}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-700 hover:underline"
                  >
                    {company.companyWebsite}
                  </a>
                )}
              </div>
            </header>
          )}
          <div className="px-6 py-6">{children}</div>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">Powered by Raccoon CRM</p>
      </div>
    </main>
  );
}
