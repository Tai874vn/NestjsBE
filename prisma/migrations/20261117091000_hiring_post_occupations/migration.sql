-- Hiring posts name an ESCO occupation (and optionally one of its specialties) instead of one of the 37 career
-- fields. The old value is kept read-only as legacyField. No rule maps the 37 fields to occupations, so
-- occupationCode starts empty. Changed posts are queued again: the AI matches the job title exactly against ESCO
-- titles, and asks for the occupation (NEEDS_INPUT) when none matches.
ALTER TABLE "hiring_posts" ADD COLUMN "occupationCode" TEXT;
ALTER TABLE "hiring_posts" ADD COLUMN "specialty" TEXT;
ALTER TABLE "hiring_posts" ADD COLUMN "legacyField" TEXT;

UPDATE "hiring_posts"
SET "legacyField" = btrim("careerField"),
    "aiStatus" = 'QUEUED',
    "aiStatusMessage" = NULL,
    "aiQueuedAt" = CURRENT_TIMESTAMP,
    "aiClaimedAt" = NULL,
    "aiAttempts" = 0
WHERE COALESCE(btrim("careerField") <> '', false);

-- A level predicted from the old career field no longer describes a post without an occupation.
-- COALESCE: a NULL occupationCode counts as no occupation (a bare NOT (...) would skip it).
UPDATE "hiring_posts"
SET "predictedSeniority" = NULL,
    "predictedSeniorityConfidence" = NULL,
    "predictedSeniorityModel" = NULL,
    "predictedSeniorityMetadata" = NULL,
    "predictedSeniorityAt" = NULL
WHERE NOT COALESCE(btrim("occupationCode") <> '', false)
  AND ("predictedSeniority" IS NOT NULL
       OR "predictedSeniorityConfidence" IS NOT NULL
       OR "predictedSeniorityModel" IS NOT NULL
       OR "predictedSeniorityMetadata" IS NOT NULL
       OR "predictedSeniorityAt" IS NOT NULL);

DROP INDEX "hiring_posts_status_careerField_idx";
ALTER TABLE "hiring_posts" DROP COLUMN "careerField";

CREATE INDEX "hiring_posts_status_occupationCode_idx" ON "hiring_posts"("status", "occupationCode");
