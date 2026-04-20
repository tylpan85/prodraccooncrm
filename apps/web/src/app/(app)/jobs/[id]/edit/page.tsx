'use client';

import type { CustomerDto, JobDto, RecurrenceRuleInput, ServiceDto, TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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

/** ISO string → datetime-local value (YYYY-MM-DDTHH:MM) in local time */
function isoToLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value → ISO string */
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

  // ── Data fetching ────────────────────────────────────────────────────
  const jobQuery = useQuery({
    queryKey: ['job', id],
    queryFn: () => jobsApi.get(id),
    retry: false,
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

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => settingsApi.listServices(false),
  });

  const teamMembersQuery = useQuery({
    queryKey: ['team-members'],
    queryFn: () => settingsApi.listTeamMembers(),
  });

  // ── Form state ───────────────────────────────────────────────────────
  const [addressId, setAddressId] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [priceCents, setPriceCents] = useState(0);
  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [privateNotes, setPrivateNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRuleInput | null>(null);

  const [initialized, setInitialized] = useState(false);
  const [recurrenceInitialized, setRecurrenceInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScopeDialog, setShowScopeDialog] = useState(false);

  // Initialize form from job data (runs once when job loads)
  useEffect(() => {
    if (job && !initialized) {
      setAddressId(job.customerAddressId);
      setServiceId(job.serviceId);
      setPriceCents(job.priceCents);
      setPriceDisplay((job.priceCents / 100).toFixed(2));
      setPrivateNotes(job.privateNotes ?? '');
      setTags([...job.tags]);
      setStartAt(isoToLocal(job.scheduledStartAt));
      setEndAt(isoToLocal(job.scheduledEndAt));
      setAssigneeId(job.assigneeTeamMemberId);
      setInitialized(true);
    }
  }, [job, initialized]);

  // Initialize recurrence rule from series data
  const seriesData = seriesQuery.data as RecurringSeriesDto | null | undefined;
  useEffect(() => {
    if (seriesData && !recurrenceInitialized) {
      setRecurrenceRule(seriesToRule(seriesData));
      setRecurrenceInitialized(true);
    }
  }, [seriesData, recurrenceInitialized]);

  // ── Derived values ───────────────────────────────────────────────────
  const services: ServiceDto[] = servicesQuery.data?.items ?? [];
  const teamMembers: TeamMemberDto[] = teamMembersQuery.data?.items ?? [];
  const customer: CustomerDto | undefined = customerQuery.data;

  const scheduledDate = useMemo(() => {
    if (!startAt) return null;
    const d = new Date(startAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [startAt]);

  // ── Mutations ────────────────────────────────────────────────────────

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['job', id] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
    queryClient.invalidateQueries({ queryKey: ['series-for-job', id] });
  }

  function buildChanges() {
    return {
      customerAddressId: addressId || undefined,
      serviceId,
      titleOrSummary: null,
      priceCents,
      privateNotes: privateNotes.trim() || null,
      tags,
      ...(startAt ? { scheduledStartAt: localToIso(startAt) } : {}),
      ...(endAt ? { scheduledEndAt: localToIso(endAt) } : {}),
      assigneeTeamMemberId: assigneeId,
    };
  }

  function hasRecurrenceRuleChanged(): boolean {
    if (!seriesData || !recurrenceRule) return false;
    return JSON.stringify(seriesToRule(seriesData)) !== JSON.stringify(recurrenceRule);
  }

  // Non-recurring save
  const updateMutation = useMutation({
    mutationFn: async () => {
      await jobsApi.update(id, {
        customerAddressId: addressId || undefined,
        serviceId,
        titleOrSummary: null,
        priceCents,
        privateNotes: privateNotes.trim() || null,
        tags,
      });
      if (startAt && endAt) {
        await jobsApi.schedule(id, {
          scheduledStartAt: localToIso(startAt),
          scheduledEndAt: localToIso(endAt),
          assigneeTeamMemberId: assigneeId,
        });
      }
    },
    onSuccess: () => {
      invalidateAll();
      router.push('/scheduler' as Route);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update');
    },
  });

  // Recurring save
  const occurrenceEditMutation = useMutation({
    mutationFn: (scope: 'this' | 'this_and_future') => {
      const body: {
        scope: 'this' | 'this_and_future';
        changes: ReturnType<typeof buildChanges>;
        recurrenceRule?: RecurrenceRuleInput;
      } = { scope, changes: buildChanges() };

      if (scope === 'this_and_future' && hasRecurrenceRuleChanged() && recurrenceRule) {
        body.recurrenceRule = recurrenceRule;
      }

      return jobsApi.occurrenceEdit(id, body);
    },
    onSuccess: () => {
      invalidateAll();
      router.push('/scheduler' as Route);
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

  // ── Loading / error states ───────────────────────────────────────────
  if (jobQuery.isLoading || !initialized) {
    return <div className="px-6 py-8 text-sm text-slate-500">Loading…</div>;
  }
  if (!job) {
    return <div className="px-6 py-8 text-sm text-slate-700">Job not found.</div>;
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-5xl px-6 py-4">
      <h1 className="text-xl font-semibold text-slate-900">Edit {job.jobNumber}</h1>

      {error && (
        <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form className="mt-4" onSubmit={handleSubmit}>
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {/* ── Left column: job details ───────────────────────── */}
          <div className="space-y-3">
            {/* Customer — display only */}
            <div>
              <Label>Customer</Label>
              <p className="mt-1 text-sm font-medium text-slate-900">{job.customerDisplayName}</p>
            </div>

            {/* Address */}
            <div>
              <Label>Address</Label>
              {customer && customer.addresses.length > 0 ? (
                <select
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={addressId}
                  onChange={(e) => setAddressId(e.target.value)}
                  disabled={saving}
                >
                  {customer.addresses.map((a) => {
                    const line = [a.street, a.unit, a.city, a.state, a.zip]
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <option key={a.id} value={a.id}>
                        {line || 'No details'}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Loading addresses…</p>
              )}
            </div>

            {/* Service & Price */}
            <div className="grid grid-cols-2 gap-3">
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

            {/* Assign to */}
            <div>
              <Label>Assign to</Label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={assigneeId ?? ''}
                onChange={(e) => setAssigneeId(e.target.value || null)}
                disabled={saving}
              >
                <option value="">Unassigned</option>
                {teamMembers.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <Label>Private notes</Label>
              <textarea
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                rows={2}
                value={privateNotes}
                onChange={(e) => setPrivateNotes(e.target.value)}
                maxLength={10000}
                disabled={saving}
              />
            </div>

            {/* Tags */}
            <div>
              <Label>Tags</Label>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
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
                <Input
                  className="h-7 w-28 text-xs"
                  value={tagInput}
                  placeholder="+ tag"
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

          {/* ── Right column: schedule ─────────────────────────── */}
          <div className="space-y-3">
            {/* Start */}
            <div>
              <Label>Start</Label>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={startAt}
                onChange={(e) => {
                  const newStartAt = e.target.value;
                  setStartAt(newStartAt);
                  // Preserve duration: shift end time by the same delta
                  const oldStart = new Date(startAt);
                  const oldEnd = new Date(endAt);
                  const newStart = new Date(newStartAt);
                  if (!isNaN(oldStart.getTime()) && !isNaN(oldEnd.getTime()) && !isNaN(newStart.getTime())) {
                    const durationMs = oldEnd.getTime() - oldStart.getTime();
                    if (durationMs > 0) {
                      const newEnd = new Date(newStart.getTime() + durationMs);
                      // Format as datetime-local value (YYYY-MM-DDTHH:mm)
                      const pad = (n: number) => String(n).padStart(2, '0');
                      const newEndValue = `${newEnd.getFullYear()}-${pad(newEnd.getMonth() + 1)}-${pad(newEnd.getDate())}T${pad(newEnd.getHours())}:${pad(newEnd.getMinutes())}`;
                      setEndAt(newEndValue);
                    }
                  }
                  // For weekly jobs: auto-sync recurrenceDayOfWeek to match the new date
                  if (recurrenceRule?.recurrenceFrequency === 'weekly') {
                    const d = new Date(newStartAt);
                    if (!isNaN(d.getTime())) {
                      const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
                      const dow = days[d.getDay()];
                      if (dow) setRecurrenceRule({ ...recurrenceRule, recurrenceDayOfWeek: [dow] });
                    }
                  }
                }}
                disabled={saving}
              />
            </div>

            {/* End */}
            <div>
              <Label>End</Label>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                disabled={saving}
              />
            </div>

            {isRecurring && (
              seriesQuery.isLoading && !recurrenceInitialized ? (
                <p className="text-sm text-slate-500">Loading recurrence…</p>
              ) : (
                <>
                  <RecurrenceEditor
                    scheduledDate={scheduledDate}
                    value={recurrenceRule}
                    onChange={setRecurrenceRule}
                    disabled={saving}
                    defaultOpen
                  />
                  {hasRecurrenceRuleChanged() && (
                    <p className="text-xs text-amber-600">
                      Recurrence changes apply only when saving "This and all future jobs".
                    </p>
                  )}
                </>
              )
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.back()}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>

      {/* Scope dialog for recurring jobs */}
      {showScopeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Edit recurring job</h3>
            <p className="mt-2 text-sm text-slate-600">
              This job is part of a recurring series. Apply changes to:
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button onClick={() => handleScopeChoice('this')} disabled={saving}>
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
