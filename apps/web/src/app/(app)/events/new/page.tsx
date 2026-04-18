'use client';

import type { TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { ApiClientError } from '../../../../lib/api-client';
import { eventsApi } from '../../../../lib/events-api';
import { settingsApi } from '../../../../lib/settings-api';

export default function NewEventPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

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
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      eventsApi.create({
        name: name.trim() || null,
        note: note.trim() || null,
        location: location.trim() || null,
        scheduledStartAt: new Date(startAt).toISOString(),
        scheduledEndAt: new Date(endAt).toISOString(),
        assigneeTeamMemberId: assigneeId,
      }),
    onSuccess: (event) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      router.push(`/events/${event.id}` as Route);
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : 'Failed to create event');
    },
  });

  const saving = createMutation.isPending;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900">New event</h1>

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
        <div>
          <Label>Name</Label>
          <Input
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            placeholder="Event name (optional)"
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

        <div>
          <Label>Location</Label>
          <Input
            className="mt-1"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={500}
            placeholder="Optional"
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
            {saving ? 'Creating…' : 'Create event'}
          </Button>
        </div>
      </form>
    </div>
  );
}
