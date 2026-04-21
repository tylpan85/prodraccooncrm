import { z } from 'zod';
import { noteOpsSchema } from './notes';

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
// Job service items (one job → N service rows)
// ---------------------------------------------------------------------------

export const jobServiceItemInputSchema = z.object({
  serviceId: z.string().uuid().nullable().optional(),
  priceCents: z.number().int().min(0),
  nameSnapshot: z.string().max(255).nullable().optional(),
});

export type JobServiceItemInput = z.infer<typeof jobServiceItemInputSchema>;

export const jobServiceItemDtoSchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid().nullable(),
  serviceName: z.string().nullable(),
  nameSnapshot: z.string().nullable(),
  priceCents: z.number().int(),
  orderIndex: z.number().int(),
});

export type JobServiceItemDto = z.infer<typeof jobServiceItemDtoSchema>;

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
    services: z.array(jobServiceItemInputSchema).max(50).optional(),
    noteOps: noteOpsSchema.optional(),

    scheduledStartAt: isoDatetime,
    scheduledEndAt: isoDatetime,
    assigneeTeamMemberId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => new Date(d.scheduledEndAt).getTime() > new Date(d.scheduledStartAt).getTime(), {
    message: 'End must be after start',
    path: ['scheduledEndAt'],
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
  services: z.array(jobServiceItemInputSchema).max(50).optional(),
  noteOps: noteOpsSchema.optional(),
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

const jobStageEnum = z.enum([
  'scheduled',
  'confirmation_sent',
  'confirmed',
  'job_done',
  'cancelled',
]);

const intFromString = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  });

export const jobListQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  assigneeTeamMemberId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  stage: jobStageEnum.optional(),
  tag: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  priceMinCents: intFromString,
  priceMaxCents: intFromString,
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
  scheduledStartAt: z.string(),
  scheduledEndAt: z.string(),
  assigneeTeamMemberId: z.string().uuid().nullable(),
  assigneeDisplayName: z.string().nullable(),
  jobStage: z.string(),
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
  scheduledStartAt: z.string(),
  scheduledEndAt: z.string(),
  assigneeTeamMemberId: z.string().uuid().nullable(),
  assigneeDisplayName: z.string().nullable(),
  jobStage: z.string(),
  finishedAt: z.string().nullable(),
  tags: z.array(z.string()),
  services: z.array(jobServiceItemDtoSchema),
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
