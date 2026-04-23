'use client';

import type { ErrorEnvelope, ItemEnvelope, PublicInvoiceDto } from '@openclaw/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
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

function fetchInvoice(token: string): Promise<PublicInvoiceDto> {
  return publicFetch<ItemEnvelope<PublicInvoiceDto>>(`/api/public/invoices/${token}`).then(
    (env) => env.item,
  );
}

function startStripeCheckout(token: string): Promise<{ url: string }> {
  return publicFetch<{ url: string }>(`/api/public/invoices/${token}/stripe-checkout`, {
    method: 'POST',
  });
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(status: string): { text: string; className: string } {
  switch (status) {
    case 'paid':
      return { text: 'Paid', className: 'bg-emerald-100 text-emerald-800' };
    case 'past_due':
      return { text: 'Past due', className: 'bg-amber-100 text-amber-800' };
    case 'sent':
      return { text: 'Sent', className: 'bg-blue-100 text-blue-800' };
    case 'draft':
      return { text: 'Draft', className: 'bg-slate-100 text-slate-700' };
    case 'void':
      return { text: 'Void', className: 'bg-red-100 text-red-800' };
    default:
      return { text: status, className: 'bg-slate-100 text-slate-700' };
  }
}

function checkoutErrorMessage(err: unknown): string {
  if (err instanceof PublicApiError) {
    if (err.code === 'INTEGRATION_DISABLED') return 'Online card payments are not available right now.';
    if (err.code === 'INTEGRATION_NOT_CONFIGURED')
      return 'Card payments are temporarily unavailable. Please contact us.';
    if (err.code === 'INVOICE_ALREADY_PAID') return 'This invoice is already paid.';
    return err.message;
  }
  return 'Could not start the payment session. Please try again.';
}

export default function PublicPayPage() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const token = params?.token ?? '';
  const showPaidSuccess = searchParams?.get('paid') === '1';

  const invoiceQuery = useQuery({
    queryKey: ['public-invoice', token],
    queryFn: () => fetchInvoice(token),
    enabled: token.length > 0,
    refetchInterval: showPaidSuccess ? 3000 : false,
    refetchOnWindowFocus: true,
  });

  const checkoutMutation = useMutation({
    mutationFn: () => startStripeCheckout(token),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
  });

  if (invoiceQuery.isLoading) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-slate-500">
          Loading invoice…
        </div>
      </main>
    );
  }

  if (invoiceQuery.isError) {
    const err = invoiceQuery.error;
    const notFound = err instanceof PublicApiError && err.status === 404;
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
            <h1 className="text-lg font-semibold text-slate-900">
              {notFound ? 'Invoice not found' : 'Something went wrong'}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {notFound
                ? 'This pay link is no longer valid. Please contact us for an updated link.'
                : 'We could not load this invoice. Please try refreshing the page.'}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const invoice = invoiceQuery.data;
  if (!invoice) return null;

  const status = statusLabel(invoice.status);
  const isPaid = invoice.status === 'paid';
  const isVoid = invoice.status === 'void';
  const canPayWithCard = invoice.stripeEnabled && !isPaid && !isVoid && invoice.amountDueCents > 0;
  const pdfHref = `${getApiBase()}/api/public/invoices/${token}/pdf`;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="border-b border-slate-200 px-8 py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-slate-900">{invoice.companyName}</div>
                {invoice.companyAddress && (
                  <div className="mt-1 whitespace-pre-line text-sm text-slate-600">
                    {invoice.companyAddress}
                  </div>
                )}
                <div className="mt-1 text-sm text-slate-600">
                  {invoice.companyPhone && <span>{invoice.companyPhone}</span>}
                  {invoice.companyPhone && invoice.companyWebsite && (
                    <span className="px-2 text-slate-400">•</span>
                  )}
                  {invoice.companyWebsite && (
                    <a
                      href={invoice.companyWebsite}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 hover:underline"
                    >
                      {invoice.companyWebsite}
                    </a>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-slate-500">Invoice</div>
                <div className="text-base font-semibold text-slate-900">{invoice.invoiceNumber}</div>
                <span
                  className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
                >
                  {status.text}
                </span>
              </div>
            </div>
          </header>

          {showPaidSuccess && isPaid && (
            <div className="border-b border-emerald-200 bg-emerald-50 px-8 py-3 text-sm text-emerald-800">
              Payment received. Thank you!
            </div>
          )}
          {showPaidSuccess && !isPaid && (
            <div className="border-b border-blue-200 bg-blue-50 px-8 py-3 text-sm text-blue-800">
              Your payment is processing. This page will update shortly.
            </div>
          )}
          {!showPaidSuccess && isPaid && (
            <div className="border-b border-emerald-200 bg-emerald-50 px-8 py-3 text-sm text-emerald-800">
              This invoice was paid in full on {formatDate(invoice.paidAt)}.
            </div>
          )}
          {invoice.status === 'past_due' && (
            <div className="border-b border-amber-200 bg-amber-50 px-8 py-3 text-sm text-amber-800">
              This invoice is past due. Please pay as soon as possible.
            </div>
          )}
          {isVoid && (
            <div className="border-b border-red-200 bg-red-50 px-8 py-3 text-sm text-red-800">
              This invoice has been voided.
            </div>
          )}

          <section className="px-8 py-6">
            <div className="grid grid-cols-1 gap-6 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Bill to</div>
                <div className="mt-1 text-slate-900">{invoice.customerDisplayName ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Issued</div>
                <div className="mt-1 text-slate-900">{formatDate(invoice.createdAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Due</div>
                <div className="mt-1 text-slate-900">{formatDate(invoice.dueDate)}</div>
              </div>
            </div>
          </section>

          <section className="px-8 pb-6">
            {invoice.serviceNameSnapshot && (
              <div className="mb-3 text-xs uppercase tracking-wide text-slate-500">
                {invoice.serviceNameSnapshot}
              </div>
            )}
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Description</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {invoice.lineItems.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-4 py-3 text-center text-slate-500">
                        No line items.
                      </td>
                    </tr>
                  )}
                  {invoice.lineItems.map((li) => (
                    <tr key={li.id}>
                      <td className="px-4 py-2 text-slate-900">{li.description}</td>
                      <td className="px-4 py-2 text-right text-slate-900">
                        {formatCents(li.priceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <dl className="w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between text-slate-600">
                  <dt>Total</dt>
                  <dd>{formatCents(invoice.totalCents)}</dd>
                </div>
                {invoice.paidCents > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <dt>Paid</dt>
                    <dd>−{formatCents(invoice.paidCents)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
                  <dt>Amount due</dt>
                  <dd>{formatCents(invoice.amountDueCents)}</dd>
                </div>
              </dl>
            </div>
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-8 py-5">
            <a
              href={pdfHref}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              Download PDF
            </a>
            {canPayWithCard ? (
              <div className="flex flex-col items-end gap-1">
                <Button
                  onClick={() => checkoutMutation.mutate()}
                  disabled={checkoutMutation.isPending}
                >
                  {checkoutMutation.isPending
                    ? 'Redirecting…'
                    : `Pay ${formatCents(invoice.amountDueCents)} with card`}
                </Button>
                {checkoutMutation.isError && (
                  <p className="text-xs text-red-700">
                    {checkoutErrorMessage(checkoutMutation.error)}
                  </p>
                )}
              </div>
            ) : (
              !isPaid &&
              !isVoid && (
                <p className="text-xs text-slate-500">
                  Online card payments are not enabled for this invoice.
                </p>
              )
            )}
          </footer>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Powered by Raccoon CRM
        </p>
      </div>
    </main>
  );
}
