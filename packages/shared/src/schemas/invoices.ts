import { z } from 'zod';

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const intFromString = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  });

export const invoiceListQuerySchema = z.object({
  status: z.enum(['unsent', 'open', 'past_due', 'paid', 'void']).optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  amountMinCents: intFromString,
  amountMaxCents: intFromString,
  q: z.string().optional(),
  anchor: z.string().optional(),
  direction: z.enum(['before', 'after']).optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = v ? Number.parseInt(v, 10) : 25;
      return Number.isNaN(n) || n < 1 ? 25 : Math.min(n, 100);
    }),
});

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

// ---------------------------------------------------------------------------
// Edit (draft only)
// ---------------------------------------------------------------------------

export const invoiceLineItemInputSchema = z.object({
  description: z.string().trim().min(1).max(255),
  priceCents: z.number().int().min(0),
});

export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemInputSchema>;

export const editInvoiceRequestSchema = z.object({
  serviceNameSnapshot: z.string().max(255).optional(),
  servicePriceCentsSnapshot: z.number().int().min(0).optional(),
  lineItems: z.array(invoiceLineItemInputSchema).max(50).optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

export type EditInvoiceRequest = z.infer<typeof editInvoiceRequestSchema>;

// ---------------------------------------------------------------------------
// Send / mark-paid actions
// ---------------------------------------------------------------------------

const isoDateTimeOptional = z
  .string()
  .datetime({ offset: true })
  .optional();

export const sendInvoiceSmsRequestSchema = z.object({
  toPhone: z
    .string()
    .trim()
    .min(7, 'Phone is required')
    .max(20),
});
export type SendInvoiceSmsRequest = z.infer<typeof sendInvoiceSmsRequestSchema>;

export const markInvoicePaidRequestSchema = z.object({
  paymentMethodId: z.string().uuid(),
  reference: z.string().trim().max(120).optional(),
  paidAt: isoDateTimeOptional,
});
export type MarkInvoicePaidRequest = z.infer<typeof markInvoicePaidRequestSchema>;

export const sendInvoiceReceiptRequestSchema = z.object({
  toEmail: z.string().email(),
});
export type SendInvoiceReceiptRequest = z.infer<typeof sendInvoiceReceiptRequestSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export const invoiceLineItemDtoSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  priceCents: z.number().int(),
  orderIndex: z.number().int(),
});

export type InvoiceLineItemDto = z.infer<typeof invoiceLineItemDtoSchema>;

export const invoicePaymentDtoSchema = z.object({
  id: z.string().uuid(),
  paymentMethodId: z.string().uuid().nullable(),
  paymentMethodName: z.string(),
  source: z.enum(['manual', 'stripe']),
  amountCents: z.number().int(),
  reference: z.string().nullable(),
  paidAt: z.string(),
  recordedByUserId: z.string().uuid().nullable(),
  stripeChargeId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  createdAt: z.string(),
});
export type InvoicePaymentDto = z.infer<typeof invoicePaymentDtoSchema>;

export const invoiceDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  invoiceNumber: z.string(),
  jobId: z.string().uuid(),
  jobNumber: z.string().nullable(),
  customerId: z.string().uuid(),
  customerDisplayName: z.string().nullable(),
  status: z.string(),
  subtotalCents: z.number(),
  totalCents: z.number(),
  amountDueCents: z.number(),
  paidCents: z.number(),
  serviceNameSnapshot: z.string().nullable(),
  servicePriceCentsSnapshot: z.number().nullable(),
  lineItems: z.array(invoiceLineItemDtoSchema),
  payments: z.array(invoicePaymentDtoSchema),
  dueDate: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
  updatedAt: z.string(),
  publicToken: z.string(),
  lastSentVia: z.string().nullable(),
  lastSentAt: z.string().nullable(),
  lockedAt: z.string().nullable(),
  companyNameSnapshot: z.string().nullable(),
  companyAddressSnapshot: z.string().nullable(),
  companyPhoneSnapshot: z.string().nullable(),
  companyWebsiteSnapshot: z.string().nullable(),
});

export type InvoiceDto = z.infer<typeof invoiceDtoSchema>;

export const invoiceSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  customerId: z.string().uuid(),
  customerDisplayName: z.string().nullable(),
  serviceNameSnapshot: z.string().nullable(),
  totalCents: z.number(),
  amountDueCents: z.number(),
  dueDate: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});

export type InvoiceSummaryDto = z.infer<typeof invoiceSummaryDtoSchema>;

// ---------------------------------------------------------------------------
// Public pay page (anonymous)
// ---------------------------------------------------------------------------

export const publicInvoiceDtoSchema = z.object({
  invoiceNumber: z.string(),
  status: z.string(),
  totalCents: z.number(),
  amountDueCents: z.number(),
  paidCents: z.number(),
  paidAt: z.string().nullable(),
  dueDate: z.string().nullable(),
  createdAt: z.string(),
  serviceNameSnapshot: z.string().nullable(),
  lineItems: z.array(invoiceLineItemDtoSchema),
  customerDisplayName: z.string().nullable(),
  companyName: z.string(),
  companyAddress: z.string().nullable(),
  companyPhone: z.string().nullable(),
  companyWebsite: z.string().nullable(),
  stripeEnabled: z.boolean(),
});
export type PublicInvoiceDto = z.infer<typeof publicInvoiceDtoSchema>;
