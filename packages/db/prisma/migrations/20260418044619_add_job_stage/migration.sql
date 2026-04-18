-- CreateEnum
CREATE TYPE "JobStage" AS ENUM ('scheduled', 'confirmation_sent', 'confirmed', 'job_done', 'cancelled');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "job_stage" "JobStage" NOT NULL DEFAULT 'scheduled';
