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
// Create event
// ---------------------------------------------------------------------------

export const createEventRequestSchema = z
  .object({
    name: trimmedNullable(255),
    note: trimmedNullable(10000),
    location: trimmedNullable(500),
    scheduledStartAt: isoDatetime,
    scheduledEndAt: isoDatetime,
    assigneeTeamMemberId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => new Date(d.scheduledEndAt).getTime() > new Date(d.scheduledStartAt).getTime(), {
    message: 'End must be after start',
    path: ['scheduledEndAt'],
  });

export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

// ---------------------------------------------------------------------------
// Update event
// ---------------------------------------------------------------------------

export const updateEventRequestSchema = z
  .object({
    name: trimmedNullable(255),
    note: trimmedNullable(10000),
    location: trimmedNullable(500),
    scheduledStartAt: isoDatetime.optional(),
    scheduledEndAt: isoDatetime.optional(),
    assigneeTeamMemberId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (d) => {
      if (d.scheduledStartAt && d.scheduledEndAt) {
        return new Date(d.scheduledEndAt).getTime() > new Date(d.scheduledStartAt).getTime();
      }
      return true;
    },
    { message: 'End must be after start', path: ['scheduledEndAt'] },
  );

export type UpdateEventRequest = z.infer<typeof updateEventRequestSchema>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export const eventDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().nullable(),
  note: z.string().nullable(),
  location: z.string().nullable(),
  scheduledStartAt: z.string(),
  scheduledEndAt: z.string(),
  assigneeTeamMemberId: z.string().uuid().nullable(),
  assigneeDisplayName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EventDto = z.infer<typeof eventDtoSchema>;
