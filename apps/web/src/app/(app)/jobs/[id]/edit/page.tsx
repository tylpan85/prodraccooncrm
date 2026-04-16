'use client';

import type { CustomerDto, JobDto, ServiceDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { ApiClientError } from '../../../../../lib/api-client';
import { customersApi } from '../../../../../lib/customers-api';
import { jobsApi } from '../../../../../lib/jobs-api';
import { settingsApi } from '../../../../../lib/settings-api';

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

  const job = jobQuery.data as JobDto | undefined;

  const customerQuery = useQuery({
    queryKey: ['customer', job?.customerId],
    queryFn: () => customersApi.get(job!.customerId),
    enabled: !!job,
  });

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [titleOrSummary, setTitleOrSummary] = useState('');
  const [priceCents, setPriceCents] = useState(0);
  const [priceDisplay, setPriceDisplay] = useState('0.00');
  const [addressId, setAddressId] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (job && !initialized) {
      setServiceId(job.serviceId);
      setTitleOrSummary(job.titleOrSummary ?? '');
      setPriceCents(job.priceCents);
      setPriceDisplay((job.priceCents / 100).toFixed(2));
      setAddressId(job.customerAddressId);
      setPrivateNotes(job.privateNotes ?? '');
      setTags([...job.tags]);
      setInitialized(true);
    }
  }, [job, initialized]);

  const services: ServiceDto[] = servicesQuery.data?.items ?? [];
  const customer: CustomerDto | undefined = customerQuery.data;

  const updateMutation = useMutation({
    mutationFn: () =>
      jobsApi.update(id, {
        customerAddressId: addressId || undefined,
        serviceId: serviceId,
        titleOrSummary: titleOrSummary.trim() || null,
        priceCents,
        privateNotes: privateNotes.trim() || null,
        tags,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      router.push(`/jobs/${id}` as Route);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update');
    },
  });

  const saving = updateMutation.isPending;

  if (jobQuery.isLoading) {
    return <div className="px-6 py-8 text-sm text-slate-500">Loading…</div>;
  }
  if (!job) {
    return <div className="px-6 py-8 text-sm text-slate-700">Job not found.</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">Edit {job.jobNumber}</h1>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          updateMutation.mutate();
        }}
      >
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
