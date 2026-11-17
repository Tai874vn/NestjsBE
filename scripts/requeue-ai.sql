-- Requeue the AI after the ESCO occupations deploy (final review I3, ruling R32).
--
-- Run it ONLY AFTER the AI service serves the v2 seniority model (jobaura-seniority-structured-v2) and the backend
-- at feat/esco-occupations HEAD is up: the backend worker sends each queued row to the AI service, so running it
-- while the AI still serves v1 would only decide everything with v1 again. See docs/deploy-esco-occupations.md.
--
-- It requeues:
--   (a) hiring posts whose level came from the v1 model (jobaura-seniority-structured-v1, with the old 37 fields);
--   (b) resumes in NEEDS_INPUT, DONE, FAILED or AI_UNAVAILABLE (the C2 migration left real users' resumes in
--       NEEDS_INPUT; DONE/FAILED/AI_UNAVAILABLE ones were decided, or tried, by v1).
-- The columns are the ones the migrations use to queue (aiStatus, aiStatusMessage, aiQueuedAt, aiClaimedAt,
-- aiAttempts). The predicted* columns are left alone: the worker overwrites them, or clears them on NEEDS_INPUT.
--
-- Safe to re-run:
--   - rows already QUEUED or PROCESSING are not touched, so a second run before the worker drains changes nothing
--     and never resets a row the worker has claimed;
--   - a resume DONE by v2 is not requeued, and a post DONE by v2 no longer carries the v1 model, so once the worker
--     has drained the queue a re-run only retries rows that ended NEEDS_INPUT, FAILED or AI_UNAVAILABLE (resumes)
--     or FAILED / AI_UNAVAILABLE with a v1 level still on them (posts). Retrying those is harmless.
-- Everything runs in one transaction: either both updates apply or neither does.
--
-- Usage (prod; see the runbook for the backup first):
--   docker exec -i jobaura-postgres-1 psql -U jobaura -d jobaura -v ON_ERROR_STOP=1 < scripts/requeue-ai.sql

\echo 'Before: hiring posts by status and model'
SELECT "aiStatus", "predictedSeniorityModel", count(*) FROM "hiring_posts" GROUP BY 1, 2 ORDER BY 1, 2;
\echo 'Before: resumes by status and model'
SELECT "aiStatus", "predictedSeniorityModel", count(*) FROM "user_resumes" GROUP BY 1, 2 ORDER BY 1, 2;

BEGIN;

-- (a) Posts decided by v1. IS DISTINCT FROM: a NULL aiStatus counts as "not in flight".
UPDATE "hiring_posts"
SET "aiStatus" = 'QUEUED',
    "aiStatusMessage" = NULL,
    "aiQueuedAt" = CURRENT_TIMESTAMP,
    "aiClaimedAt" = NULL,
    "aiAttempts" = 0
WHERE "predictedSeniorityModel" = 'jobaura-seniority-structured-v1'
  AND "aiStatus" IS DISTINCT FROM 'QUEUED'
  AND "aiStatus" IS DISTINCT FROM 'PROCESSING';

-- (b) Resumes that are not in flight and not already decided by v2.
UPDATE "user_resumes"
SET "aiStatus" = 'QUEUED',
    "aiStatusMessage" = NULL,
    "aiQueuedAt" = CURRENT_TIMESTAMP,
    "aiClaimedAt" = NULL,
    "aiAttempts" = 0
WHERE "aiStatus" IN ('NEEDS_INPUT', 'DONE', 'FAILED', 'AI_UNAVAILABLE')
  AND NOT ("aiStatus" = 'DONE'
           AND "predictedSeniorityModel" IS NOT DISTINCT FROM 'jobaura-seniority-structured-v2');

COMMIT;

\echo 'After: hiring posts by status'
SELECT "aiStatus", count(*) FROM "hiring_posts" GROUP BY 1 ORDER BY 1;
\echo 'After: resumes by status'
SELECT "aiStatus", count(*) FROM "user_resumes" GROUP BY 1 ORDER BY 1;
