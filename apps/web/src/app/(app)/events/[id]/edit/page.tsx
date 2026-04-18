'use client';

import type { TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import { ApiClientError } from '../../../../../lib/api-client';
import { eventsApi } from '../../../../../lib/events-api';
import { settingsApi } from '../../../../../lib/settings-api';

function toLocal(iso: string): string {
  return iso.slice(0, 16);
}

export default function EditEventPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = params.id;

  const eventQuery = useQuery({
    queryKey: ['event', id],
    queryFn: () => eventsApi.get(id),
    retry: false,
  });

  const teamMembersQuery = useQuery({
    queryKey: ['teamMembers'],
    queryFn: () => settingsApi.listTeamMembers(),
  });

  const teamMembers: TeamMemberDto[] = (teamMembersQuery.data?.items ?? []).filter(
    (t) => t.activeOnSchedule,
  );

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [location, setLocation] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (eventQuery.data && !loaded) {
      const e = eventQuery.data;
      setName(e.name ?? '');
      setNote(e.note ?? '');
      setLocation(e.location ?? '');
      setStartAt(toLocal(e.scheduledStartAt));
      setEndAt(toLocal(e.scheduledEndAt));
      setAssigneeId(e.assigneeTeamMemberId ?? '');
      setLoaded(true);
    }
  }, [eventQuery.data, loaded]);

  const updateMutation = useMutation({
    mutationFn: () =>
      eventsApi.update(id, {
        name: name.trim() || null,
        note: note.trim() || null,
        location: location.trim() || null,
        scheduledStartAt: new Date(startAt).toISOString(),
        scheduledEndAt: new Date(endAt).toISOString(),
        assigneeTeamMemberId: assigneeId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', id] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      router.push(`/events/${id}` as Route);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Failed to update event');
    },
  });

  if (eventQuery.isLoading) {
    return <div className="px-6 py-8 text-sm text-slate-500">Loading event…</div>;
  }
  if (eventQuery.error) {
    return <div className="px-6 py-8 text-sm text-slate-700">Could not load event.</div>;
  }

  const saving = updateMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">Edit event</h1>

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
        <div>
          <Label>Name</Label>
          <Input
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            disabled={saving}
          />
        </div>

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
        </div>

        <div>
          <Label>Assign to</Label>
          <select
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
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

        <div>
          <Label>Location</Label>
          <Input
            className="mt-1"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={500}
            disabled={saving}
          />
        </div>

        <div>
          <Label>Notes</Label>
          <textarea
            className="mt-1 min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={10000}
            disabled={saving}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !startAt || !endAt}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}
