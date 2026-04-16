'use client';

import type { AuthSession, OrganizationDto, UpdateOrganizationRequest } from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { ApiClientError } from '../../../../lib/api-client';
import { settingsApi } from '../../../../lib/settings-api';

const timezoneOptions = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

function organizationErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'INVALID_TIMEZONE') {
      return 'Choose a valid IANA timezone.';
    }
    return error.message;
  }
  return 'Could not save organization settings right now.';
}

export default function SettingsOrganizationPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UpdateOrganizationRequest>({ name: '', timezone: 'UTC' });
  const [feedback, setFeedback] = useState<string | null>(null);

  const organizationQuery = useQuery({
    queryKey: ['organizations', 'current'],
    queryFn: () => settingsApi.getCurrentOrganization(),
  });

  useEffect(() => {
    if (!organizationQuery.data) return;
    setForm({
      name: organizationQuery.data.name,
      timezone: organizationQuery.data.timezone,
    });
  }, [organizationQuery.data]);

  const saveMutation = useMutation({
    mutationFn: settingsApi.updateCurrentOrganization,
    onSuccess: async (organization) => {
      setFeedback(null);
      queryClient.setQueryData(['organizations', 'current'], organization);
      queryClient.setQueryData<AuthSession | undefined>(['auth', 'me'], (current) =>
        current
          ? {
              ...current,
              organization: {
                ...current.organization,
                name: organization.name,
                timezone: organization.timezone,
              },
            }
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: ['organizations', 'current'] });
    },
    onError: (error) => setFeedback(organizationErrorMessage(error)),
  });

  const organization = organizationQuery.data as OrganizationDto | undefined;

  return (
    <div className="px-6 py-8">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold text-slate-900">Organization</h1>
        <p className="mt-2 text-sm text-slate-500">
          Update the organization name and default timezone.
        </p>

        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          {organizationQuery.isLoading && (
            <p className="text-sm text-slate-500">Loading organization settings…</p>
          )}

          {organization && (
            <form
              className="space-y-5"
              onSubmit={async (event) => {
                event.preventDefault();
                setFeedback(null);
                await saveMutation.mutateAsync({
                  name: form.name?.trim() ?? '',
                  timezone: form.timezone,
                });
              }}
            >
              <div>
                <Label htmlFor="organization-name">Name</Label>
                <Input
                  id="organization-name"
                  className="mt-1"
                  value={form.name ?? ''}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  disabled={saveMutation.isPending}
                />
              </div>

              <div>
                <Label htmlFor="organization-timezone">Timezone</Label>
                <select
                  id="organization-timezone"
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  value={form.timezone ?? 'UTC'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, timezone: event.target.value }))
                  }
                  disabled={saveMutation.isPending}
                >
                  {timezoneOptions.map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ))}
                </select>
              </div>

              {feedback && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {feedback}
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={saveMutation.isPending || !(form.name?.trim() ?? '')}
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Billing info
          </h2>
          <p className="mt-2 text-sm text-slate-500">(coming soon)</p>
        </div>
      </div>
    </div>
  );
}
