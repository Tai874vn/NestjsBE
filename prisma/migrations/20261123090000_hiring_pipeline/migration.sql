-- Hiring pipeline: applications go APPLIED -> REVIEWING -> INTERVIEWING -> OFFERED -> HIRED,
-- with interviews, an event history (a log of what happened) and a number of openings per post.
--
-- Written by hand. Prisma would drop and re-create the status enum (list of allowed values);
-- here ACCEPTED is renamed to HIRED instead, so the 26 accepted applications keep their meaning.
--
-- The enum changes come first. Postgres cannot use a value added by ADD VALUE in the same
-- transaction (one all-or-nothing batch of statements), so nothing below uses the new values.

-- AlterEnum
ALTER TYPE "HiringApplicationStatus" RENAME VALUE 'ACCEPTED' TO 'HIRED';
ALTER TYPE "HiringApplicationStatus" ADD VALUE 'INTERVIEWING' BEFORE 'HIRED';
ALTER TYPE "HiringApplicationStatus" ADD VALUE 'OFFERED' BEFORE 'HIRED';
ALTER TYPE "HiringApplicationStatus" ADD VALUE 'DECLINED' BEFORE 'WITHDRAWN';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'APPLICATION_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'APPLICATION_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'INTERVIEW_UPDATE';

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('ONLINE', 'ONSITE', 'PHONE');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('PROPOSED', 'RESCHEDULE_REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "hiring_applications" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "offerNote" TEXT,
ADD COLUMN     "offeredAt" TIMESTAMP(3),
ADD COLUMN     "statusNote" TEXT,
ADD COLUMN     "statusReason" TEXT;

-- AlterTable
-- Existing posts get 1 opening, the same as new ones.
ALTER TABLE "hiring_posts" ADD COLUMN     "openings" INTEGER DEFAULT 1;

-- CreateTable
CREATE TABLE "interviews" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "mode" "InterviewMode" NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 45,
    "location" TEXT,
    "note" TEXT,
    "proposedTimes" TIMESTAMP(3)[],
    "scheduledAt" TIMESTAMP(3),
    "status" "InterviewStatus" NOT NULL DEFAULT 'PROPOSED',
    "rescheduleNote" TEXT,
    "createdById" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_application_events" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "actorId" INTEGER,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hiring_application_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interviews_applicationId_round_idx" ON "interviews"("applicationId", "round");

-- CreateIndex
CREATE INDEX "interviews_status_scheduledAt_idx" ON "interviews"("status", "scheduledAt");

-- CreateIndex
-- A partial unique index (it only covers rows that match the WHERE): an application can have
-- at most one interview that is still open (proposed, waiting for new times, or booked).
-- Prisma cannot express this, so it lives only here.
CREATE UNIQUE INDEX "interviews_one_active_per_application" ON "interviews"("applicationId") WHERE "status" IN ('PROPOSED','RESCHEDULE_REQUESTED','SCHEDULED');

-- CreateIndex
CREATE INDEX "hiring_application_events_applicationId_createdAt_idx" ON "hiring_application_events"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hiring_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_application_events" ADD CONSTRAINT "hiring_application_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hiring_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_application_events" ADD CONSTRAINT "hiring_application_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
