-- Resume AI work queue. Saving a resume never calls the AI service; a backend worker processes queued resumes.
-- Additive: existing rows get a null status (never queued) and zero attempts.
ALTER TABLE "user_resumes" ADD COLUMN "aiStatus" TEXT;
ALTER TABLE "user_resumes" ADD COLUMN "aiStatusMessage" TEXT;
ALTER TABLE "user_resumes" ADD COLUMN "aiQueuedAt" TIMESTAMP(3);
ALTER TABLE "user_resumes" ADD COLUMN "aiClaimedAt" TIMESTAMP(3);
ALTER TABLE "user_resumes" ADD COLUMN "aiAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_resumes" ADD COLUMN "aiInsights" JSONB;
CREATE INDEX "user_resumes_aiStatus_aiQueuedAt_idx" ON "user_resumes"("aiStatus", "aiQueuedAt");
