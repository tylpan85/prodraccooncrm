import { type PrismaClient } from '@openclaw/db';
import { ERROR_CODES, type NoteOp } from '@openclaw/shared';
import { ApiError } from '../../lib/error-envelope.js';

type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface ProcessNoteOpsInput {
  tx: Tx;
  orgId: string;
  jobId: string;
  customerId: string;
  authorUserId: string;
  recurringSeriesId: string | null;
  occurrenceIndex: number | null;
  scope: 'this' | 'this_and_future';
  noteOps: NoteOp[];
}

export interface ProcessedNoteTempMapping {
  tempId: string;
  noteId: string;
  noteGroupId: string | null;
}

/**
 * Applies note create/update/delete operations for a job save.
 *
 * Scope rules (mirror the job edit scope):
 * - 'this'              → operate only on the current job (single row).
 * - 'this_and_future'   → replicate across the pivot + all future, non-deleted
 *                          occurrences in the series (past visits are never
 *                          touched). Each logical note shares a noteGroupId
 *                          across replicated rows so later edits can target
 *                          the group.
 *
 * Returns the tempId → final note id/group mapping for the `create` ops so
 * the client can reconcile optimistic rows.
 */
export async function processNoteOps({
  tx,
  orgId,
  jobId,
  customerId,
  authorUserId,
  recurringSeriesId,
  occurrenceIndex,
  scope,
  noteOps,
}: ProcessNoteOpsInput): Promise<ProcessedNoteTempMapping[]> {
  if (noteOps.length === 0) return [];

  const isFuture = scope === 'this_and_future' && recurringSeriesId && occurrenceIndex !== null;

  // Resolve the set of job ids that each op will target.
  // For 'this' scope (or a non-recurring job) it is just the current jobId.
  // For 'this_and_future' we include the pivot + future non-deleted occurrences.
  const targetJobIds: string[] = [jobId];
  if (isFuture) {
    const future = await tx.job.findMany({
      where: {
        recurringSeriesId,
        occurrenceIndex: { gt: occurrenceIndex },
        deletedFromSeriesAt: null,
        organizationId: orgId,
      },
      select: { id: true },
    });
    for (const f of future) targetJobIds.push(f.id);
  }

  const mappings: ProcessedNoteTempMapping[] = [];

  for (const op of noteOps) {
    if (op.op === 'create') {
      const noteGroupId = crypto.randomUUID();
      const rows = targetJobIds.map((tJobId) => ({
        organizationId: orgId,
        customerId,
        jobId: tJobId,
        noteGroupId,
        content: op.content,
        authorUserId,
      }));
      await tx.customerNote.createMany({ data: rows });

      // Find the inserted row for the pivot job so we can return its id.
      const pivotRow = await tx.customerNote.findFirst({
        where: { noteGroupId, jobId },
        select: { id: true },
      });
      if (!pivotRow) {
        throw new ApiError(
          ERROR_CODES.INTERNAL_ERROR,
          500,
          'Failed to persist new customer note',
        );
      }
      mappings.push({ tempId: op.tempId, noteId: pivotRow.id, noteGroupId });
      continue;
    }

    if (op.op === 'update') {
      const existing = await tx.customerNote.findFirst({
        where: { id: op.id, organizationId: orgId },
        select: { noteGroupId: true, jobId: true },
      });
      if (!existing) {
        throw new ApiError(ERROR_CODES.NOTE_NOT_FOUND, 404, 'Note not found');
      }
      if (existing.noteGroupId === null) {
        // Customer-level note: not part of a series, edit the single row.
        await tx.customerNote.update({
          where: { id: op.id },
          data: { content: op.content },
        });
      } else {
        // Scope applies to note-group members whose job is in our target set.
        await tx.customerNote.updateMany({
          where: {
            organizationId: orgId,
            noteGroupId: existing.noteGroupId,
            jobId: { in: targetJobIds },
          },
          data: { content: op.content },
        });
      }
      continue;
    }

    // delete
    const existing = await tx.customerNote.findFirst({
      where: { id: op.id, organizationId: orgId },
      select: { noteGroupId: true },
    });
    if (!existing) {
      throw new ApiError(ERROR_CODES.NOTE_NOT_FOUND, 404, 'Note not found');
    }
    if (existing.noteGroupId === null) {
      // Customer-level note: delete the single row.
      await tx.customerNote.delete({ where: { id: op.id } });
    } else {
      await tx.customerNote.deleteMany({
        where: {
          organizationId: orgId,
          noteGroupId: existing.noteGroupId,
          jobId: { in: targetJobIds },
        },
      });
    }
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Customer-level note ops (jobId = null, noteGroupId = null on create).
// Used by the customer detail page where there is no job/scope context.
// Edits/deletes that target a grouped note (one created from a job) propagate
// to the entire group so the "single source of truth" stays consistent.
// ---------------------------------------------------------------------------

export interface ProcessCustomerNoteOpsInput {
  tx: Tx;
  orgId: string;
  customerId: string;
  authorUserId: string;
  noteOps: NoteOp[];
}

export async function processCustomerNoteOps({
  tx,
  orgId,
  customerId,
  authorUserId,
  noteOps,
}: ProcessCustomerNoteOpsInput): Promise<ProcessedNoteTempMapping[]> {
  if (noteOps.length === 0) return [];

  const mappings: ProcessedNoteTempMapping[] = [];

  for (const op of noteOps) {
    if (op.op === 'create') {
      const created = await tx.customerNote.create({
        data: {
          organizationId: orgId,
          customerId,
          jobId: null,
          noteGroupId: null,
          content: op.content,
          authorUserId,
        },
        select: { id: true },
      });
      mappings.push({ tempId: op.tempId, noteId: created.id, noteGroupId: null });
      continue;
    }

    if (op.op === 'update') {
      const existing = await tx.customerNote.findFirst({
        where: { id: op.id, organizationId: orgId, customerId },
        select: { noteGroupId: true },
      });
      if (!existing) {
        throw new ApiError(ERROR_CODES.NOTE_NOT_FOUND, 404, 'Note not found');
      }
      if (existing.noteGroupId === null) {
        await tx.customerNote.update({
          where: { id: op.id },
          data: { content: op.content },
        });
      } else {
        await tx.customerNote.updateMany({
          where: {
            organizationId: orgId,
            customerId,
            noteGroupId: existing.noteGroupId,
          },
          data: { content: op.content },
        });
      }
      continue;
    }

    // delete
    const existing = await tx.customerNote.findFirst({
      where: { id: op.id, organizationId: orgId, customerId },
      select: { noteGroupId: true },
    });
    if (!existing) {
      throw new ApiError(ERROR_CODES.NOTE_NOT_FOUND, 404, 'Note not found');
    }
    if (existing.noteGroupId === null) {
      await tx.customerNote.delete({ where: { id: op.id } });
    } else {
      await tx.customerNote.deleteMany({
        where: {
          organizationId: orgId,
          customerId,
          noteGroupId: existing.noteGroupId,
        },
      });
    }
  }

  return mappings;
}
