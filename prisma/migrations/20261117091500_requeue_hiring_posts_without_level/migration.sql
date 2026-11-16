-- 20261117091000 cleared the level of every post without an occupation but requeued only posts that had a career
-- field. A post left DONE with no level would never get one. Requeue those the same way the other migrations do.
-- COALESCE: a NULL occupationCode counts as no occupation.
UPDATE "hiring_posts"
SET "aiStatus" = 'QUEUED',
    "aiStatusMessage" = NULL,
    "aiQueuedAt" = CURRENT_TIMESTAMP,
    "aiClaimedAt" = NULL,
    "aiAttempts" = 0
WHERE NOT COALESCE(btrim("occupationCode") <> '', false)
  AND "aiStatus" = 'DONE'
  AND "predictedSeniority" IS NULL;
