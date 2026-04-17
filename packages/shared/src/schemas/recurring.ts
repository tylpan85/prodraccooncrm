import { z } from 'zod';

// ---------------------------------------------------------------------------
// Recurrence rule input (shared by create-series and edit-this-and-future)
// ---------------------------------------------------------------------------

const dayOfWeek = z.enum(['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
const ordinal = z.enum(['first', 'second', 'third', 'fourth', 'fifth', 'last']);
const monthOfYear = z.enum([
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
]);

export const recurrenceRuleInputSchema = z
  .object({
    recurrenceFrequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    recurrenceInterval: z.number().int().min(1).max(999),
    recurrenceEndMode: z.enum(['never', 'after_n_occurrences', 'on_date']),
    recurrenceOccurrenceCount: z.number().int().min(1).nullable().optional(),
    recurrenceEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
      .nullable()
      .optional(),
    recurrenceDayOfWeek: z.array(dayOfWeek).nullable().optional(),
    recurrenceDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    recurrenceOrdinal: ordinal.nullable().optional(),
    recurrenceMonthOfYear: monthOfYear.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.recurrenceEndMode === 'after_n_occurrences' && !data.recurrenceOccurrenceCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Occurrence count is required for after_n_occurrences end mode',
        path: ['recurrenceOccurrenceCount'],
      });
    }
    if (data.recurrenceEndMode === 'on_date' && !data.recurrenceEndDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End date is required for on_date end mode',
        path: ['recurrenceEndDate'],
      });
    }
  });

export type RecurrenceRuleInput = z.infer<typeof recurrenceRuleInputSchema>;

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/recurrence — attach recurrence to existing job
// ---------------------------------------------------------------------------

export const attachRecurrenceRequestSchema = recurrenceRuleInputSchema;
export type AttachRecurrenceRequest = RecurrenceRuleInput;

// ---------------------------------------------------------------------------
// POST /api/recurring-jobs — create from scratch
// ---------------------------------------------------------------------------

const isoDatetime = z.string().datetime({ message: 'Must be a valid ISO-8601 datetime' });

const trimmedNullable = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const t = v.trim();
      return t.length === 0 ? null : t;
    });

export const createRecurringJobRequestSchema = z.object({
  customerId: z.string().uuid(),
  job: z.object({
    customerAddressId: z.string().uuid(),
    serviceId: z.string().uuid().nullable().optional(),
    titleOrSummary: trimmedNullable(255),
    priceCents: z.number().int().min(0).default(0),
    leadSource: trimmedNullable(255),
    privateNotes: trimmedNullable(10000),
    tags: z.array(z.string().max(100)).max(50).optional(),
  }),
  schedule: z
    .object({
      scheduledStartAt: isoDatetime,
      scheduledEndAt: isoDatetime,
      assigneeTeamMemberId: z.string().uuid().nullable().optional(),
    })
    .refine((d) => new Date(d.scheduledEndAt).getTime() > new Date(d.scheduledStartAt).getTime(), {
      message: 'End must be after start',
      path: ['scheduledEndAt'],
    }),
  recurrence: recurrenceRuleInputSchema,
});

export type CreateRecurringJobRequest = z.infer<typeof createRecurringJobRequestSchema>;

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/occurrence-edit
// ---------------------------------------------------------------------------

export const occurrenceEditRequestSchema = z
  .object({
    scope: z.enum(['this', 'this_and_future']),
    changes: z.object({
      customerAddressId: z.string().uuid().optional(),
      serviceId: z.string().uuid().nullable().optional(),
      titleOrSummary: trimmedNullable(255),
      priceCents: z.number().int().min(0).optional(),
      leadSource: trimmedNullable(255),
      privateNotes: trimmedNullable(10000),
      tags: z.array(z.string().max(100)).max(50).optional(),
      scheduledStartAt: isoDatetime.optional(),
      scheduledEndAt: isoDatetime.optional(),
      assigneeTeamMemberId: z.string().uuid().nullable().optional(),
    }),
    recurrenceRule: recurrenceRuleInputSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scope === 'this' && data.recurrenceRule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Changing recurrence rule requires this_and_future scope',
        path: ['recurrenceRule'],
      });
    }
  });

export type OccurrenceEditRequest = z.infer<typeof occurrenceEditRequestSchema>;

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/occurrence-delete
// ---------------------------------------------------------------------------

export const occurrenceDeleteRequestSchema = z.object({
  scope: z.enum(['this', 'this_and_future']),
});

export type OccurrenceDeleteRequest = z.infer<typeof occurrenceDeleteRequestSchema>;
