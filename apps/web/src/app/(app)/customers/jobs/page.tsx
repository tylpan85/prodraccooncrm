'use client';

import type { JobSummaryDto } from '@openclaw/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { TableSkeleton } from '../../../../components/ui/skeleton';
import { jobsApi } from '../../../../lib/jobs-api';

const STAGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  scheduled:         { bg: 'bg-slate-100',   text: 'text-slate-600', label: 'Scheduled' },
  confirmation_sent: { bg: 'bg-blue-100',    text: 'text-blue-700',  label: 'Conf. Sent' },
  confirmed:         { bg: 'bg-green-100',   text: 'text-green-700', label: 'Confirmed' },
  job_done:          { bg: 'bg-emerald-600', text: 'text-white',     label: 'Done' },
  cancelled:         { bg: 'bg-red-100',     text: 'text-red-700',   label: 'Cancelled' },
};

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

export default function JobsPage() {
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: () => jobsApi.list({ limit: 2000 }),
  });

  const todayLineRef = useRef<HTMLTableRowElement>(null);

  const items: JobSummaryDto[] = [...(jobsQuery.data?.items ?? [])].sort(
    (a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime(),
  );

  const todayMs = new Date().setHours(0, 0, 0, 0);
  const todayLineIndex = items.findIndex(
    (j) => new Date(j.scheduledStartAt).getTime() >= todayMs,
  );

  useEffect(() => {
    if (todayLineRef.current) {
      todayLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [jobsQuery.data]);

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
              {items.flatMap((j, idx) => {
                const s = STAGE_STYLES[j.jobStage] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: j.jobStage };
                const row = (
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
                if (idx === todayLineIndex) {
                  return [
                    <tr key="today-line" ref={todayLineRef}>
                      <td colSpan={7} className="px-0 py-0">{TODAY_LINE}</td>
                    </tr>,
                    row,
                  ];
                }
                return [row];
              })}
              {todayLineIndex === -1 && items.length > 0 && (
                <tr ref={todayLineRef}>
                  <td colSpan={7} className="px-0 py-0">{TODAY_LINE}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
