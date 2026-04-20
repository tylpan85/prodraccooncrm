'use client';

import type { CustomerDto, InvoiceSummaryDto, JobSummaryDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { DetailSkeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { customersApi } from '../../../../lib/customers-api';
import { invoicesApi } from '../../../../lib/invoices-api';
import { jobsApi } from '../../../../lib/jobs-api';

type Tab = 'overview' | 'jobs' | 'invoices';

function fmtHour(d: Date): string {
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

function formatSchedule(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const month = start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = start.getUTCDate();
  const year = start.getUTCFullYear();
  return `${month} ${day} ${year} ${fmtHour(start)}–${fmtHour(end)}`;
}

const TODAY_LINE = (
  <div className="flex items-center gap-2 px-4 py-1">
    <div className="h-px flex-1 bg-red-400" />
    <span className="whitespace-nowrap text-xs font-medium text-red-500">Today</span>
    <div className="h-px flex-1 bg-red-400" />
  </div>
);

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

  const customerJobsQuery = useQuery({
    queryKey: ['customerJobs', id],
    queryFn: () => jobsApi.listForCustomer(id),
    enabled: tab === 'jobs',
  });

  const archiveMutation = useMutation({
    mutationFn: () => customersApi.archiveCustomer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer', id] }),
  });

  const unarchiveMutation = useMutation({
    mutationFn: () => customersApi.unarchiveCustomer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer', id] }),
  });

  const customerInvoicesQuery = useQuery({
    queryKey: ['customerInvoices', id],
    queryFn: () => invoicesApi.list({ customerId: id }),
    enabled: tab === 'invoices',
  });

  const jobsTodayRef = useRef<HTMLTableRowElement>(null);
  const invTodayRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (tab === 'jobs' && jobsTodayRef.current) {
      jobsTodayRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [tab, customerJobsQuery.data]);

  useEffect(() => {
    if (tab === 'invoices' && invTodayRef.current) {
      invTodayRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [tab, customerInvoicesQuery.data]);

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
            {c.customerNotes ? (
              <p className="whitespace-pre-wrap text-sm text-slate-700">{c.customerNotes}</p>
            ) : (
              <p className="text-sm text-slate-500">No notes.</p>
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
        </div>
      )}

      {tab === 'jobs' && (
        <div className="mt-6">
          {customerJobsQuery.isLoading && (
            <p className="py-6 text-sm text-slate-500">Loading jobs…</p>
          )}
          {!customerJobsQuery.isLoading && (customerJobsQuery.data?.items ?? []).length === 0 && (
            <div className="rounded-md border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
              No jobs yet for this customer.
            </div>
          )}
          {(customerJobsQuery.data?.items ?? []).length > 0 && (() => {
            const STAGE: Record<string, { bg: string; text: string; label: string }> = {
              scheduled:         { bg: 'bg-slate-100',   text: 'text-slate-600', label: 'Scheduled' },
              confirmation_sent: { bg: 'bg-blue-100',    text: 'text-blue-700',  label: 'Conf. Sent' },
              confirmed:         { bg: 'bg-green-100',   text: 'text-green-700', label: 'Confirmed' },
              job_done:          { bg: 'bg-emerald-600', text: 'text-white',     label: 'Done' },
              cancelled:         { bg: 'bg-red-100',     text: 'text-red-700',   label: 'Cancelled' },
            };
            const sortedJobs = [...(customerJobsQuery.data?.items ?? [])].sort(
              (a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime(),
            );
            const todayMs = new Date().setHours(0, 0, 0, 0);
            const todayIdx = sortedJobs.findIndex(
              (j) => new Date(j.scheduledStartAt).getTime() >= todayMs,
            );
            return (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Job #</th>
                      <th className="px-4 py-3 font-medium">Title</th>
                      <th className="px-4 py-3 font-medium">Stage</th>
                      <th className="px-4 py-3 font-medium">Schedule</th>
                      <th className="px-4 py-3 font-medium">Assignee</th>
                      <th className="px-4 py-3 font-medium text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sortedJobs.flatMap((j: JobSummaryDto, idx: number) => {
                      const s = STAGE[j.jobStage] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: j.jobStage };
                      const row = (
                        <tr key={j.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">
                            <Link href={`/jobs/${j.id}` as Route} className="text-brand-700 hover:underline">
                              {j.jobNumber}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">{j.titleOrSummary ?? '—'}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
                              {s.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {formatSchedule(j.scheduledStartAt, j.scheduledEndAt)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">{j.assigneeDisplayName ?? '—'}</td>
                          <td className="px-4 py-3 text-right text-sm text-slate-700">
                            ${(j.priceCents / 100).toFixed(2)}
                          </td>
                        </tr>
                      );
                      if (idx === todayIdx) {
                        return [
                          <tr key="today-line" ref={jobsTodayRef}>
                            <td colSpan={6} className="px-0 py-0">{TODAY_LINE}</td>
                          </tr>,
                          row,
                        ];
                      }
                      return [row];
                    })}
                    {todayIdx === -1 && sortedJobs.length > 0 && (
                      <tr ref={jobsTodayRef}>
                        <td colSpan={6} className="px-0 py-0">{TODAY_LINE}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="mt-6">
          {customerInvoicesQuery.isLoading && (
            <p className="py-6 text-sm text-slate-500">Loading invoices…</p>
          )}
          {!customerInvoicesQuery.isLoading &&
            (customerInvoicesQuery.data?.items ?? []).length === 0 && (
              <div className="rounded-md border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
                No invoices yet for this customer.
              </div>
            )}
          {(customerInvoicesQuery.data?.items ?? []).length > 0 && (() => {
            const sortedInvs = [...(customerInvoicesQuery.data?.items ?? [])].sort(
              (a: InvoiceSummaryDto, b: InvoiceSummaryDto) => {
                if (!a.dueDate && !b.dueDate) return 0;
                if (!a.dueDate) return 1;
                if (!b.dueDate) return -1;
                return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
              },
            );
            const todayStr = new Date().toISOString().slice(0, 10);
            const todayIdx = sortedInvs.findIndex(
              (inv: InvoiceSummaryDto) => !inv.dueDate || inv.dueDate >= todayStr,
            );
            return (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Number</th>
                      <th className="px-4 py-3 font-medium">Service</th>
                      <th className="px-4 py-3 font-medium text-right">Amount</th>
                      <th className="px-4 py-3 font-medium">Due Date</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sortedInvs.flatMap((inv: InvoiceSummaryDto, idx: number) => {
                      const row = (
                        <tr key={inv.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">
                            <Link href={`/invoices/${inv.id}` as Route} className="text-brand-700 hover:underline">
                              #{inv.invoiceNumber}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{inv.serviceNameSnapshot ?? '-'}</td>
                          <td className="px-4 py-3 text-right text-sm font-medium text-slate-900">
                            ${(inv.totalCents / 100).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">{inv.dueDate ?? 'Upon receipt'}</td>
                          <td className="px-4 py-3 text-sm capitalize text-slate-700">
                            {inv.status === 'past_due' ? 'Past Due' : inv.status}
                          </td>
                        </tr>
                      );
                      if (idx === todayIdx) {
                        return [
                          <tr key="today-line" ref={invTodayRef}>
                            <td colSpan={5} className="px-0 py-0">{TODAY_LINE}</td>
                          </tr>,
                          row,
                        ];
                      }
                      return [row];
                    })}
                    {todayIdx === -1 && sortedInvs.length > 0 && (
                      <tr ref={invTodayRef}>
                        <td colSpan={5} className="px-0 py-0">{TODAY_LINE}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
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
