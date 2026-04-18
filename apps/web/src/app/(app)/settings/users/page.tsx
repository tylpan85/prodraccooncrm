'use client';

import type { SettingsUserDto } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Skeleton } from '../../../../components/ui/skeleton';
import { ApiClientError } from '../../../../lib/api-client';
import { settingsApi } from '../../../../lib/settings-api';

function userErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'USER_DUPLICATE') {
      return 'A user with this email already exists.';
    }
    if (error.code === 'FORBIDDEN') {
      return 'You cannot archive your own account.';
    }
    return error.message;
  }
  return 'Could not complete action right now.';
}

type Tab = 'active' | 'archived';

export default function SettingsUsersPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('active');
  const [feedback, setFeedback] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');
  const [showAddForm, setShowAddForm] = useState(false);

  const activeQuery = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => settingsApi.listUsers(false).then((r) => r.items),
  });

  const archivedQuery = useQuery({
    queryKey: ['users', 'archived'],
    queryFn: () => settingsApi.listUsers(true).then((r) => r.items),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['users'] });

  const createMutation = useMutation({
    mutationFn: () =>
      settingsApi.createUser({ email: newEmail.trim().toLowerCase(), password: newPassword, role: newRole }),
    onSuccess: async () => {
      setNewEmail('');
      setNewPassword('');
      setNewRole('member');
      setShowAddForm(false);
      setFeedback(null);
      await invalidate();
    },
    onError: (error) => setFeedback(userErrorMessage(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => settingsApi.archiveUser(id),
    onSuccess: async () => { setFeedback(null); await invalidate(); },
    onError: (error) => setFeedback(userErrorMessage(error)),
  });

  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => settingsApi.unarchiveUser(id),
    onSuccess: async () => { setFeedback(null); await invalidate(); },
    onError: (error) => setFeedback(userErrorMessage(error)),
  });

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newEmail.trim()) { setFeedback('Email is required.'); return; }
    if (!newPassword) { setFeedback('Password is required.'); return; }
    await createMutation.mutateAsync();
  }

  const query = tab === 'active' ? activeQuery : archivedQuery;
  const users = query.data ?? [];

  function UserRow({ user }: { user: SettingsUserDto }) {
    const busy =
      (archiveMutation.isPending && archiveMutation.variables === user.id) ||
      (unarchiveMutation.isPending && unarchiveMutation.variables === user.id);

    return (
      <tr key={user.id}>
        <td className="px-4 py-3 text-sm text-slate-900">{user.email}</td>
        <td className="px-4 py-3">
          <span className="inline-flex rounded-full px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 capitalize">
            {user.role}
          </span>
        </td>
        <td className="px-4 py-3">
          {user.mustResetPassword && (
            <span className="text-xs text-amber-700">Password reset pending</span>
          )}
        </td>
        <td className="px-4 py-3">
          {tab === 'active' ? (
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => archiveMutation.mutate(user.id)}
            >
              Archive
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => unarchiveMutation.mutate(user.id)}
            >
              Restore
            </Button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="px-6 py-8">
      <div className="max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Users</h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage who has access to your organization.
            </p>
          </div>
          <Button onClick={() => { setShowAddForm((v) => !v); setFeedback(null); }}>
            {showAddForm ? 'Cancel' : 'Add User'}
          </Button>
        </div>

        {showAddForm && (
          <form
            className="mt-6 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
            onSubmit={handleCreate}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">Email</label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="mt-1"
                  disabled={createMutation.isPending}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Password</label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="mt-1"
                  disabled={createMutation.isPending}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'admin' | 'member')}
                  disabled={createMutation.isPending}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Adding…' : 'Add User'}
              </Button>
            </div>
          </form>
        )}

        {feedback && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{feedback}</p>
        )}

        <div className="mt-6 flex gap-4 border-b border-slate-200">
          {(['active', 'archived'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setFeedback(null); }}
              className={`-mb-px border-b-2 pb-3 text-sm font-medium capitalize ${
                tab === t
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {query.isLoading &&
                Array.from({ length: 3 }, (_, i) => (
                  <tr key={`skel-${i}`}>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
                  </tr>
                ))}

              {!query.isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-slate-500">
                    No {tab} users.
                  </td>
                </tr>
              )}

              {users.map((user) => (
                <UserRow key={user.id} user={user} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
