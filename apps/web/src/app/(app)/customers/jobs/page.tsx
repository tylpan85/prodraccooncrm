'use client';

import type { JobSummaryDto } from '@openclaw/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { jobsApi } from '../../../../lib/jobs-api';

export default function JobsPage() {
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: () => jobsApi.list({ limit: 50 }),
  });

  const items: JobSummaryDto[] = jobsQuery.data?.items ?? [];

  return (
    <div className="px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Jobs</h1>
        <Link href={'/jobs/new' as Route}>
          <button
            type="button"
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            New job
          </button>
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Job #</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Schedule</th>
              <th className="px-4 py-3 font-medium">Assignee</th>
              <th className="px-4 py-3 font-medium text-right">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {jobsQuery.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-sm text-slate-500">
                  Loading jobs…
                </td>
              </tr>
            )}
            {!jobsQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-sm text-slate-500">
                  No jobs yet.
                </td>
              </tr>
            )}
            {items.map((j) => (
              <tr key={j.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-900">
                  <Link href={`/jobs/${j.id}` as Route} className="text-brand-700 hover:underline">
                    {j.jobNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  <Link href={`/customers/${j.customerId}` as Route} className="hover:underline">
                    {j.customerDisplayName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{j.titleOrSummary ?? '—'}</td>
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
                  {j.scheduleState === 'scheduled' && j.scheduledStartAt
                    ? new Date(j.scheduledStartAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    : 'Unscheduled'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{j.assigneeDisplayName ?? '—'}</td>
                <td className="px-4 py-3 text-right text-sm text-slate-700">
                  ${(j.priceCents / 100).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
