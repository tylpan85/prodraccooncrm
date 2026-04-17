import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Create job
// ---------------------------------------------------------------------------

export const createJobRequestSchema = z
  .object({
    customerAddressId: z.string().uuid(),
    serviceId: z.string().uuid().nullable().optional(),
    titleOrSummary: trimmedNullable(255),
    priceCents: z.number().int().min(0).default(0),
    leadSource: trimmedNullable(255),
    privateNotes: trimmedNullable(10000),
    tags: z.array(z.string().max(100)).max(50).optional(),

    // Schedule (optional — omit for unscheduled)
    scheduledStartAt: isoDatetime.nullable().optional(),
    scheduledEndAt: isoDatetime.nullable().optional(),
    assigneeTeamMemberId: z.string().uuid().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const hasStart = data.scheduledStartAt != null;
    const hasEnd = data.scheduledEndAt != null;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Both start and end are required when scheduling',
        path: [hasStart ? 'scheduledEndAt' : 'scheduledStartAt'],
      });
    }
    if (hasStart && hasEnd && data.scheduledEndAt && data.scheduledStartAt) {
      if (new Date(data.scheduledEndAt).getTime() <= new Date(data.scheduledStartAt).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'End must be after start',
          path: ['scheduledEndAt'],
        });
      }
    }
  });

export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

// ---------------------------------------------------------------------------
// Update job (basic fields only — schedule/assign via dedicated endpoints)
// ---------------------------------------------------------------------------

export const updateJobRequestSchema = z.object({
  customerAddressId: z.string().uuid().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  titleOrSummary: trimmedNullable(255),
  priceCents: z.number().int().min(0).optional(),
  leadSource: trimmedNullable(255),
  privateNotes: trimmedNullable(10000),
  tags: z.array(z.string().max(100)).max(50).optional(),
});

export type UpdateJobRequest = z.infer<typeof updateJobRequestSchema>;

// ---------------------------------------------------------------------------
// Schedule / Assign actions
// ---------------------------------------------------------------------------

export const scheduleJobRequestSchema = z
  .object({
    scheduledStartAt: isoDatetime,
    scheduledEndAt: isoDatetime,
    assigneeTeamMemberId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => new Date(d.scheduledEndAt).getTime() > new Date(d.scheduledStartAt).getTime(), {
    message: 'End must be after start',
    path: ['scheduledEndAt'],
  });

export type ScheduleJobRequest = z.infer<typeof scheduleJobRequestSchema>;

export const assignJobRequestSchema = z.object({
  assigneeTeamMemberId: z.string().uuid(),
});

export type AssignJobRequest = z.infer<typeof assignJobRequestSchema>;

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export const jobListQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  scheduleState: z.enum(['unscheduled', 'scheduled']).optional(),
  jobStatus: z.enum(['open', 'finished']).optional(),
  assigneeTeamMemberId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
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

export type JobListQuery = z.infer<typeof jobListQuerySchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export const jobSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  jobNumber: z.string(),
  customerId: z.string().uuid(),
  customerDisplayName: z.string(),
  titleOrSummary: z.string().nullable(),
  priceCents: z.number(),
  scheduleState: z.string(),
  scheduledStartAt: z.string().nullable(),
  scheduledEndAt: z.string().nullable(),
  assigneeTeamMemberId: z.string().uuid().nullable(),
  assigneeDisplayName: z.string().nullable(),
  jobStatus: z.string(),
  finishedAt: z.string().nullable(),
});

export type JobSummaryDto = z.infer<typeof jobSummaryDtoSchema>;

export const jobDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  jobNumber: z.string(),
  customerId: z.string().uuid(),
  customerDisplayName: z.string(),
  customerAddressId: z.string().uuid(),
  serviceId: z.string().uuid().nullable(),
  serviceName: z.string().nullable(),
  titleOrSummary: z.string().nullable(),
  priceCents: z.number(),
  leadSource: z.string().nullable(),
  privateNotes: z.string().nullable(),
  scheduleState: z.string(),
  scheduledStartAt: z.string().nullable(),
  scheduledEndAt: z.string().nullable(),
  assigneeTeamMemberId: z.string().uuid().nullable(),
  assigneeDisplayName: z.string().nullable(),
  jobStatus: z.string(),
  finishedAt: z.string().nullable(),
  tags: z.array(z.string()),
  recurringSeriesId: z.string().uuid().nullable(),
  invoice: z
    .object({
      id: z.string().uuid(),
      invoiceNumber: z.string(),
      status: z.string(),
      totalCents: z.number(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type JobDto = z.infer<typeof jobDtoSchema>;
