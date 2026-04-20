'use client';

import type { JobDto, TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Label } from '../../../../components/ui/label';
import { DetailSkeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { jobsApi } from '../../../../lib/jobs-api';
import { settingsApi } from '../../../../lib/settings-api';

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const STAGE_OPTIONS = [
  { value: 'scheduled',         label: 'Scheduled',          bg: 'bg-slate-100',   text: 'text-slate-700' },
  { value: 'confirmation_sent', label: 'Confirmation Sent',  bg: 'bg-blue-100',    text: 'text-blue-700' },
  { value: 'confirmed',         label: 'Confirmed',          bg: 'bg-green-100',   text: 'text-green-700' },
  { value: 'job_done',          label: 'Job Done',           bg: 'bg-emerald-600', text: 'text-white' },
  { value: 'cancelled',         label: 'Cancelled',          bg: 'bg-red-100',     text: 'text-red-700' },
] as const;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const router = useRouter();
  const id = params.id;

  const jobQuery = useQuery({
    queryKey: ['job', id],
    queryFn: () => jobsApi.get(id),
    retry: false,
  });

  const teamMembersQuery = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => settingsApi.listTeamMembers(),
  });

  const [error, setError] = useState<string | null>(null);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCancelScopeDialog, setShowCancelScopeDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['job', id] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
  }

  const deleteMutation = useMutation({
    mutationFn: (scope?: 'this' | 'this_and_future') => {
      if (scope) {
        return jobsApi.occurrenceDelete(id, { scope }).then(() => {});
      }
      return jobsApi.delete(id);
    },
    onSuccess: () => {
      invalidate();
      router.push('/scheduler' as Route);
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed to delete'),
  });

  const finishMutation = useMutation({
    mutationFn: () => jobsApi.finish(id),
    onSuccess: () => invalidate(),
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed'),
  });

  const reopenMutation = useMutation({
    mutationFn: () => jobsApi.reopen(id),
    onSuccess: () => invalidate(),
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed'),
  });

  const unassignMutation = useMutation({
    mutationFn: () => jobsApi.unassign(id),
    onSuccess: () => invalidate(),
  });

  const stageMutation = useMutation({
    mutationFn: (vars: { stage: string; scope?: 'this' | 'this_and_future' }) =>
      jobsApi.setStage(id, vars),
    onSuccess: () => {
      setShowCancelScopeDialog(false);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed to update stage'),
  });

  if (jobQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (jobQuery.error) {
    const notFound =
      jobQuery.error instanceof ApiClientError && jobQuery.error.code === 'JOB_NOT_FOUND';
    return (
      <div className="px-6 py-8 text-sm text-slate-700">
        {notFound ? 'Job not found.' : 'Could not load job.'}
      </div>
    );
  }

  const job = jobQuery.data as JobDto;
  const activeTeamMembers: TeamMemberDto[] = (teamMembersQuery.data?.items ?? []).filter(
    (t) => t.activeOnSchedule,
  );

  const statusLabel = 'Scheduled';
  const statusColor: Record<string, string> = {
    Scheduled: 'bg-green-100 text-green-800',
  };

  return (
    <div className="px-6 py-8">
      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-slate-900">{job.jobNumber}</h1>
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${statusColor[statusLabel] ?? 'bg-slate-100 text-slate-700'}`}
            >
              {statusLabel}
            </span>
            {(() => {
              const opt = STAGE_OPTIONS.find((o) => o.value === (job.jobStage ?? 'scheduled'));
              if (!opt) return null;
              return (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${opt.bg} ${opt.text}`}>
                  {opt.label}
                </span>
              );
            })()}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            <Link
              href={`/customers/${job.customerId}` as Route}
              className="text-brand-700 hover:underline"
            >
              {job.customerDisplayName}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/jobs/${job.id}/edit` as Route}>
            <Button variant="secondary">Edit</Button>
          </Link>
          {job.jobStage === 'job_done' && (
            <Button
              variant="secondary"
              onClick={() => setShowReopenDialog(true)}
            >
              Reopen
            </Button>
          )}
          {job.jobStage !== 'job_done' && (
            <Button
              variant="ghost"
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setShowDeleteDialog(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Details grid */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Details">
          <dl className="space-y-2 text-sm">
            <Row label="Service" value={job.serviceName ?? '—'} />
            <Row label="Price" value={formatCents(job.priceCents)} />
            <Row label="Lead source" value={job.leadSource ?? '—'} />
          </dl>
        </Card>

        <Card title="Schedule">
          <dl className="space-y-2 text-sm">
            <Row label="Status" value="Scheduled" />
            <Row label="Start" value={formatDate(job.scheduledStartAt)} />
            <Row label="End" value={formatDate(job.scheduledEndAt)} />
            <Row label="Assignee" value={job.assigneeDisplayName ?? 'Unassigned'} />
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowScheduleDialog(true)}
            >
              Reschedule
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowAssignDialog(true)}
            >
              {job.assigneeTeamMemberId ? 'Change assignee' : 'Assign'}
            </Button>
            {job.assigneeTeamMemberId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => unassignMutation.mutate()}
                disabled={unassignMutation.isPending}
              >
                Unassign
              </Button>
            )}
          </div>
        </Card>

        {job.tags.length > 0 && (
          <Card title="Tags">
            <div className="flex flex-wrap gap-2">
              {job.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                >
                  {t}
                </span>
              ))}
            </div>
          </Card>
        )}

        {job.privateNotes && (
          <Card title="Notes">
            <p className="whitespace-pre-wrap text-sm text-slate-700">{job.privateNotes}</p>
          </Card>
        )}

        {/* Invoice section */}
        {job.invoice && (
          <Card title="Invoice">
            <dl className="space-y-2 text-sm">
              <Row label="Number" value={job.invoice.invoiceNumber} />
              <Row label="Status" value={job.invoice.status} />
              <Row label="Total" value={formatCents(job.invoice.totalCents)} />
            </dl>
          </Card>
        )}

        {/* Stage */}
        <Card title="Stage">
          {job.jobStage === 'job_done' ? (
            <div className="flex items-center gap-3">
              {(() => {
                const opt = STAGE_OPTIONS.find((o) => o.value === 'job_done')!;
                return (
                  <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${opt.bg} ${opt.text}`}>
                    {opt.label}
                  </span>
                );
              })()}
              <span className="text-xs text-slate-400">Use Reopen to change stage</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {STAGE_OPTIONS.map((opt) => {
                const active = (job.jobStage ?? 'scheduled') === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={stageMutation.isPending}
                    onClick={() => {
                      if (active) return;
                      if (opt.value === 'cancelled' && job.recurringSeriesId) {
                        setShowCancelScopeDialog(true);
                      } else {
                        stageMutation.mutate({ stage: opt.value });
                      }
                    }}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-opacity ${opt.bg} ${opt.text} ${
                      active ? 'ring-2 ring-offset-1 ring-slate-400 opacity-100' : 'opacity-50 hover:opacity-80'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Schedule dialog */}
      {showScheduleDialog && (
        <ScheduleDialog
          jobId={job.id}
          initial={{
            startAt: job.scheduledStartAt,
            endAt: job.scheduledEndAt,
            assigneeId: job.assigneeTeamMemberId,
          }}
          teamMembers={activeTeamMembers}
          onClose={() => setShowScheduleDialog(false)}
          onSuccess={() => {
            setShowScheduleDialog(false);
            invalidate();
          }}
        />
      )}

      {/* Assign dialog */}
      {showAssignDialog && (
        <AssignDialog
          jobId={job.id}
          currentAssignee={job.assigneeTeamMemberId}
          teamMembers={activeTeamMembers}
          onClose={() => setShowAssignDialog(false)}
          onSuccess={() => {
            setShowAssignDialog(false);
            invalidate();
          }}
        />
      )}

      {/* Cancel scope dialog */}
      {showCancelScopeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Cancel job</h3>
            <p className="mt-2 text-sm text-slate-600">
              This job is part of a recurring series. Which jobs do you want to cancel?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                variant="ghost"
                className="justify-start text-red-600 hover:bg-red-50"
                onClick={() => stageMutation.mutate({ stage: 'cancelled', scope: 'this' })}
                disabled={stageMutation.isPending}
              >
                {stageMutation.isPending ? 'Saving…' : 'Only this job'}
              </Button>
              <Button
                variant="ghost"
                className="justify-start text-red-600 hover:bg-red-50"
                onClick={() => stageMutation.mutate({ stage: 'cancelled', scope: 'this_and_future' })}
                disabled={stageMutation.isPending}
              >
                {stageMutation.isPending ? 'Saving…' : 'This and all future jobs'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowCancelScopeDialog(false)}
                disabled={stageMutation.isPending}
              >
                Back
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Delete {job.jobNumber}</h3>
            {job.recurringSeriesId ? (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  This job is part of a recurring series. What do you want to delete?
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Button
                    variant="ghost"
                    className="justify-start text-red-600 hover:bg-red-50"
                    onClick={() => deleteMutation.mutate('this')}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Only this job'}
                  </Button>
                  <Button
                    variant="ghost"
                    className="justify-start text-red-600 hover:bg-red-50"
                    onClick={() => deleteMutation.mutate('this_and_future')}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'This and all future jobs'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowDeleteDialog(false)}
                    disabled={deleteMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-slate-600">
                  Are you sure you want to delete this job? This cannot be undone.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setShowDeleteDialog(false)}
                    disabled={deleteMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() => deleteMutation.mutate(undefined)}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Reopen confirmation dialog */}
      {showReopenDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Reopen job</h3>
            <p className="mt-2 text-sm text-slate-600">
              Are you sure you want to reopen this job?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setShowReopenDialog(false)}
                disabled={reopenMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  reopenMutation.mutate(undefined, {
                    onSuccess: () => setShowReopenDialog(false),
                  });
                }}
                disabled={reopenMutation.isPending}
              >
                {reopenMutation.isPending ? 'Reopening…' : 'Reopen'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function ScheduleDialog({
  jobId,
  initial,
  teamMembers,
  onClose,
  onSuccess,
}: {
  jobId: string;
  initial: { startAt: string | null; endAt: string | null; assigneeId: string | null };
  teamMembers: TeamMemberDto[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  function toLocal(iso: string | null): string {
    if (!iso) return '';
    return iso.slice(0, 16);
  }

  const [startAt, setStartAt] = useState(toLocal(initial.startAt));
  const [endAt, setEndAt] = useState(toLocal(initial.endAt));
  const [assigneeId, setAssigneeId] = useState(initial.assigneeId ?? '');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      jobsApi.schedule(jobId, {
        scheduledStartAt: new Date(startAt).toISOString(),
        scheduledEndAt: new Date(endAt).toISOString(),
        assigneeTeamMemberId: assigneeId || null,
      }),
    onSuccess,
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed'),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Schedule job</h3>
        {error && (
          <div className="mt-2 rounded bg-red-50 px-2 py-1 text-sm text-red-800">{error}</div>
        )}
        <div className="mt-4 space-y-4">
          <div>
            <Label>Start</Label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          </div>
          <div>
            <Label>End</Label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
            />
          </div>
          <div>
            <Label>Assignee</Label>
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {teamMembers.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !startAt || !endAt}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssignDialog({
  jobId,
  currentAssignee,
  teamMembers,
  onClose,
  onSuccess,
}: {
  jobId: string;
  currentAssignee: string | null;
  teamMembers: TeamMemberDto[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [assigneeId, setAssigneeId] = useState(currentAssignee ?? '');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => jobsApi.assign(jobId, { assigneeTeamMemberId: assigneeId }),
    onSuccess,
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed'),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Assign job</h3>
        {error && (
          <div className="mt-2 rounded bg-red-50 px-2 py-1 text-sm text-red-800">{error}</div>
        )}
        <div className="mt-4">
          <select
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">Select team member…</option>
            {teamMembers.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !assigneeId}>
            {mutation.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      </div>
    </div>
  );
}
