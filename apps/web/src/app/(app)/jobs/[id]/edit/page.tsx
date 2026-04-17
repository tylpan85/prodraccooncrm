'use client';

import type { CustomerDto, JobDto, RecurrenceRuleInput, ServiceDto, TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RecurrenceEditor } from '../../../../../components/common/recurrence-editor';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { ApiClientError } from '../../../../../lib/api-client';
import { customersApi } from '../../../../../lib/customers-api';
import { jobsApi } from '../../../../../lib/jobs-api';
import {
  type RecurringSeriesDto,
  recurringApi,
} from '../../../../../lib/recurring-api';
import { settingsApi } from '../../../../../lib/settings-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert ISO string to local datetime-local value (YYYY-MM-DDTHH:MM) */
function isoToLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert local datetime-local value back to ISO string */
function localToIso(local: string): string {
  return new Date(local).toISOString();
}

/** Convert a RecurringSeriesDto to RecurrenceRuleInput for the editor */
function seriesToRule(series: RecurringSeriesDto): RecurrenceRuleInput {
  return {
    recurrenceFrequency: series.recurrenceFrequency,
    recurrenceInterval: series.recurrenceInterval,
    recurrenceEndMode: series.recurrenceEndMode,
    recurrenceOccurrenceCount: series.recurrenceOccurrenceCount ?? null,
    recurrenceEndDate: series.recurrenceEndDate ?? null,
    recurrenceDayOfWeek: (series.recurrenceDayOfWeek as RecurrenceRuleInput['recurrenceDayOfWeek']) ?? null,
    recurrenceDayOfMonth: series.recurrenceDayOfMonth ?? null,
    recurrenceOrdinal: (series.recurrenceOrdinal as RecurrenceRuleInput['recurrenceOrdinal']) ?? null,
    recurrenceMonthOfYear: (series.recurrenceMonthOfYear as RecurrenceRuleInput['recurrenceMonthOfYear']) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EditJobPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;

  const jobQuery = useQuery({
    queryKey: ['job', id],
    queryFn: () => jobsApi.get(id),
    retry: false,
  });

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => settingsApi.listServices(false),
  });

  const teamMembersQuery = useQuery({
    queryKey: ['team-members'],
    queryFn: () => settingsApi.listTeamMembers(),
  });

  const job = jobQuery.data as JobDto | undefined;
  const isRecurring = !!job?.recurringSeriesId;

  const seriesQuery = useQuery({
    queryKey: ['series-for-job', id],
    queryFn: () => recurringApi.getSeriesForJob(id),
    enabled: isRecurring,
  });

  const customerQuery = useQuery({
    queryKey: ['customer', job?.customerId],
    queryFn: () => customersApi.get(job!.customerId),
    enabled: !!job,
  });

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [priceCents, setPriceCents] = useState(0);
  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [addressId, setAddressId] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [assigneeTeamMemberId, setAssigneeTeamMemberId] = useState<string | null>(null);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRuleInput | null>(null);
  const [recurrenceRuleInitialized, setRecurrenceRuleInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [showScopeDialog, setShowScopeDialog] = useState(false);

  useEffect(() => {
    if (job && !initialized) {
      setServiceId(job.serviceId);
      setPriceCents(job.priceCents);
      setPriceDisplay((job.priceCents / 100).toFixed(2));
      setAddressId(job.customerAddressId);
      setPrivateNotes(job.privateNotes ?? '');
      setTags([...job.tags]);
      setScheduledStart(isoToLocal(job.scheduledStartAt));
      setScheduledEnd(isoToLocal(job.scheduledEndAt));
      setAssigneeTeamMemberId(job.assigneeTeamMemberId);
      setInitialized(true);
    }
  }, [job, initialized]);

  // Initialize recurrence rule from series data
  const seriesData = seriesQuery.data as RecurringSeriesDto | null | undefined;
  useEffect(() => {
    if (seriesData && !recurrenceRuleInitialized) {
      setRecurrenceRule(seriesToRule(seriesData));
      setRecurrenceRuleInitialized(true);
    }
  }, [seriesData, recurrenceRuleInitialized]);

  const services: ServiceDto[] = servicesQuery.data?.items ?? [];
  const teamMembers: TeamMemberDto[] = teamMembersQuery.data?.items ?? [];
  const customer: CustomerDto | undefined = customerQuery.data;

  // ------- Mutations -------

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['job', id] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
    queryClient.invalidateQueries({ queryKey: ['series-for-job', id] });
  }

  function buildChanges() {
    return {
      customerAddressId: addressId || undefined,
      serviceId: serviceId,
      priceCents,
      privateNotes: privateNotes.trim() || null,
      tags,
      ...(scheduledStart ? { scheduledStartAt: localToIso(scheduledStart) } : {}),
      ...(scheduledEnd ? { scheduledEndAt: localToIso(scheduledEnd) } : {}),
      assigneeTeamMemberId: assigneeTeamMemberId,
    };
  }

  /** Check if recurrence rule was changed from the original series values */
  function hasRecurrenceRuleChanged(): boolean {
    if (!seriesData || !recurrenceRule) return false;
    const original = seriesToRule(seriesData);
    return JSON.stringify(original) !== JSON.stringify(recurrenceRule);
  }

  // Non-recurring: update fields + reschedule
  const updateMutation = useMutation({
    mutationFn: async () => {
      await jobsApi.update(id, {
        customerAddressId: addressId || undefined,
        serviceId: serviceId,
        priceCents,
        privateNotes: privateNotes.trim() || null,
        tags,
      });
      if (scheduledStart && scheduledEnd) {
        await jobsApi.schedule(id, {
          scheduledStartAt: localToIso(scheduledStart),
          scheduledEndAt: localToIso(scheduledEnd),
          assigneeTeamMemberId: assigneeTeamMemberId,
        });
      }
    },
    onSuccess: () => {
      invalidateAll();
      router.push(`/jobs/${id}` as Route);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update');
    },
  });

  // Recurring: occurrence-edit
  const occurrenceEditMutation = useMutation({
    mutationFn: (scope: 'this' | 'this_and_future') => {
      const body: {
        scope: 'this' | 'this_and_future';
        changes: ReturnType<typeof buildChanges>;
        recurrenceRule?: RecurrenceRuleInput;
      } = { scope, changes: buildChanges() };

      // Only include recurrence rule changes with this_and_future scope
      if (scope === 'this_and_future' && hasRecurrenceRuleChanged() && recurrenceRule) {
        body.recurrenceRule = recurrenceRule;
      }

      return jobsApi.occurrenceEdit(id, body);
    },
    onSuccess: () => {
      invalidateAll();
      router.push(`/jobs/${id}` as Route);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update');
    },
  });

  const saving = updateMutation.isPending || occurrenceEditMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (isRecurring) {
      setShowScopeDialog(true);
    } else {
      updateMutation.mutate();
    }
  }

  function handleScopeChoice(scope: 'this' | 'this_and_future') {
    setShowScopeDialog(false);
    occurrenceEditMutation.mutate(scope);
  }

  if (jobQuery.isLoading) {
    return <div className="px-6 py-8 text-sm text-slate-500">Loading…</div>;
  }
  if (!job) {
    return <div className="px-6 py-8 text-sm text-slate-700">Job not found.</div>;
  }

  const scheduleSummary = (() => {
    if (!job?.scheduledStartAt || !job?.scheduledEndAt) return null;
    const s = new Date(job.scheduledStartAt);
    const e = new Date(job.scheduledEndAt);
    const datePart = s.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const startTime = s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const endTime = e.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${datePart} · ${startTime} – ${endTime}`;
  })();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">Edit {job.jobNumber}</h1>
      <div className="mt-1 space-y-0.5">
        <p className="text-sm text-slate-700">
          <span className="font-medium">{job.customerDisplayName}</span>
          {job.serviceName && <span className="text-slate-500"> · {job.serviceName}</span>}
        </p>
        {scheduleSummary && (
          <p className="text-sm text-slate-500">{scheduleSummary}</p>
        )}
        {job.assigneeDisplayName && (
          <p className="text-sm text-slate-500">Assigned to {job.assigneeDisplayName}</p>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
        <Section title="Schedule">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Start</Label>
              <Input
                className="mt-1"
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <Label>End</Label>
              <Input
                className="mt-1"
                type="datetime-local"
                value={scheduledEnd}
                onChange={(e) => setScheduledEnd(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
          <div className="mt-4">
            <Label>Assignee</Label>
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={assigneeTeamMemberId ?? ''}
              onChange={(e) => setAssigneeTeamMemberId(e.target.value || null)}
              disabled={saving}
            >
              <option value="">Unassigned</option>
              {teamMembers
                .filter((tm) => tm.activeOnSchedule)
                .map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.displayName}
                  </option>
                ))}
            </select>
          </div>
        </Section>

        {isRecurring && (
          <Section title="Recurrence">
            {seriesQuery.isLoading ? (
              <p className="text-sm text-slate-500">Loading recurrence rule…</p>
            ) : (
              <RecurrenceEditor
                scheduledDate={scheduledStart ? new Date(scheduledStart) : null}
                value={recurrenceRule}
                onChange={setRecurrenceRule}
                disabled={saving}
              />
            )}
            {hasRecurrenceRuleChanged() && (
              <p className="mt-2 text-xs text-amber-600">
                Recurrence rule changes will only apply when saving with "This and all future jobs".
              </p>
            )}
          </Section>
        )}

        <Section title="Address">
          {customer && customer.addresses.length > 0 ? (
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={addressId}
              onChange={(e) => setAddressId(e.target.value)}
              disabled={saving}
            >
              {customer.addresses.map((a) => {
                const line = [a.street, a.unit, a.city, a.state, a.zip].filter(Boolean).join(', ');
                return (
                  <option key={a.id} value={a.id}>
                    {line || 'No details'}
                  </option>
                );
              })}
            </select>
          ) : (
            <p className="text-sm text-slate-500">Loading addresses…</p>
          )}
        </Section>

        <Section title="Service & Price">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Service</Label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={serviceId ?? ''}
                onChange={(e) => setServiceId(e.target.value || null)}
                disabled={saving}
              >
                <option value="">None</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Price ($)</Label>
              <Input
                className="mt-1"
                type="text"
                inputMode="decimal"
                value={priceDisplay}
                onChange={(e) => {
                  setPriceDisplay(e.target.value);
                  const cents = Math.round(Number.parseFloat(e.target.value || '0') * 100);
                  setPriceCents(Number.isNaN(cents) ? 0 : Math.max(0, cents));
                }}
                disabled={saving}
              />
            </div>
          </div>
        </Section>

        <Section title="Details">
          <div className="space-y-4">
            <div>
              <Label>Private notes</Label>
              <textarea
                className="mt-1 min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                value={privateNotes}
                onChange={(e) => setPrivateNotes(e.target.value)}
                maxLength={10000}
                disabled={saving}
              />
            </div>
            <div>
              <Label>Tags</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    {tag}
                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-700"
                      onClick={() => setTags(tags.filter((t) => t !== tag))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-1 flex gap-2">
                <Input
                  value={tagInput}
                  placeholder="Add tag"
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const t = tagInput.trim();
                      if (t && !tags.includes(t)) setTags([...tags, t]);
                      setTagInput('');
                    }
                  }}
                  disabled={saving}
                />
              </div>
            </div>
          </div>
        </Section>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push(`/jobs/${id}` as Route)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>

      {/* Recurring scope dialog */}
      {showScopeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Edit recurring job</h3>
            <p className="mt-2 text-sm text-slate-600">
              This job is part of a recurring series. Apply changes to:
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                onClick={() => handleScopeChoice('this')}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Only this job'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleScopeChoice('this_and_future')}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'This and all future jobs'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowScopeDialog(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}
