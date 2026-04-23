import { z } from 'zod';

// ---------------------------------------------------------------------------
// Organization profile (used as company header on invoices / pay page)
// ---------------------------------------------------------------------------

export const organizationProfileDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  timezone: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
});
export type OrganizationProfileDto = z.infer<typeof organizationProfileDtoSchema>;

export const updateOrganizationProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().min(1).optional(),
    address: z.string().trim().max(500).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    website: z.string().trim().max(255).nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.timezone !== undefined ||
      v.address !== undefined ||
      v.phone !== undefined ||
      v.website !== undefined,
    { message: 'At least one field is required' },
  );
export type UpdateOrganizationProfileRequest = z.infer<
  typeof updateOrganizationProfileRequestSchema
>;

// ---------------------------------------------------------------------------
// Payment methods (per-org catalog)
// ---------------------------------------------------------------------------

export const PAYMENT_SOURCES = ['manual', 'stripe'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const paymentMethodDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  source: z.enum(PAYMENT_SOURCES),
  referenceLabel: z.string().nullable(),
  active: z.boolean(),
  orderIndex: z.number().int(),
});
export type PaymentMethodDto = z.infer<typeof paymentMethodDtoSchema>;

export const createPaymentMethodRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  source: z.enum(PAYMENT_SOURCES).optional(),
  referenceLabel: z.string().trim().max(80).nullable().optional(),
});
export type CreatePaymentMethodRequest = z.infer<typeof createPaymentMethodRequestSchema>;

export const updatePaymentMethodRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    referenceLabel: z.string().trim().max(80).nullable().optional(),
    active: z.boolean().optional(),
    orderIndex: z.number().int().min(0).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.referenceLabel !== undefined ||
      v.active !== undefined ||
      v.orderIndex !== undefined,
    { message: 'At least one field is required' },
  );
export type UpdatePaymentMethodRequest = z.infer<typeof updatePaymentMethodRequestSchema>;

// ---------------------------------------------------------------------------
// Integrations (Stripe / RingCentral)
// ---------------------------------------------------------------------------

export const INTEGRATION_KINDS = ['stripe', 'ringcentral'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

// Stripe — keep minimal: secret key + publishable key for now.
export const stripeIntegrationConfigSchema = z.object({
  publishableKey: z.string().trim().max(200).optional().default(''),
  secretKey: z.string().trim().max(200).optional().default(''),
  webhookSecret: z.string().trim().max(200).optional().default(''),
});
export type StripeIntegrationConfig = z.infer<typeof stripeIntegrationConfigSchema>;

// RingCentral — JWT auth + the from-number used to send SMS.
export const ringcentralIntegrationConfigSchema = z.object({
  jwt: z.string().trim().max(2000).optional().default(''),
  clientId: z.string().trim().max(200).optional().default(''),
  clientSecret: z.string().trim().max(200).optional().default(''),
  fromNumber: z.string().trim().max(40).optional().default(''),
});
export type RingCentralIntegrationConfig = z.infer<
  typeof ringcentralIntegrationConfigSchema
>;

export const orgIntegrationDtoSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
});
export type OrgIntegrationDto = z.infer<typeof orgIntegrationDtoSchema>;

export const updateOrgIntegrationRequestSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateOrgIntegrationRequest = z.infer<typeof updateOrgIntegrationRequestSchema>;
