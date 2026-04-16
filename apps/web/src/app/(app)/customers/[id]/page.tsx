'use client';

import type { CustomerDto, JobSummaryDto } from '@openclaw/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { ApiClientError } from '../../../../lib/api-client';
import { customersApi } from '../../../../lib/customers-api';
import { jobsApi } from '../../../../lib/jobs-api';

type Tab = 'overview' | 'jobs' | 'invoices';

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [tab, setTab] = useState<Tab>('overview');

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

  if (customerQuery.isLoading) {
    return <div className="px-6 py-8 text-sm text-slate-500">Loading customer…</div>;
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
          <Link href={`/customers/${c.id}/edit` as Route}>
            <Button variant="secondary">Edit</Button>
          </Link>
          <Link href={`/jobs/new?customerId=${c.id}` as Route}>
            <Button>New job</Button>
          </Link>
          <Button disabled title="Available in Phase 10">
            New recurring job
          </Button>
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
          {(customerJobsQuery.data?.items ?? []).length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Job #</th>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Schedule</th>
                    <th className="px-4 py-3 font-medium">Assignee</th>
                    <th className="px-4 py-3 font-medium text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(customerJobsQuery.data?.items ?? []).map((j: JobSummaryDto) => (
                    <tr key={j.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        <Link
                          href={`/jobs/${j.id}` as Route}
                          className="text-brand-700 hover:underline"
                        >
                          {j.jobNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {j.titleOrSummary ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${
                            j.jobStatus === 'finished'
                              ? 'bg-slate-200 text-slate-700'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {j.jobStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {j.scheduleState === 'scheduled'
                          ? new Date(j.scheduledStartAt!).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })
                          : 'Unscheduled'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {j.assigneeDisplayName ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-700">
                        ${(j.priceCents / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
          Invoices will appear here once Phase 11 lands.
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
