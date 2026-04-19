-- Drop the jobStatus column and the JobStatus enum type.
-- jobStage is now the single source of truth for job lifecycle.

ALTER TABLE "jobs" DROP COLUMN "job_status";

DROP TYPE "JobStatus";
