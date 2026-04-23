import { z } from 'zod';
import { invoicePaymentDtoSchema } from './invoices';

// ---------------------------------------------------------------------------
// Customer statement: completed jobs + payments in a date range
// ---------------------------------------------------------------------------

export const customerStatementQuerySchema = z.object({
  customerId: z.string().uuid(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
    .optional(),
});
export type CustomerStatementQuery = z.infer<typeof customerStatementQuerySchema>;

export const statementJobRowSchema = z.object({
  jobId: z.string().uuid(),
  jobNumber: z.string().nullable(),
  doneAt: z.string(),
  serviceName: z.string().nullable(),
  invoiceId: z.string().uuid().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceStatus: z.string().nullable(),
  totalCents: z.number().int(),
  amountDueCents: z.number().int(),
});
export type StatementJobRow = z.infer<typeof statementJobRowSchema>;

export const statementPaymentRowSchema = invoicePaymentDtoSchema.extend({
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string(),
});
export type StatementPaymentRow = z.infer<typeof statementPaymentRowSchema>;

export const customerStatementDtoSchema = z.object({
  customerId: z.string().uuid(),
  customerDisplayName: z.string().nullable(),
  dateFrom: z.string().nullable(),
  dateTo: z.string().nullable(),
  jobs: z.array(statementJobRowSchema),
  payments: z.array(statementPaymentRowSchema),
  totalsCents: z.object({
    billed: z.number().int(),
    paid: z.number().int(),
    outstanding: z.number().int(),
  }),
  generatedAt: z.string(),
});
export type CustomerStatementDto = z.infer<typeof customerStatementDtoSchema>;
