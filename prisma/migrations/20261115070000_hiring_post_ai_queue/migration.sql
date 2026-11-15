-- Queue for a hiring post's AI level, like the resume AI queue.
ALTER TABLE "hiring_posts" ADD COLUMN "aiStatus" TEXT;
ALTER TABLE "hiring_posts" ADD COLUMN "aiStatusMessage" TEXT;
ALTER TABLE "hiring_posts" ADD COLUMN "aiQueuedAt" TIMESTAMP(3);
ALTER TABLE "hiring_posts" ADD COLUMN "aiClaimedAt" TIMESTAMP(3);
ALTER TABLE "hiring_posts" ADD COLUMN "aiAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "hiring_posts_aiStatus_aiQueuedAt_idx" ON "hiring_posts"("aiStatus", "aiQueuedAt");

-- Posts that already have a field and required years but no level are queued once, so the worker fills them.
UPDATE "hiring_posts"
SET "aiStatus" = 'QUEUED', "aiQueuedAt" = NOW()
WHERE "predictedSeniority" IS NULL AND "careerField" IS NOT NULL AND "yearsRequired" IS NOT NULL;
