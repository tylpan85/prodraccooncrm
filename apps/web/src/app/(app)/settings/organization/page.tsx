'use client';

import type {
  AuthSession,
  OrganizationProfileDto,
  UpdateOrganizationProfileRequest,
} from '@openclaw/shared';
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

interface OrganizationForm {
  name: string;
  timezone: string;
  address: string;
  phone: string;
  website: string;
}

const emptyForm: OrganizationForm = {
  name: '',
  timezone: 'UTC',
  address: '',
  phone: '',
  website: '',
};

function organizationErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'INVALID_TIMEZONE') {
      return 'Choose a valid IANA timezone.';
    }
    return error.message;
  }
  return 'Could not save organization settings right now.';
}

function nullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export default function SettingsOrganizationPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OrganizationForm>(emptyForm);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const organizationQuery = useQuery({
    queryKey: ['organizations', 'current'],
    queryFn: () => settingsApi.getCurrentOrganization(),
  });

  useEffect(() => {
    if (!organizationQuery.data) return;
    setForm({
      name: organizationQuery.data.name,
      timezone: organizationQuery.data.timezone,
      address: organizationQuery.data.address ?? '',
      phone: organizationQuery.data.phone ?? '',
      website: organizationQuery.data.website ?? '',
    });
  }, [organizationQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: UpdateOrganizationProfileRequest) =>
      settingsApi.updateCurrentOrganization(payload),
    onSuccess: async (organization) => {
      setFeedback(null);
      setSaved(true);
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
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (error) => {
      setSaved(false);
      setFeedback(organizationErrorMessage(error));
    },
  });

  const organization = organizationQuery.data as OrganizationProfileDto | undefined;

  return (
    <div className="px-6 py-8">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold text-slate-900">Organization</h1>
        <p className="mt-2 text-sm text-slate-500">
          Name, timezone, and the company contact details that appear on invoices and the public
          pay page.
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
                  name: form.name.trim(),
                  timezone: form.timezone,
                  address: nullableString(form.address),
                  phone: nullableString(form.phone),
                  website: nullableString(form.website),
                });
              }}
            >
              <div>
                <Label htmlFor="organization-name">Name</Label>
                <Input
                  id="organization-name"
                  className="mt-1"
                  value={form.name}
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
                  value={form.timezone}
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

              <div className="border-t border-slate-200 pt-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Contact details
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Shown on invoice PDFs and the public pay page.
                </p>
              </div>

              <div>
                <Label htmlFor="organization-address">Address</Label>
                <textarea
                  id="organization-address"
                  className="mt-1 h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100"
                  value={form.address}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, address: event.target.value }))
                  }
                  placeholder="123 Main St, Suite 200&#10;Springfield, IL 62701"
                  disabled={saveMutation.isPending}
                />
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <Label htmlFor="organization-phone">Phone</Label>
                  <Input
                    id="organization-phone"
                    type="tel"
                    className="mt-1"
                    placeholder="(555) 123-4567"
                    value={form.phone}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, phone: event.target.value }))
                    }
                    disabled={saveMutation.isPending}
                  />
                </div>
                <div>
                  <Label htmlFor="organization-website">Website</Label>
                  <Input
                    id="organization-website"
                    type="url"
                    className="mt-1"
                    placeholder="https://example.com"
                    value={form.website}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, website: event.target.value }))
                    }
                    disabled={saveMutation.isPending}
                  />
                </div>
              </div>

              {feedback && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {feedback}
                </p>
              )}
              {saved && (
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Saved.
                </p>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={saveMutation.isPending || form.name.trim() === ''}
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
