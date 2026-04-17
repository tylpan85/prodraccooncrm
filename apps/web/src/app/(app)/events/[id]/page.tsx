'use client';

import type { EventDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { DetailSkeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { eventsApi } from '../../../../lib/events-api';

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;
  const [error, setError] = useState<string | null>(null);

  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => eventsApi.get(id),
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: () => eventsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      router.push('/scheduler' as Route);
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Failed to delete'),
  });

  if (eventQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <DetailSkeleton />
      </div>
    );
  }
  if (eventQuery.error) {
    const notFound =
      eventQuery.error instanceof ApiClientError && eventQuery.error.code === 'EVENT_NOT_FOUND';
    return (
      <div className="px-6 py-8 text-sm text-slate-700">
        {notFound ? 'Event not found.' : 'Could not load event.'}
      </div>
    );
  }

  const event = eventQuery.data as EventDto;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{event.name ?? '(no name)'}</h1>
          <p className="mt-1 text-sm text-slate-500">Event</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/events/${event.id}/edit` as Route}>
            <Button variant="secondary">Edit</Button>
          </Link>
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm('Delete this event?')) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Details
        </h2>
        <dl className="space-y-2 text-sm">
          <Row label="Start" value={formatDatetime(event.scheduledStartAt)} />
          <Row label="End" value={formatDatetime(event.scheduledEndAt)} />
          <Row label="Assignee" value={event.assigneeDisplayName ?? 'Unassigned'} />
          <Row label="Location" value={event.location ?? '—'} />
        </dl>
      </div>

      {event.note && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notes
          </h2>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{event.note}</p>
        </div>
      )}

      <div className="mt-4">
        <Link href={'/scheduler' as Route} className="text-sm text-brand-700 hover:underline">
          Back to scheduler
        </Link>
      </div>
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
