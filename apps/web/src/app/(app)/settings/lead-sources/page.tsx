'use client';

import type { LeadSourceDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Skeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { settingsApi } from '../../../../lib/settings-api';

function leadSourceErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'LEAD_SOURCE_DUPLICATE') {
      return 'Lead source names must be unique within the organization.';
    }
    return error.message;
  }
  return 'Could not save lead sources right now.';
}

export default function SettingsLeadSourcesPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ['lead-sources', 'settings'],
    queryFn: () => settingsApi.listLeadSources(true).then((result) => result.items),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['lead-sources'] });

  const createMutation = useMutation({
    mutationFn: (name: string) => settingsApi.createLeadSource({ name }),
    onSuccess: async () => {
      setNewName('');
      setFeedback(null);
      await invalidate();
    },
    onError: (error) => setFeedback(leadSourceErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Pick<LeadSourceDto, 'name' | 'active'>> }) =>
      settingsApi.updateLeadSource(id, payload),
    onSuccess: async () => {
      setEditingId(null);
      setEditingName('');
      setFeedback(null);
      await invalidate();
    },
    onError: (error) => setFeedback(leadSourceErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteLeadSource(id),
    onSuccess: async () => {
      setFeedback(null);
      await invalidate();
    },
    onError: (error) => setFeedback(leadSourceErrorMessage(error)),
  });

  const sources = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data]);
  const busyId = (updateMutation.variables as { id?: string } | undefined)?.id;

  function startRename(source: LeadSourceDto) {
    setEditingId(source.id);
    setEditingName(source.name);
    setFeedback(null);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      setFeedback('Lead source name is required.');
      return;
    }
    await createMutation.mutateAsync(name);
  }

  async function handleRename(sourceId: string) {
    const name = editingName.trim();
    if (!name) {
      setFeedback('Lead source name is required.');
      return;
    }
    await updateMutation.mutateAsync({ id: sourceId, payload: { name } });
  }

  async function handleDelete(source: LeadSourceDto) {
    setFeedback(null);
    if (!window.confirm(`Delete "${source.name}"?`)) return;
    await deleteMutation.mutateAsync(source.id);
  }

  return (
    <div className="px-6 py-8">
      <div className="max-w-5xl">
        <h1 className="text-xl font-semibold text-slate-900">Lead Sources</h1>
        <p className="mt-2 text-sm text-slate-500">
          Manage the lead source options shown on the customer form.
        </p>

        <form
          className="mt-6 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-end"
          onSubmit={handleCreate}
        >
          <div className="flex-1">
            <label htmlFor="new-lead-source-name" className="block text-sm font-medium text-slate-700">
              Add lead source
            </label>
            <Input
              id="new-lead-source-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Google Ads"
              className="mt-1"
              disabled={createMutation.isPending}
            />
          </div>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Adding…' : 'Add'}
          </Button>
        </form>

        {feedback && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{feedback}</p>
        )}

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sourcesQuery.isLoading &&
                Array.from({ length: 3 }, (_, i) => (
                  <tr key={`skel-${i}`}>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-32" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
                  </tr>
                ))}

              {!sourcesQuery.isLoading && sources.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-sm text-slate-500">
                    No lead sources yet.
                  </td>
                </tr>
              )}

              {sources.map((source) => {
                const rowBusy =
                  (deleteMutation.isPending && deleteMutation.variables === source.id) ||
                  (updateMutation.isPending && busyId === source.id);

                return (
                  <tr key={source.id} className="align-top">
                    <td className="px-4 py-3">
                      {editingId === source.id ? (
                        <div className="flex gap-2">
                          <Input
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            disabled={rowBusy}
                          />
                          <Button size="sm" disabled={rowBusy} onClick={() => handleRename(source.id)}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() => { setEditingId(null); setEditingName(''); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="text-sm font-medium text-slate-900">{source.name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          source.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {source.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {editingId !== source.id && (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" disabled={rowBusy} onClick={() => startRename(source)}>
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={rowBusy}
                            onClick={() => updateMutation.mutate({ id: source.id, payload: { active: !source.active } })}
                          >
                            {source.active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button size="sm" variant="danger" disabled={rowBusy} onClick={() => handleDelete(source)}>
                            Delete
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
