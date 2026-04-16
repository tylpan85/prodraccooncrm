'use client';

import type { CustomerDto, ServiceDto, TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { ApiClientError } from '../../../../lib/api-client';
import { customersApi } from '../../../../lib/customers-api';
import { jobsApi } from '../../../../lib/jobs-api';
import { settingsApi } from '../../../../lib/settings-api';

export default function NewJobPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedCustomerId = searchParams.get('customerId');
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

  // Load preselected customer
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
  const [titleOrSummary, setTitleOrSummary] = useState('');
  const [priceCents, setPriceCents] = useState(0);
  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [privateNotes, setPrivateNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Schedule
  const [anytime, setAnytime] = useState(true);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Auto-fill title from service
  function onServiceChange(sid: string | null) {
    setServiceId(sid);
    if (sid) {
      const svc = services.find((s) => s.id === sid);
      if (svc && !titleOrSummary) setTitleOrSummary(svc.name);
    }
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('No customer selected');
      return jobsApi.create(customerId, {
        customerAddressId: addressId,
        serviceId: serviceId || null,
        titleOrSummary: titleOrSummary.trim() || null,
        priceCents,
        privateNotes: privateNotes.trim() || null,
        tags: tags.length > 0 ? tags : undefined,
        scheduledStartAt: !anytime && startAt ? `${startAt}:00.000Z` : null,
        scheduledEndAt: !anytime && endAt ? `${endAt}:00.000Z` : null,
        assigneeTeamMemberId: !anytime && assigneeId ? assigneeId : null,
      });
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      router.push(`/jobs/${job.id}` as Route);
    },
    onError: (err) => {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to create job');
      }
    },
  });

  const saving = createMutation.isPending;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">New job</h1>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          createMutation.mutate();
        }}
      >
        {/* ── Customer ──────────────────────────────────────────────── */}
        <Section title="Customer">
          {customerId ? (
            <div className="flex items-center gap-2">
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
            <div className="relative">
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
        </Section>

        {/* ── Address ───────────────────────────────────────────────── */}
        {customerId && customerData && (
          <Section title="Address">
            {customerData.addresses.length === 0 ? (
              <p className="text-sm text-slate-500">No addresses on file for this customer.</p>
            ) : (
              <select
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
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
          </Section>
        )}

        {/* ── Service + Price ───────────────────────────────────────── */}
        <Section title="Service & Price">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Service (optional)</Label>
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                value={serviceId ?? ''}
                onChange={(e) => onServiceChange(e.target.value || null)}
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

        {/* ���─ Title / Notes / Tags ──────────────────────────────────── */}
        <Section title="Details">
          <div className="space-y-4">
            <div>
              <Label>Title / Summary</Label>
              <Input
                className="mt-1"
                value={titleOrSummary}
                onChange={(e) => setTitleOrSummary(e.target.value)}
                maxLength={255}
                disabled={saving}
              />
            </div>
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

        {/* ── Schedule ──────────────────────────────────────────────── */}
        <Section title="Schedule">
          <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={anytime}
              onChange={(e) => setAnytime(e.target.checked)}
              disabled={saving}
            />
            Anytime (unscheduled)
          </label>
          {!anytime && (
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
          )}
        </Section>

        {/* ── Actions ───────────────────────────────────────────────── */}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !customerId || !addressId}>
            {saving ? 'Creating…' : 'Create job'}
          </Button>
        </div>
      </form>
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
