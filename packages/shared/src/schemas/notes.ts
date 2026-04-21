import { z } from 'zod';

// ---------------------------------------------------------------------------
// Customer note DTO (per-visit; noteGroupId links replicas across a series)
// ---------------------------------------------------------------------------

export const customerNoteDtoSchema = z.object({
  id: z.string().uuid(),
  noteGroupId: z.string().uuid(),
  jobId: z.string().uuid(),
  customerId: z.string().uuid(),
  content: z.string(),
  authorUserId: z.string().uuid().nullable(),
  authorEmail: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CustomerNoteDto = z.infer<typeof customerNoteDtoSchema>;

// ---------------------------------------------------------------------------
// Note dirty-ops (embedded into job save payloads)
// - create: client picks a tempId so the UI can map optimistic rows
// - update/delete: reference an existing note id (server resolves noteGroupId
//   and applies scope at save time)
// ---------------------------------------------------------------------------

const noteContentSchema = z.string().trim().min(1, 'Note cannot be empty').max(10000);

export const createNoteOpSchema = z.object({
  op: z.literal('create'),
  tempId: z.string().min(1).max(64),
  content: noteContentSchema,
});

export const updateNoteOpSchema = z.object({
  op: z.literal('update'),
  id: z.string().uuid(),
  content: noteContentSchema,
});

export const deleteNoteOpSchema = z.object({
  op: z.literal('delete'),
  id: z.string().uuid(),
});

export const noteOpSchema = z.discriminatedUnion('op', [
  createNoteOpSchema,
  updateNoteOpSchema,
  deleteNoteOpSchema,
]);

export type CreateNoteOp = z.infer<typeof createNoteOpSchema>;
export type UpdateNoteOp = z.infer<typeof updateNoteOpSchema>;
export type DeleteNoteOp = z.infer<typeof deleteNoteOpSchema>;
export type NoteOp = z.infer<typeof noteOpSchema>;

export const noteOpsSchema = z.array(noteOpSchema).max(100);

// ---------------------------------------------------------------------------
// GET /api/jobs/:id/notes
// ---------------------------------------------------------------------------

export const jobNotesResponseSchema = z.object({
  notes: z.array(customerNoteDtoSchema),
});

export type JobNotesResponse = z.infer<typeof jobNotesResponseSchema>;
