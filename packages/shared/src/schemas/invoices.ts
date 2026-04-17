import { z } from 'zod';

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export const invoiceListQuerySchema = z.object({
  status: z.enum(['unsent', 'open', 'past_due', 'paid', 'void']).optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().optional(),
  cursor: z.string().uuid().optional(),
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

export const editInvoiceRequestSchema = z.object({
  serviceNameSnapshot: z.string().max(255).optional(),
  servicePriceCentsSnapshot: z.number().int().min(0).optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

export type EditInvoiceRequest = z.infer<typeof editInvoiceRequestSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

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
  dueDate: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
  updatedAt: z.string(),
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
});

export type InvoiceSummaryDto = z.infer<typeof invoiceSummaryDtoSchema>;
