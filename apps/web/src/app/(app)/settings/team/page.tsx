'use client';

import type { CreateTeamMemberRequest, TeamMemberDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Skeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { settingsApi } from '../../../../lib/settings-api';

const presetColors = [
  '#0f766e',
  '#0ea5e9',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#be185d',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#65a30d',
  '#15803d',
  '#475569',
];

type TeamFormState = {
  displayName: string;
  initials: string;
  color: string;
  activeOnSchedule: boolean;
};

const emptyForm: TeamFormState = {
  displayName: '',
  initials: '',
  color: presetColors[0] ?? '#0f766e',
  activeOnSchedule: true,
};

function teamErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'TEAM_MEMBER_IN_USE') {
      return 'This team member is assigned to jobs or events. Deactivate them instead.';
    }
    return error.message;
  }
  return 'Could not save the team member right now.';
}

function getAvatarText(member: TeamMemberDto) {
  return member.initials && member.initials.length > 0
    ? member.initials
    : member.displayName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('');
}

function TeamMemberDialog({
  mode,
  initialValue,
  saving,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initialValue: TeamFormState;
  saving: boolean;
  onClose: () => void;
  onSubmit: (value: CreateTeamMemberRequest) => Promise<void>;
}) {
  const [form, setForm] = useState<TeamFormState>(initialValue);

  useEffect(() => {
    setForm(initialValue);
  }, [initialValue]);

  async function handleSubmit() {
    await onSubmit({
      displayName: form.displayName,
      initials: form.initials.trim() ? form.initials.trim() : null,
      color: form.color,
      activeOnSchedule: form.activeOnSchedule,
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {mode === 'create' ? 'Add team member' : 'Edit team member'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose the name, initials, color, and scheduler visibility.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Close
          </Button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="team-display-name">Display name</Label>
            <Input
              id="team-display-name"
              className="mt-1"
              value={form.displayName}
              onChange={(event) =>
                setForm((current) => ({ ...current, displayName: event.target.value }))
              }
              maxLength={80}
              disabled={saving}
            />
          </div>

          <div>
            <Label htmlFor="team-initials">Initials</Label>
            <Input
              id="team-initials"
              className="mt-1"
              value={form.initials}
              onChange={(event) =>
                setForm((current) => ({ ...current, initials: event.target.value.toUpperCase() }))
              }
              maxLength={4}
              placeholder="Auto"
              disabled={saving}
            />
            <p className="mt-1 text-xs text-slate-500">
              Leave blank to auto-generate from the name.
            </p>
          </div>

          <div>
            <Label htmlFor="team-color-picker">Color</Label>
            <div className="mt-1 flex items-center gap-3">
              <input
                id="team-color-picker"
                type="color"
                className="h-10 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1"
                value={form.color}
                onChange={(event) =>
                  setForm((current) => ({ ...current, color: event.target.value }))
                }
                disabled={saving}
              />
              <Input
                value={form.color}
                onChange={(event) =>
                  setForm((current) => ({ ...current, color: event.target.value }))
                }
                disabled={saving}
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <Label>Preset swatches</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {presetColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`h-8 w-8 rounded-full border-2 ${
                    form.color.toLowerCase() === color.toLowerCase()
                      ? 'border-slate-900'
                      : 'border-white shadow-sm ring-1 ring-slate-200'
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => setForm((current) => ({ ...current, color }))}
                  aria-label={`Choose ${color}`}
                  disabled={saving}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={form.activeOnSchedule}
              onChange={(event) =>
                setForm((current) => ({ ...current, activeOnSchedule: event.target.checked }))
              }
              disabled={saving}
            />
            Active on schedule
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              saving ||
              form.displayName.trim().length === 0 ||
              !/^#[0-9a-fA-F]{6}$/.test(form.color)
            }
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create member' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsTeamPage() {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editingMember, setEditingMember] = useState<TeamMemberDto | null>(null);

  const teamQuery = useQuery({
    queryKey: ['team-members'],
    queryFn: () => settingsApi.listTeamMembers().then((result) => result.items),
  });

  const invalidateTeam = () =>
    queryClient.invalidateQueries({
      queryKey: ['team-members'],
    });

  const createMutation = useMutation({
    mutationFn: settingsApi.createTeamMember,
    onSuccess: async () => {
      setDialogMode(null);
      setFeedback(null);
      await invalidateTeam();
    },
    onError: (error) => setFeedback(teamErrorMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateTeamMemberRequest> }) =>
      settingsApi.updateTeamMember(id, payload),
    onSuccess: async () => {
      setDialogMode(null);
      setEditingMember(null);
      setFeedback(null);
      await invalidateTeam();
    },
    onError: (error) => setFeedback(teamErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settingsApi.deleteTeamMember(id),
    onSuccess: async () => {
      setFeedback(null);
      await invalidateTeam();
    },
    onError: (error) => setFeedback(teamErrorMessage(error)),
  });

  const members = useMemo(() => teamQuery.data ?? [], [teamQuery.data]);
  const deletingId = deleteMutation.variables;
  const updatingId = (updateMutation.variables as { id?: string } | undefined)?.id;

  async function handleDelete(member: TeamMemberDto) {
    setFeedback(null);
    if (!window.confirm(`Delete ${member.displayName}?`)) return;
    await deleteMutation.mutateAsync(member.id);
  }

  return (
    <div className="px-6 py-8">
      <div className="max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Team</h1>
            <p className="mt-2 text-sm text-slate-500">
              Manage scheduler assignees, colors, and schedule visibility.
            </p>
          </div>
          <Button
            onClick={() => {
              setDialogMode('create');
              setEditingMember(null);
              setFeedback(null);
            }}
          >
            Add team member
          </Button>
        </div>

        {feedback && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{feedback}</p>
        )}

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Avatar</th>
                <th className="px-4 py-3 font-medium">Display name</th>
                <th className="px-4 py-3 font-medium">Active on schedule</th>
                <th className="px-4 py-3 font-medium">Color</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {teamQuery.isLoading &&
                Array.from({ length: 3 }, (_, i) => (
                  <tr key={`skel-${i}`}>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-10" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-5 w-5 rounded-full" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  </tr>
                ))}

              {!teamQuery.isLoading && members.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-sm text-slate-500">
                    No team members yet.
                  </td>
                </tr>
              )}

              {members.map((member) => {
                const rowBusy =
                  deletingId === member.id ||
                  (updateMutation.isPending && updatingId === member.id);

                return (
                  <tr key={member.id}>
                    <td className="px-4 py-3">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
                        style={{ backgroundColor: member.color }}
                      >
                        {getAvatarText(member)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {member.displayName}
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          checked={member.activeOnSchedule}
                          onChange={(event) =>
                            updateMutation.mutate({
                              id: member.id,
                              payload: { activeOnSchedule: event.target.checked },
                            })
                          }
                          disabled={rowBusy}
                        />
                        {member.activeOnSchedule ? 'Active' : 'Inactive'}
                      </label>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-slate-700">
                        <span
                          className="inline-block h-6 w-6 rounded-full border border-slate-200"
                          style={{ backgroundColor: member.color }}
                        />
                        {member.color}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={rowBusy}
                          onClick={() => {
                            setEditingMember(member);
                            setDialogMode('edit');
                            setFeedback(null);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={rowBusy}
                          onClick={() => handleDelete(member)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {dialogMode === 'create' && (
        <TeamMemberDialog
          mode="create"
          initialValue={emptyForm}
          saving={createMutation.isPending}
          onClose={() => setDialogMode(null)}
          onSubmit={async (payload) => {
            await createMutation.mutateAsync(payload);
          }}
        />
      )}

      {dialogMode === 'edit' && editingMember && (
        <TeamMemberDialog
          mode="edit"
          initialValue={{
            displayName: editingMember.displayName,
            initials: editingMember.initials ?? '',
            color: editingMember.color,
            activeOnSchedule: editingMember.activeOnSchedule,
          }}
          saving={updateMutation.isPending}
          onClose={() => {
            setDialogMode(null);
            setEditingMember(null);
          }}
          onSubmit={async (payload) => {
            await updateMutation.mutateAsync({ id: editingMember.id, payload });
          }}
        />
      )}
    </div>
  );
}
