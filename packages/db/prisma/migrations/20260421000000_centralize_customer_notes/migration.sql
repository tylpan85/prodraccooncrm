-- Centralize customer notes: make jobId/noteGroupId nullable so notes can be
-- customer-level (not tied to a visit) and migrate the legacy free-text
-- customers.customer_notes column into structured rows.

-- Make jobId nullable; relax FK to SET NULL (customer-level notes survive job deletion)
ALTER TABLE "customer_notes" DROP CONSTRAINT "customer_notes_job_id_fkey";
ALTER TABLE "customer_notes" ALTER COLUMN "job_id" DROP NOT NULL;
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Make noteGroupId nullable (customer-level notes are not part of a series)
ALTER TABLE "customer_notes" ALTER COLUMN "note_group_id" DROP NOT NULL;

-- Migrate legacy free-text customers.customer_notes into structured rows.
-- Each non-empty value becomes a single customer-level note (no job, no group, no author).
INSERT INTO "customer_notes" ("organization_id", "customer_id", "job_id", "note_group_id", "content", "author_user_id", "created_at", "updated_at")
SELECT
  c."organization_id",
  c."id",
  NULL,
  NULL,
  TRIM(c."customer_notes"),
  NULL,
  c."created_at",
  c."updated_at"
FROM "customers" c
WHERE c."customer_notes" IS NOT NULL
  AND TRIM(c."customer_notes") <> '';

-- Drop the legacy column
ALTER TABLE "customers" DROP COLUMN "customer_notes";
