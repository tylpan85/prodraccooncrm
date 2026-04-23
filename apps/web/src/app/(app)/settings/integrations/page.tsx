'use client';

import type {
  IntegrationKind,
  RingCentralIntegrationConfig,
  StripeIntegrationConfig,
} from '@openclaw/shared';
import {
  ringcentralIntegrationConfigSchema,
  stripeIntegrationConfigSchema,
} from '@openclaw/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { ApiClientError } from '../../../../lib/api-client';
import { settingsApi } from '../../../../lib/settings-api';

function integrationErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'INTEGRATION_NOT_CONFIGURED') {
      return 'The integration is missing required configuration.';
    }
    if (error.code === 'INTEGRATION_DISABLED') {
      return 'The integration is currently disabled.';
    }
    return error.message;
  }
  return 'Could not save integration right now.';
}

export default function SettingsIntegrationsPage() {
  return (
    <div className="px-6 py-8">
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Integrations</h1>
          <p className="mt-2 text-sm text-slate-500">
            Connect Stripe to accept online payments and RingCentral to send SMS notifications.
          </p>
        </div>

        <StripeCard />
        <RingCentralCard />
      </div>
    </div>
  );
}

function StripeCard() {
  const kind: IntegrationKind = 'stripe';
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [cfg, setCfg] = useState<StripeIntegrationConfig>({
    publishableKey: '',
    secretKey: '',
    webhookSecret: '',
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const integrationQuery = useQuery({
    queryKey: ['integrations', kind],
    queryFn: () => settingsApi.getIntegration(kind),
  });

  useEffect(() => {
    if (!integrationQuery.data) return;
    setEnabled(integrationQuery.data.enabled);
    const parsed = stripeIntegrationConfigSchema.safeParse(integrationQuery.data.config ?? {});
    if (parsed.success) setCfg(parsed.data);
  }, [integrationQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      settingsApi.updateIntegration(kind, {
        enabled,
        config: {
          publishableKey: cfg.publishableKey?.trim() ?? '',
          secretKey: cfg.secretKey?.trim() ?? '',
          webhookSecret: cfg.webhookSecret?.trim() ?? '',
        },
      }),
    onSuccess: async (data) => {
      setFeedback(null);
      setSaved(true);
      queryClient.setQueryData(['integrations', kind], data);
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => {
      setSaved(false);
      setFeedback(integrationErrorMessage(err));
    },
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Stripe</h2>
          <p className="mt-1 text-sm text-slate-500">
            Accept credit-card payments via Stripe Checkout. Customers see a “Pay with card” button on
            their invoice link.
          </p>
        </div>
        <label className="inline-flex shrink-0 items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={integrationQuery.isLoading || saveMutation.isPending}
          />
          Enabled
        </label>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <Label htmlFor="stripe-pk">Publishable key</Label>
          <Input
            id="stripe-pk"
            className="mt-1 font-mono text-xs"
            placeholder="pk_live_… or pk_test_…"
            value={cfg.publishableKey ?? ''}
            onChange={(e) => setCfg((c) => ({ ...c, publishableKey: e.target.value }))}
            disabled={saveMutation.isPending}
          />
        </div>
        <div>
          <Label htmlFor="stripe-sk">Secret key</Label>
          <Input
            id="stripe-sk"
            type="password"
            className="mt-1 font-mono text-xs"
            placeholder="sk_live_… or sk_test_…"
            value={cfg.secretKey ?? ''}
            onChange={(e) => setCfg((c) => ({ ...c, secretKey: e.target.value }))}
            disabled={saveMutation.isPending}
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-slate-500">
            Stored encrypted at rest. Never shown again after saving.
          </p>
        </div>
        <div>
          <Label htmlFor="stripe-whs">Webhook secret</Label>
          <Input
            id="stripe-whs"
            type="password"
            className="mt-1 font-mono text-xs"
            placeholder="whsec_…"
            value={cfg.webhookSecret ?? ''}
            onChange={(e) => setCfg((c) => ({ ...c, webhookSecret: e.target.value }))}
            disabled={saveMutation.isPending}
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-slate-500">
            Configure in Stripe → Developers → Webhooks. Endpoint:{' '}
            <code className="font-mono">/api/webhooks/stripe</code>. Listen for{' '}
            <code className="font-mono">payment_intent.succeeded</code> and{' '}
            <code className="font-mono">charge.succeeded</code>.
          </p>
        </div>
      </div>

      {feedback && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{feedback}</p>
      )}
      {saved && (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Saved.
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </section>
  );
}

function RingCentralCard() {
  const kind: IntegrationKind = 'ringcentral';
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [cfg, setCfg] = useState<RingCentralIntegrationConfig>({
    jwt: '',
    clientId: '',
    clientSecret: '',
    fromNumber: '',
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const integrationQuery = useQuery({
    queryKey: ['integrations', kind],
    queryFn: () => settingsApi.getIntegration(kind),
  });

  useEffect(() => {
    if (!integrationQuery.data) return;
    setEnabled(integrationQuery.data.enabled);
    const parsed = ringcentralIntegrationConfigSchema.safeParse(integrationQuery.data.config ?? {});
    if (parsed.success) setCfg(parsed.data);
  }, [integrationQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      settingsApi.updateIntegration(kind, {
        enabled,
        config: {
          jwt: cfg.jwt?.trim() ?? '',
          clientId: cfg.clientId?.trim() ?? '',
          clientSecret: cfg.clientSecret?.trim() ?? '',
          fromNumber: cfg.fromNumber?.trim() ?? '',
        },
      }),
    onSuccess: async (data) => {
      setFeedback(null);
      setSaved(true);
      queryClient.setQueryData(['integrations', kind], data);
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => {
      setSaved(false);
      setFeedback(integrationErrorMessage(err));
    },
  });

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">RingCentral SMS</h2>
          <p className="mt-1 text-sm text-slate-500">
            Send invoice pay-link texts and job reminders via RingCentral.
          </p>
        </div>
        <label className="inline-flex shrink-0 items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={integrationQuery.isLoading || saveMutation.isPending}
          />
          Enabled
        </label>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <Label htmlFor="rc-from">From number</Label>
          <Input
            id="rc-from"
            className="mt-1"
            placeholder="+15551234567"
            value={cfg.fromNumber ?? ''}
            onChange={(e) => setCfg((c) => ({ ...c, fromNumber: e.target.value }))}
            disabled={saveMutation.isPending}
          />
          <p className="mt-1 text-xs text-slate-500">
            E.164 format. Must be an SMS-enabled RingCentral number on this account.
          </p>
        </div>
        <div>
          <Label htmlFor="rc-cid">Client ID</Label>
          <Input
            id="rc-cid"
            className="mt-1 font-mono text-xs"
            value={cfg.clientId ?? ''}
            onChange={(e) => setCfg((c) => ({ ...c, clientId: e.target.value }))}
            disabled={saveMutation.isPending}
          />
        </div>
        <div>
          <Label htmlFor="rc-secret">Client secret</Label>
          <Input
            id="rc-secret"
            type="password"
            className="mt-1 font-mono text-xs"
            value={cfg.clientSecret ?? ''}
            onChange={(e) => setCfg((c) => ({ ...c, clientSecret: e.target.value }))}
            disabled={saveMutation.isPending}
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="rc-jwt">JWT</Label>
          <textarea
            id="rc-jwt"
            className="mt-1 h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100"
            placeholder="eyJhbGciOi…"
            value={cfg.jwt ?? ''}
            onChange={(e) => setCfg((c) => ({ ...c, jwt: e.target.value }))}
            disabled={saveMutation.isPending}
          />
        </div>
      </div>

      {feedback && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{feedback}</p>
      )}
      {saved && (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Saved.
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </section>
  );
}
