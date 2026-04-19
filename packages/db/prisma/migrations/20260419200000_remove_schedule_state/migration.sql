-- Backfill NULL dates before making them required
UPDATE "jobs"
SET
  "scheduled_start_at" = NOW(),
  "scheduled_end_at"   = NOW() + INTERVAL '1 hour'
WHERE "scheduled_start_at" IS NULL OR "scheduled_end_at" IS NULL;

-- Drop the old composite index that included schedule_state
DROP INDEX IF EXISTS "jobs_organization_id_schedule_state_scheduled_start_at_idx";

-- Make date columns required
ALTER TABLE "jobs" ALTER COLUMN "scheduled_start_at" SET NOT NULL;
ALTER TABLE "jobs" ALTER COLUMN "scheduled_end_at" SET NOT NULL;

-- Drop the schedule_state column
ALTER TABLE "jobs" DROP COLUMN "schedule_state";

-- Drop the enum type
DROP TYPE IF EXISTS "ScheduleState";

-- Create new index without schedule_state
CREATE INDEX "jobs_organization_id_scheduled_start_at_idx" ON "jobs"("organization_id", "scheduled_start_at");
