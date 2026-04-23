'use client';

import type {
  CustomerDto,
  JobDto,
  NoteOp,
  RecurrenceRuleInput,
  ServiceDto,
  TeamMemberDto,
} from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ApiClientError } from '../../lib/api-client';
import { customersApi } from '../../lib/customers-api';
import { jobsApi } from '../../lib/jobs-api';
import {
  type RecurringSeriesDto,
  recurringApi,
} from '../../lib/recurring-api';
import { settingsApi } from '../../lib/settings-api';
import { RecurrenceEditor } from '../common/recurrence-editor';
import { NotesPanel } from '../notes/notes-panel';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

// ---------------------------------------------------------------------------
// Helpers (shared between new/edit)
// ---------------------------------------------------------------------------

/** ISO string → datetime-local value (YYYY-MM-DDTHH:MM) in local time */
function isoToLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string {
  return new Date(local).toISOString();
}

function seriesToRule(series: RecurringSeriesDto): RecurrenceRuleInput {
  return {
    recurrenceFrequency: series.recurrenceFrequency,
    recurrenceInterval: series.recurrenceInterval,
    recurrenceEndMode: series.recurrenceEndMode,
    recurrenceOccurrenceCount: series.recurrenceOccurrenceCount ?? null,
    recurrenceEndDate: series.recurrenceEndDate ?? null,
    recurrenceDayOfWeek:
      (series.recurrenceDayOfWeek as RecurrenceRuleInput['recurrenceDayOfWeek']) ?? null,
    recurrenceDayOfMonth: series.recurrenceDayOfMonth ?? null,
    recurrenceOrdinal:
      (series.recurrenceOrdinal as RecurrenceRuleInput['recurrenceOrdinal']) ?? null,
    recurrenceMonthOfYear:
      (series.recurrenceMonthOfYear as RecurrenceRuleInput['recurrenceMonthOfYear']) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type JobFormProps =
  | {
      mode: 'new';
      preselectedCustomerId?: string | null;
      preselectedStartAt?: string;
      preselectedEndAt?: string;
      preselectedAssigneeId?: string | null;
    }
  | {
      mode: 'edit';
      jobId: string;
    };

type ServiceRow = { serviceId: string | null; priceCents: number; priceDisplay: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JobForm(props: JobFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Edit-mode data ──────────────────────────────────────────────────
  const jobId = props.mode === 'edit' ? props.jobId : null;

  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobsApi.get(jobId!),
    enabled: props.mode === 'edit' && !!jobId,
    retry: false,
  });

  const job = jobQuery.data as JobDto | undefined;
  const isRecurringEdit = props.mode === 'edit' && !!job?.recurringSeriesId;

  const seriesQuery = useQuery({
    queryKey: ['series-for-job', jobId],
    queryFn: () => recurringApi.getSeriesForJob(jobId!),
    enabled: isRecurringEdit && !!jobId,
  });

  const notesQuery = useQuery({
    queryKey: ['job-notes', jobId],
    queryFn: () => jobsApi.getNotes(jobId!),
    enabled: props.mode === 'edit' && !!jobId,
  });

  // ── Customer (new: search; edit: locked display) ────────────────────
  const newPreselectedCustomerId =
    props.mode === 'new' ? props.preselectedCustomerId ?? null : null;

  const [customerSearch, setCustomerSearch] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(
    props.mode === 'new' ? newPreselectedCustomerId : null,
  );
  const [customerDisplay, setCustomerDisplay] = useState('');

  const customerSearchQuery = useQuery({
    queryKey: ['customers', customerSearch],
    queryFn: () => customersApi.list({ q: customerSearch, limit: 10 }),
    enabled: props.mode === 'new' && customerSearch.trim().length > 1 && !customerId,
  });

  // New-mode preselected customer detail
  const preselectedQuery = useQuery({
    queryKey: ['customer', newPreselectedCustomerId],
    queryFn: () => customersApi.get(newPreselectedCustomerId!),
    enabled: props.mode === 'new' && !!newPreselectedCustomerId,
  });

  // New-mode detail for a customer selected via search
  const newCustomerDetailQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => customersApi.get(customerId!),
    enabled:
      props.mode === 'new' && !!customerId && customerId !== newPreselectedCustomerId,
  });

  // Edit-mode customer detail (driven by job.customerId)
  const editCustomerQuery = useQuery({
    queryKey: ['customer', job?.customerId],
    queryFn: () => customersApi.get(job!.customerId),
    enabled: props.mode === 'edit' && !!job,
  });

  const customerData: CustomerDto | undefined =
    props.mode === 'edit'
      ? editCustomerQuery.data
      : preselectedQuery.data ?? newCustomerDetailQuery.data;

  // Apply new-mode preselected customer once loaded
  useEffect(() => {
    if (props.mode !== 'new') return;
    if (preselectedQuery.data) {
      const c = preselectedQuery.data;
      setCustomerId(c.id);
      setCustomerDisplay(c.displayName);
      if (c.addresses[0]) {
        setAddressId(c.addresses[0].id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedQuery.data]);

  // ── Reference data ──────────────────────────────────────────────────
  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => settingsApi.listServices(false),
  });
  const teamMembersQuery = useQuery({
    queryKey: props.mode === 'edit' ? ['team-members'] : ['teamMembers'],
    queryFn: () => settingsApi.listTeamMembers(),
  });
  const services: ServiceDto[] = servicesQuery.data?.items ?? [];
  const teamMembers: TeamMemberDto[] =
    props.mode === 'new'
      ? (teamMembersQuery.data?.items ?? []).filter((t) => t.activeOnSchedule)
      : teamMembersQuery.data?.items ?? [];

  // ── Form state ──────────────────────────────────────────────────────
  const [addressId, setAddressId] = useState('');
  const [serviceRows, setServiceRows] = useState<ServiceRow[]>([
    { serviceId: null, priceCents: 0, priceDisplay: '0.00' },
  ]);
  const totalPriceCents = serviceRows.reduce((sum, r) => sum + r.priceCents, 0);
  const [privateNotes, setPrivateNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const [startAt, setStartAt] = useState(
    props.mode === 'new' ? props.preselectedStartAt ?? '' : '',
  );
  const [endAt, setEndAt] = useState(
    props.mode === 'new' ? props.preselectedEndAt ?? '' : '',
  );
  const [assigneeId, setAssigneeId] = useState<string | null>(
    props.mode === 'new' ? props.preselectedAssigneeId ?? null : null,
  );

  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRuleInput | null>(null);
  const isRecurringNew = props.mode === 'new' && recurrenceRule !== null;

  const [error, setError] = useState<string | null>(null);

  // Edit-mode init flags + scope dialog
  const [initialized, setInitialized] = useState(false);
  const [recurrenceInitialized, setRecurrenceInitialized] = useState(false);
  const [showScopeDialog, setShowScopeDialog] = useState(false);

  // Initialize edit form from job
  useEffect(() => {
    if (props.mode !== 'edit') return;
    if (job && !initialized) {
      setAddressId(job.customerAddressId);
      if (job.services && job.services.length > 0) {
        setServiceRows(
          job.services.map((s) => ({
            serviceId: s.serviceId,
            priceCents: s.priceCents,
            priceDisplay: (s.priceCents / 100).toFixed(2),
          })),
        );
      } else {
        setServiceRows([
          {
            serviceId: job.serviceId,
            priceCents: job.priceCents,
            priceDisplay: (job.priceCents / 100).toFixed(2),
          },
        ]);
      }
      setPrivateNotes(job.privateNotes ?? '');
      setTags([...job.tags]);
      setStartAt(isoToLocal(job.scheduledStartAt));
      setEndAt(isoToLocal(job.scheduledEndAt));
      setAssigneeId(job.assigneeTeamMemberId);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, initialized, props.mode]);

  const seriesData = seriesQuery.data as RecurringSeriesDto | null | undefined;
  useEffect(() => {
    if (props.mode !== 'edit') return;
    if (seriesData && !recurrenceInitialized) {
      setRecurrenceRule(seriesToRule(seriesData));
      setRecurrenceInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesData, recurrenceInitialized, props.mode]);

  // ── Derived values ──────────────────────────────────────────────────
  const scheduledDate = useMemo(() => {
    if (!startAt) return null;
    const d = new Date(startAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [startAt]);

  // ── Notes ───────────────────────────────────────────────────────────
  const [noteOps, setNoteOps] = useState<NoteOp[]>([]);

  // ── Edit-mode helpers ───────────────────────────────────────────────
  function invalidateAllEdit() {
    if (!jobId) return;
    queryClient.invalidateQueries({ queryKey: ['job', jobId] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
    queryClient.invalidateQueries({ queryKey: ['series-for-job', jobId] });
    queryClient.invalidateQueries({ queryKey: ['job-notes', jobId] });
  }

  function buildChanges() {
    // Only include schedule fields when the user actually changed them.
    // datetime-local drops sub-minute precision — re-sending the initial
    // round-tripped value drifts by seconds and the server treats it as
    // a schedule mutation, which for scope=this_and_future triggers tail
    // rematerialization and wipes replicated notes.
    const initialStart = job ? isoToLocal(job.scheduledStartAt) : '';
    const initialEnd = job ? isoToLocal(job.scheduledEndAt) : '';
    const startChanged = !!startAt && startAt !== initialStart;
    const endChanged = !!endAt && endAt !== initialEnd;
    const firstRow = serviceRows[0] ?? { serviceId: null, priceCents: 0 };
    const servicesPayload = serviceRows.map((r) => ({
      serviceId: r.serviceId,
      priceCents: r.priceCents,
    }));
    return {
      customerAddressId: addressId || undefined,
      serviceId: firstRow.serviceId,
      titleOrSummary: null,
      priceCents: totalPriceCents,
      services: servicesPayload,
      privateNotes: privateNotes.trim() || null,
      tags,
      ...(startChanged ? { scheduledStartAt: localToIso(startAt) } : {}),
      ...(endChanged ? { scheduledEndAt: localToIso(endAt) } : {}),
      assigneeTeamMemberId: assigneeId,
    };
  }

  function hasRecurrenceRuleChanged(): boolean {
    if (!seriesData || !recurrenceRule) return false;
    return JSON.stringify(seriesToRule(seriesData)) !== JSON.stringify(recurrenceRule);
  }

  // ── Mutations ───────────────────────────────────────────────────────

  // New (non-recurring + recurring)
  const createMutation = useMutation({
    mutationFn: async () => {
      if (props.mode !== 'new') throw new Error('Not new mode');
      if (!customerId) throw new Error('No customer selected');

      const servicesPayload = serviceRows.map((r) => ({
        serviceId: r.serviceId,
        priceCents: r.priceCents,
      }));
      const firstRow = serviceRows[0] ?? { serviceId: null, priceCents: 0 };

      if (isRecurringNew) {
        return recurringApi.create({
          customerId,
          job: {
            customerAddressId: addressId,
            serviceId: firstRow.serviceId || null,
            titleOrSummary: null,
            priceCents: totalPriceCents,
            privateNotes: privateNotes.trim() || null,
            tags: tags.length > 0 ? tags : undefined,
            services: servicesPayload,
            noteOps: noteOps.length > 0 ? noteOps : undefined,
          },
          schedule: {
            scheduledStartAt: new Date(startAt).toISOString(),
            scheduledEndAt: new Date(endAt).toISOString(),
            assigneeTeamMemberId: assigneeId || null,
          },
          recurrence: recurrenceRule!,
        });
      }

      return jobsApi.create(customerId, {
        customerAddressId: addressId,
        serviceId: firstRow.serviceId || null,
        titleOrSummary: null,
        priceCents: totalPriceCents,
        privateNotes: privateNotes.trim() || null,
        tags: tags.length > 0 ? tags : undefined,
        services: servicesPayload,
        scheduledStartAt: new Date(startAt).toISOString(),
        scheduledEndAt: new Date(endAt).toISOString(),
        assigneeTeamMemberId: assigneeId || null,
        noteOps: noteOps.length > 0 ? noteOps : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      const dateParam = startAt
        ? startAt.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      router.push(`/scheduler?view=day&date=${dateParam}` as Route);
    },
    onError: (err) => {
      if (err instanceof ApiClientError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Failed to create job');
    },
  });

  // Edit (non-recurring)
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error('No jobId');
      const firstRow = serviceRows[0] ?? { serviceId: null, priceCents: 0 };
      const servicesPayload = serviceRows.map((r) => ({
        serviceId: r.serviceId,
        priceCents: r.priceCents,
      }));
      await jobsApi.update(jobId, {
        customerAddressId: addressId || undefined,
        serviceId: firstRow.serviceId,
        titleOrSummary: null,
        priceCents: totalPriceCents,
        services: servicesPayload,
        privateNotes: privateNotes.trim() || null,
        tags,
        ...(noteOps.length > 0 ? { noteOps } : {}),
      });
      if (startAt && endAt) {
        await jobsApi.schedule(jobId, {
          scheduledStartAt: localToIso(startAt),
          scheduledEndAt: localToIso(endAt),
          assigneeTeamMemberId: assigneeId,
        });
      }
    },
    onSuccess: () => {
      setNoteOps([]);
      invalidateAllEdit();
      router.push('/scheduler' as Route);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update');
    },
  });

  // Edit (recurring)
  const occurrenceEditMutation = useMutation({
    mutationFn: (scope: 'this' | 'this_and_future') => {
      if (!jobId) throw new Error('No jobId');
      const body: {
        scope: 'this' | 'this_and_future';
        changes: ReturnType<typeof buildChanges>;
        recurrenceRule?: RecurrenceRuleInput;
        noteOps?: NoteOp[];
      } = { scope, changes: buildChanges() };

      if (scope === 'this_and_future' && hasRecurrenceRuleChanged() && recurrenceRule) {
        body.recurrenceRule = recurrenceRule;
      }

      if (noteOps.length > 0) {
        body.noteOps = noteOps;
      }

      return jobsApi.occurrenceEdit(jobId, body);
    },
    onSuccess: () => {
      setNoteOps([]);
      invalidateAllEdit();
      router.push('/scheduler' as Route);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update');
    },
  });

  const saving =
    createMutation.isPending ||
    updateMutation.isPending ||
    occurrenceEditMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (props.mode === 'new') {
      createMutation.mutate();
      return;
    }
    if (isRecurringEdit) {
      setShowScopeDialog(true);
    } else {
      updateMutation.mutate();
    }
  }

  function handleScopeChoice(scope: 'this' | 'this_and_future') {
    setShowScopeDialog(false);
    occurrenceEditMutation.mutate(scope);
  }

  // Start-change handler (edit): preserve duration + auto-sync weekly dow
  function onStartChange(newStartAt: string) {
    setStartAt(newStartAt);
    if (props.mode !== 'edit') return;
    const oldStart = new Date(startAt);
    const oldEnd = new Date(endAt);
    const newStart = new Date(newStartAt);
    if (
      !Number.isNaN(oldStart.getTime()) &&
      !Number.isNaN(oldEnd.getTime()) &&
      !Number.isNaN(newStart.getTime())
    ) {
      const durationMs = oldEnd.getTime() - oldStart.getTime();
      if (durationMs > 0) {
        const newEnd = new Date(newStart.getTime() + durationMs);
        const pad = (n: number) => String(n).padStart(2, '0');
        setEndAt(
          `${newEnd.getFullYear()}-${pad(newEnd.getMonth() + 1)}-${pad(newEnd.getDate())}T${pad(newEnd.getHours())}:${pad(newEnd.getMinutes())}`,
        );
      }
    }
    if (recurrenceRule?.recurrenceFrequency === 'weekly') {
      const d = new Date(newStartAt);
      if (!Number.isNaN(d.getTime())) {
        const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
        const dow = days[d.getDay()];
        if (dow) setRecurrenceRule({ ...recurrenceRule, recurrenceDayOfWeek: [dow] });
      }
    }
  }

  // ── Loading / missing states (edit) ─────────────────────────────────
  if (props.mode === 'edit' && (jobQuery.isLoading || !initialized)) {
    return <div className="px-6 py-8 text-sm text-slate-500">Loading…</div>;
  }
  if (props.mode === 'edit' && !job) {
    return <div className="px-6 py-8 text-sm text-slate-700">Job not found.</div>;
  }

  // ── Render ──────────────────────────────────────────────────────────
  const title = props.mode === 'new' ? 'New job' : `Edit ${job!.jobNumber}`;
  const containerMax = 'max-w-7xl';

  // Submit button label
  const submitLabel =
    props.mode === 'new'
      ? saving
        ? 'Creating…'
        : isRecurringNew
        ? 'Create recurring job'
        : 'Create job'
      : saving
      ? 'Saving…'
      : 'Save';

  const submitDisabled =
    saving ||
    (props.mode === 'new' && (!customerId || !addressId || !startAt || !endAt));

  return (
    <div className={`mx-auto ${containerMax} px-6 py-4`}>
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>

      {error && (
        <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form className="mt-4" onSubmit={handleSubmit}>
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(260px,320px)_1fr_1fr]">
          <NotesPanel
            notes={props.mode === 'edit' ? notesQuery.data?.notes ?? [] : []}
            noteOps={noteOps}
            setNoteOps={setNoteOps}
            saving={saving}
            loading={props.mode === 'edit' ? notesQuery.isLoading : false}
            className="lg:border-r lg:border-slate-200 lg:pr-6"
          />

          <JobDetailsColumn
            mode={props.mode}
            customerId={customerId}
            customerDisplay={customerDisplay}
            customerSearch={customerSearch}
            setCustomerSearch={setCustomerSearch}
            customerSearchItems={
              props.mode === 'new' ? customerSearchQuery.data?.items ?? [] : []
            }
            onSelectCustomer={
              props.mode === 'new'
                ? (c, addrId) => {
                    setCustomerId(c.id);
                    setCustomerDisplay(c.displayName);
                    setAddressId(addrId);
                    setCustomerSearch('');
                  }
                : () => {}
            }
            onClearCustomer={
              props.mode === 'new'
                ? () => {
                    setCustomerId(null);
                    setCustomerDisplay('');
                    setAddressId('');
                  }
                : () => {}
            }
            jobCustomerDisplayName={
              props.mode === 'edit' ? job!.customerDisplayName : null
            }
            customerData={customerData}
            addressId={addressId}
            setAddressId={setAddressId}
            services={services}
            serviceRows={serviceRows}
            setServiceRows={setServiceRows}
            teamMembers={teamMembers}
            assigneeId={assigneeId}
            setAssigneeId={setAssigneeId}
            privateNotes={privateNotes}
            setPrivateNotes={setPrivateNotes}
            tags={tags}
            setTags={setTags}
            tagInput={tagInput}
            setTagInput={setTagInput}
            saving={saving}
          />

          <div className="space-y-3">
            <ScheduleFields
              mode={props.mode}
              startAt={startAt}
              endAt={endAt}
              onStartChange={props.mode === 'edit' ? onStartChange : (v) => setStartAt(v)}
              onEndChange={(v) => setEndAt(v)}
              saving={saving}
            />
            {props.mode === 'new' ? (
              <RecurrenceEditor
                scheduledDate={scheduledDate}
                value={recurrenceRule}
                onChange={(rule) => setRecurrenceRule(rule)}
                disabled={saving}
              />
            ) : (
              isRecurringEdit &&
              (seriesQuery.isLoading && !recurrenceInitialized ? (
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
              ))
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
          <Button type="submit" disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </div>
      </form>

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

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

type JobDetailsProps = {
  mode: 'new' | 'edit';
  customerId: string | null;
  customerDisplay: string;
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  customerSearchItems: {
    id: string;
    displayName: string;
    addresses: { id: string; street: string | null; unit: string | null; city: string | null; state: string | null; zip: string | null }[];
  }[];
  onSelectCustomer: (
    c: { id: string; displayName: string },
    addressId: string,
  ) => void;
  onClearCustomer: () => void;
  jobCustomerDisplayName: string | null;
  customerData: CustomerDto | undefined;
  addressId: string;
  setAddressId: (v: string) => void;
  services: ServiceDto[];
  serviceRows: ServiceRow[];
  setServiceRows: (updater: (rows: ServiceRow[]) => ServiceRow[]) => void;
  teamMembers: TeamMemberDto[];
  assigneeId: string | null;
  setAssigneeId: (v: string | null) => void;
  privateNotes: string;
  setPrivateNotes: (v: string) => void;
  tags: string[];
  setTags: (v: string[]) => void;
  tagInput: string;
  setTagInput: (v: string) => void;
  saving: boolean;
};

function JobDetailsColumn(props: JobDetailsProps) {
  const {
    mode,
    customerId,
    customerDisplay,
    customerSearch,
    setCustomerSearch,
    customerSearchItems,
    onSelectCustomer,
    onClearCustomer,
    jobCustomerDisplayName,
    customerData,
    addressId,
    setAddressId,
    services,
    serviceRows,
    setServiceRows,
    teamMembers,
    assigneeId,
    setAssigneeId,
    privateNotes,
    setPrivateNotes,
    tags,
    setTags,
    tagInput,
    setTagInput,
    saving,
  } = props;

  return (
    <div className="space-y-3">
      {/* Customer */}
      <div>
        <Label>Customer</Label>
        {mode === 'edit' ? (
          <p className="mt-1 text-sm font-medium text-slate-900">{jobCustomerDisplayName}</p>
        ) : customerId ? (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{customerDisplay}</span>
            <Button type="button" variant="ghost" size="sm" onClick={onClearCustomer}>
              Change
            </Button>
          </div>
        ) : (
          <div className="relative mt-1">
            <Input
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Search customer by name…"
              disabled={saving}
            />
            {customerSearchItems.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {customerSearchItems.flatMap((c) => {
                  if (c.addresses.length === 0) {
                    return [
                      <button
                        key={c.id}
                        type="button"
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                        onClick={() => onSelectCustomer(c, '')}
                      >
                        <div className="font-medium text-slate-900">{c.displayName}</div>
                        <div className="text-xs text-slate-500">No address on file</div>
                      </button>,
                    ];
                  }
                  return c.addresses.map((a) => {
                    const addrLine = [a.street, a.unit, a.city, a.state, a.zip]
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <button
                        key={`${c.id}:${a.id}`}
                        type="button"
                        className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                        onClick={() => onSelectCustomer(c, a.id)}
                      >
                        <div className="font-medium text-slate-900">{c.displayName}</div>
                        <div className="text-xs text-slate-500">
                          {addrLine || 'No address details'}
                        </div>
                      </button>
                    );
                  });
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Address */}
      {(mode === 'edit' || (customerId && customerData)) && (
        <div>
          <Label>Address</Label>
          {!customerData ? (
            <p className="mt-1 text-sm text-slate-500">Loading addresses…</p>
          ) : customerData.addresses.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No addresses on file.</p>
          ) : (
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={addressId}
              onChange={(e) => setAddressId(e.target.value)}
              disabled={saving}
            >
              {mode === 'new' && <option value="">Select address…</option>}
              {customerData.addresses.map((a) => {
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
          )}
        </div>
      )}

      {/* Services */}
      <div>
        <Label>Services</Label>
        <div className="mt-1 space-y-2">
          {serviceRows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={row.serviceId ?? ''}
                onChange={(e) => {
                  const val = e.target.value || null;
                  setServiceRows((rows) =>
                    rows.map((r, i) => (i === idx ? { ...r, serviceId: val } : r)),
                  );
                }}
                disabled={saving}
              >
                <option value="">None</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Input
                className="w-28"
                type="text"
                inputMode="decimal"
                value={row.priceDisplay}
                onChange={(e) => {
                  const display = e.target.value;
                  const cents = Math.round(Number.parseFloat(display || '0') * 100);
                  setServiceRows((rows) =>
                    rows.map((r, i) =>
                      i === idx
                        ? {
                            ...r,
                            priceDisplay: display,
                            priceCents: Number.isNaN(cents) ? 0 : Math.max(0, cents),
                          }
                        : r,
                    ),
                  );
                }}
                placeholder="0.00"
                disabled={saving}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setServiceRows((rows) =>
                    rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows,
                  )
                }
                disabled={saving || serviceRows.length <= 1}
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setServiceRows((rows) => [
                ...rows,
                { serviceId: null, priceCents: 0, priceDisplay: '0.00' },
              ])
            }
            disabled={saving}
          >
            + Add service
          </Button>
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

      {/* Job notes */}
      <div>
        <Label>Job notes</Label>
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
  );
}

function ScheduleFields(props: {
  mode: 'new' | 'edit';
  startAt: string;
  endAt: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  saving: boolean;
}) {
  const { startAt, endAt, onStartChange, onEndChange, saving } = props;
  return (
    <>
      <div>
        <Label>Start</Label>
        <input
          type="datetime-local"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          value={startAt}
          onChange={(e) => onStartChange(e.target.value)}
          disabled={saving}
        />
      </div>
      <div>
        <Label>End</Label>
        <input
          type="datetime-local"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          value={endAt}
          onChange={(e) => onEndChange(e.target.value)}
          disabled={saving}
        />
      </div>
    </>
  );
}
