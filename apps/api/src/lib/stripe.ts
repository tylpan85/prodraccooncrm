import { prisma } from '@openclaw/db';
import { ERROR_CODES, stripeIntegrationConfigSchema } from '@openclaw/shared';
import { ApiError } from './error-envelope.js';

// ---------------------------------------------------------------------------
// Stripe REST helpers (no SDK — talk to api.stripe.com directly).
//   Form-encoded body, bracket-notation for nested params (Stripe convention).
// ---------------------------------------------------------------------------

const STRIPE_API = 'https://api.stripe.com/v1';

export interface StripeConfig {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
}

export async function loadStripeConfig(orgId: string): Promise<StripeConfig> {
  const integration = await prisma.orgIntegration.findUnique({
    where: { organizationId_kind: { organizationId: orgId, kind: 'stripe' } },
  });
  if (!integration || !integration.enabled) {
    throw new ApiError(
      ERROR_CODES.INTEGRATION_DISABLED,
      400,
      'Stripe integration is not enabled for this organization',
    );
  }
  const cfg = stripeIntegrationConfigSchema.parse(integration.config ?? {});
  if (!cfg.secretKey || !cfg.publishableKey) {
    throw new ApiError(
      ERROR_CODES.INTEGRATION_NOT_CONFIGURED,
      400,
      'Stripe integration is missing publishable or secret key',
    );
  }
  return {
    publishableKey: cfg.publishableKey,
    secretKey: cfg.secretKey,
    webhookSecret: cfg.webhookSecret,
  };
}

function flatten(value: unknown, prefix: string, out: URLSearchParams): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}[${k}]` : k, out);
    }
    return;
  }
  out.set(prefix, String(value));
}

function encodeBody(params: Record<string, unknown>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    flatten(v, k, out);
  }
  return out.toString();
}

export async function stripeRequest<T>(
  secretKey: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
  if (body && method !== 'GET') {
    init.body = encodeBody(body);
  }
  const res = await fetch(`${STRIPE_API}${path}`, init);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      `Stripe request failed (${res.status})`;
    throw new ApiError(ERROR_CODES.STRIPE_CHARGE_FAILED, 502, message, {
      status: res.status,
      stripeError: json,
    });
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Higher-level helpers: customer / setup intent / charge
// ---------------------------------------------------------------------------

export interface StripeCustomer {
  id: string;
  email?: string | null;
}

export async function getOrCreateStripeCustomer(args: {
  secretKey: string;
  organizationId: string;
  customerId: string;
}): Promise<string> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: args.customerId },
    select: {
      id: true,
      organizationId: true,
      displayName: true,
      stripeCustomerId: true,
      emails: { select: { value: true }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
  });
  if (customer.organizationId !== args.organizationId) {
    throw new ApiError(ERROR_CODES.CUSTOMER_NOT_FOUND, 404, 'Customer not found');
  }
  if (customer.stripeCustomerId) return customer.stripeCustomerId;

  const created = await stripeRequest<StripeCustomer>(args.secretKey, 'POST', '/customers', {
    name: customer.displayName,
    email: customer.emails[0]?.value,
    metadata: {
      organizationId: args.organizationId,
      customerId: args.customerId,
    },
  });

  await prisma.customer.update({
    where: { id: args.customerId },
    data: { stripeCustomerId: created.id },
  });
  return created.id;
}

export interface StripeSetupIntent {
  id: string;
  client_secret: string;
  status: string;
  payment_method?: string | null;
  customer?: string | null;
}

export async function createSetupIntent(args: {
  secretKey: string;
  stripeCustomerId: string;
  metadata: Record<string, string>;
}): Promise<StripeSetupIntent> {
  return stripeRequest<StripeSetupIntent>(args.secretKey, 'POST', '/setup_intents', {
    customer: args.stripeCustomerId,
    payment_method_types: ['card'],
    usage: 'off_session',
    metadata: args.metadata,
  });
}

export interface StripePaymentMethod {
  id: string;
  customer?: string | null;
  card?: {
    brand?: string | null;
    last4?: string | null;
    exp_month?: number | null;
    exp_year?: number | null;
  } | null;
}

export async function getPaymentMethod(args: {
  secretKey: string;
  paymentMethodId: string;
}): Promise<StripePaymentMethod> {
  return stripeRequest<StripePaymentMethod>(
    args.secretKey,
    'GET',
    `/payment_methods/${encodeURIComponent(args.paymentMethodId)}`,
  );
}

export async function detachPaymentMethod(args: {
  secretKey: string;
  paymentMethodId: string;
}): Promise<void> {
  await stripeRequest<unknown>(
    args.secretKey,
    'POST',
    `/payment_methods/${encodeURIComponent(args.paymentMethodId)}/detach`,
  );
}

export interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  amount_received?: number;
  latest_charge?: string | null;
}

export async function createOffSessionPaymentIntent(args: {
  secretKey: string;
  amountCents: number;
  currency?: string;
  stripeCustomerId: string;
  paymentMethodId: string;
  metadata: Record<string, string>;
}): Promise<StripePaymentIntent> {
  return stripeRequest<StripePaymentIntent>(args.secretKey, 'POST', '/payment_intents', {
    amount: args.amountCents,
    currency: args.currency ?? 'usd',
    customer: args.stripeCustomerId,
    payment_method: args.paymentMethodId,
    off_session: true,
    confirm: true,
    metadata: args.metadata,
  });
}
