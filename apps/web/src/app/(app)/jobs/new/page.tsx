'use client';

import type { CustomerDto, RecurrenceRuleInput, ServiceDto, TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { RecurrenceEditor } from '../../../../components/common/recurrence-editor';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { ApiClientError } from '../../../../lib/api-client';
import { customersApi } from '../../../../lib/customers-api';
import { jobsApi } from '../../../../lib/jobs-api';
import { recurringApi } from '../../../../lib/recurring-api';
import { settingsApi } from '../../../../lib/settings-api';

export default function NewJobPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedCustomerId = searchParams.get('customerId');
  const preselectedStartAt = searchParams.get('scheduledStartAt') ?? '';
  const preselectedEndAt = searchParams.get('scheduledEndAt') ?? '';
  const preselectedAssigneeId = searchParams.get('assigneeTeamMemberId');
  const queryClient = useQueryClient();

  // ── Customer search ─────────────────────────────────────────────────
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(preselectedCustomerId);
  const [customerDisplay, setCustomerDisplay] = useState('');

  const customerSearchQuery = useQuery({
    queryKey: ['customers', customerSearch],
    queryFn: () => customersApi.list({ q: customerSearch, limit: 10 }),
    enabled: customerSearch.trim().length > 1 && !customerId,
  });

  const preselectedQuery = useQuery({
    queryKey: ['customer', preselectedCustomerId],
    queryFn: () => customersApi.get(preselectedCustomerId!),
    enabled: !!preselectedCustomerId,
  });

  useEffect(() => {
    if (preselectedQuery.data) {
      const c = preselectedQuery.data;
      setCustomerId(c.id);
      setCustomerDisplay(c.displayName);
      if (c.addresses[0]) {
        setAddressId(c.addresses[0].id);
      }
    }
  }, [preselectedQuery.data]);

  // ── Address ─────────────────────────────────────────────────────────
  const [addressId, setAddressId] = useState<string>('');

  const customerDetailQuery = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => customersApi.get(customerId!),
    enabled: !!customerId && customerId !== preselectedCustomerId,
  });

  const customerData: CustomerDto | undefined = preselectedQuery.data ?? customerDetailQuery.data;

  // ── Services + team members ─────────────────────────────────────────
  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => settingsApi.listServices(false),
  });
  const teamMembersQuery = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => settingsApi.listTeamMembers(),
  });

  const services: ServiceDto[] = servicesQuery.data?.items ?? [];
  const teamMembers: TeamMemberDto[] = (teamMembersQuery.data?.items ?? []).filter(
    (t) => t.activeOnSchedule,
  );

  // ── Form state ──────────────────────────────────────────────────────
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [priceCents, setPriceCents] = useState(0);
  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [privateNotes, setPrivateNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Schedule — always visible, empty = unscheduled
  const [startAt, setStartAt] = useState(preselectedStartAt);
  const [endAt, setEndAt] = useState(preselectedEndAt);
  const [assigneeId, setAssigneeId] = useState<string | null>(preselectedAssigneeId);

  // Recurrence
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRuleInput | null>(null);
  const isRecurring = recurrenceRule !== null;
  const isScheduled = startAt !== '' && endAt !== '';

  // Derive scheduled date for preset labels
  const scheduledDate = useMemo(() => {
    if (!startAt) return null;
    const d = new Date(startAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [startAt]);

  const [error, setError] = useState<string | null>(null);

  // ── Submit ──────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('No customer selected');

      if (isRecurring) {
        if (!isScheduled) throw new Error('Start and end times are required for recurring jobs');
        return recurringApi.create({
          customerId,
          job: {
            customerAddressId: addressId,
            serviceId: serviceId || null,
            titleOrSummary: null,
            priceCents,
            privateNotes: privateNotes.trim() || null,
            tags: tags.length > 0 ? tags : undefined,
          },
          schedule: {
            scheduledStartAt: new Date(startAt).toISOString(),
            scheduledEndAt: new Date(endAt).toISOString(),
            assigneeTeamMemberId: assigneeId || null,
          },
          recurrence: recurrenceRule,
        });
      }

      return jobsApi.create(customerId, {
        customerAddressId: addressId,
        serviceId: serviceId || null,
        titleOrSummary: null,
        priceCents,
        privateNotes: privateNotes.trim() || null,
        tags: tags.length > 0 ? tags : undefined,
        scheduledStartAt: isScheduled ? new Date(startAt).toISOString() : null,
        scheduledEndAt: isScheduled ? new Date(endAt).toISOString() : null,
        assigneeTeamMemberId: isScheduled && assigneeId ? assigneeId : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      // Navigate to scheduler on the scheduled date, or today
      const dateParam = startAt ? startAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
      router.push(`/scheduler?view=day&date=${dateParam}` as Route);
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create job');
      }
    },
  });

  const saving = createMutation.isPending;

  return (
    <div className="mx-auto max-w-5xl px-6 py-4">
      <h1 className="text-xl font-semibold text-slate-900">New job</h1>

      {error && (
        <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          createMutation.mutate();
        }}
      >
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {/* ── Left column: job details ───────────────────────── */}
          <div className="space-y-3">
            {/* Customer */}
            <div>
              <Label>Customer</Label>
              {customerId ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{customerDisplay}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCustomerId(null);
                      setCustomerDisplay('');
                      setAddressId('');
                    }}
                  >
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
                  {customerSearchQuery.data && customerSearchQuery.data.items.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
                      {customerSearchQuery.data.items.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                          onClick={() => {
                            setCustomerId(c.id);
                            setCustomerDisplay(c.displayName);
                            setCustomerSearch('');
                          }}
                        >
                          {c.displayName}
                          {c.city && <span className="ml-2 text-xs text-slate-500">{c.city}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Address */}
            {customerId && customerData && (
              <div>
                <Label>Address</Label>
                {customerData.addresses.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">No addresses on file.</p>
                ) : (
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={addressId}
                    onChange={(e) => setAddressId(e.target.value)}
                    disabled={saving}
                  >
                    <option value="">Select address…</option>
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
                onChange={(e) => setStartAt(e.target.value)}
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

            <RecurrenceEditor
              scheduledDate={scheduledDate}
              value={recurrenceRule}
              onChange={(rule) => setRecurrenceRule(rule)}
              disabled={saving}
            />

            {!isScheduled && (
              <p className="text-xs text-slate-500">
                Leave dates empty to create an unscheduled job.
              </p>
            )}
            {isRecurring && !isScheduled && (
              <p className="text-xs text-amber-600">
                Start and end times are required for recurring jobs.
              </p>
            )}
          </div>
        </div>

        {/* ── Actions ─────────────────────────────────────────── */}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving || !customerId || !addressId || (isRecurring && !isScheduled)}
          >
            {saving ? 'Creating…' : isRecurring ? 'Create recurring job' : 'Create job'}
          </Button>
        </div>
      </form>
    </div>
  );
}
