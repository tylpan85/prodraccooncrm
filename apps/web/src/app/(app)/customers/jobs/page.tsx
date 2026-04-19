'use client';

import type { JobSummaryDto } from '@openclaw/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { TableSkeleton } from '../../../../components/ui/skeleton';
import { jobsApi } from '../../../../lib/jobs-api';

const STAGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  scheduled:         { bg: 'bg-slate-100',   text: 'text-slate-600', label: 'Scheduled' },
  confirmation_sent: { bg: 'bg-blue-100',    text: 'text-blue-700',  label: 'Conf. Sent' },
  confirmed:         { bg: 'bg-green-100',   text: 'text-green-700', label: 'Confirmed' },
  job_done:          { bg: 'bg-emerald-600', text: 'text-white',     label: 'Done' },
  cancelled:         { bg: 'bg-red-100',     text: 'text-red-700',   label: 'Cancelled' },
};

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

      {jobsQuery.isLoading ? (
        <div className="mt-6">
          <TableSkeleton rows={5} cols={7} />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-slate-300 px-6 py-12 text-center text-sm text-slate-500">
          No jobs yet — create one from a customer or the scheduler.
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Job #</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Schedule</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium text-right">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((j) => (
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
                    <Link href={`/customers/${j.customerId}` as Route} className="hover:underline">
                      {j.customerDisplayName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{j.titleOrSummary ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">
                    {(() => {
                      const s = STAGE_STYLES[j.jobStage] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Scheduled' };
                      return (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
                          {s.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {new Date(j.scheduledStartAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
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
  );
}
