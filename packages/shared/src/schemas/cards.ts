import { z } from 'zod';

// ---------------------------------------------------------------------------
// Saved cards (Stripe PaymentMethods cached on the customer)
// ---------------------------------------------------------------------------

export const customerPaymentMethodDtoSchema = z.object({
  id: z.string().uuid(),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  expMonth: z.number().int().nullable(),
  expYear: z.number().int().nullable(),
  isDefault: z.boolean(),
  createdAt: z.string(),
});
export type CustomerPaymentMethodDto = z.infer<typeof customerPaymentMethodDtoSchema>;

// ---------------------------------------------------------------------------
// Setup intent (admin "Add card" inline flow)
//   API returns publishableKey + clientSecret; the form mounts Stripe Elements,
//   confirms the SetupIntent client-side, and the webhook persists the PM.
// ---------------------------------------------------------------------------

export const createSetupIntentResponseSchema = z.object({
  publishableKey: z.string(),
  clientSecret: z.string(),
  setupIntentId: z.string(),
});
export type CreateSetupIntentResponse = z.infer<typeof createSetupIntentResponseSchema>;

// ---------------------------------------------------------------------------
// Card requests (tokenized self-serve link)
// ---------------------------------------------------------------------------

export const CARD_REQUEST_STATUSES = ['pending', 'completed', 'expired'] as const;
export type CardRequestStatus = (typeof CARD_REQUEST_STATUSES)[number];

export const customerCardRequestDtoSchema = z.object({
  id: z.string().uuid(),
  token: z.string(),
  status: z.enum(CARD_REQUEST_STATUSES),
  expiresAt: z.string(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  publicUrl: z.string(),
});
export type CustomerCardRequestDto = z.infer<typeof customerCardRequestDtoSchema>;

// ---------------------------------------------------------------------------
// Public card-request endpoints (anonymous, by token)
// ---------------------------------------------------------------------------

export const publicCardRequestDtoSchema = z.object({
  status: z.enum(CARD_REQUEST_STATUSES),
  expiresAt: z.string(),
  customerDisplayName: z.string().nullable(),
  companyName: z.string(),
  companyPhone: z.string().nullable(),
  companyWebsite: z.string().nullable(),
});
export type PublicCardRequestDto = z.infer<typeof publicCardRequestDtoSchema>;

export const publicCardSetupIntentResponseSchema = z.object({
  publishableKey: z.string(),
  clientSecret: z.string(),
  setupIntentId: z.string(),
});
export type PublicCardSetupIntentResponse = z.infer<typeof publicCardSetupIntentResponseSchema>;

// ---------------------------------------------------------------------------
// Charge a saved card against an invoice (off_session PaymentIntent)
// ---------------------------------------------------------------------------

export const chargeSavedCardRequestSchema = z.object({
  paymentMethodId: z.string().uuid(),
});
export type ChargeSavedCardRequest = z.infer<typeof chargeSavedCardRequestSchema>;
