-- Resumes name an ESCO occupation instead of one of the 37 career fields. The old values are kept read-only
-- ("previously: X"): Industry moves to LegacyField and each job's field to legacyField. Occupation starts empty,
-- since no rule maps the 37 fields to occupations, and jobs get an empty occupation. Changed resumes are queued,
-- so the AI asks for the occupation (NEEDS_INPUT) until the user picks one.
WITH moved AS (
  SELECT r.id,
         (r.data - 'Industry')
         || CASE
              WHEN jsonb_typeof(r.data -> 'Industry') = 'string'
                   AND btrim(r.data ->> 'Industry') <> ''
                   AND NOT r.data ? 'LegacyField'
              THEN jsonb_build_object('LegacyField', btrim(r.data ->> 'Industry'))
              ELSE '{}'::jsonb
            END
         || CASE WHEN r.data ? 'Occupation' THEN '{}'::jsonb ELSE '{"Occupation": ""}'::jsonb END
         || CASE
              WHEN jsonb_typeof(r.data -> 'Jobs') = 'array' THEN jsonb_build_object('Jobs', (
                SELECT COALESCE(jsonb_agg(
                  CASE
                    WHEN jsonb_typeof(j.job) = 'object' THEN
                      (j.job - 'field')
                      || CASE
                           WHEN jsonb_typeof(j.job -> 'field') = 'string'
                                AND btrim(j.job ->> 'field') <> ''
                                AND NOT j.job ? 'legacyField'
                           THEN jsonb_build_object('legacyField', btrim(j.job ->> 'field'))
                           ELSE '{}'::jsonb
                         END
                      || CASE WHEN j.job ? 'occupation' THEN '{}'::jsonb ELSE '{"occupation": ""}'::jsonb END
                    ELSE j.job
                  END
                  ORDER BY j.ord), '[]'::jsonb)
                FROM jsonb_array_elements(r.data -> 'Jobs') WITH ORDINALITY AS j(job, ord)))
              ELSE '{}'::jsonb
            END AS data
  FROM user_resumes r
  WHERE r.data ? 'Industry'
     OR (jsonb_typeof(r.data -> 'Jobs') = 'array'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.data -> 'Jobs') AS j(job)
                     WHERE jsonb_typeof(j.job) = 'object' AND j.job ? 'field'))
)
UPDATE user_resumes
SET data = moved.data,
    "aiStatus" = 'QUEUED',
    "aiStatusMessage" = NULL,
    "aiQueuedAt" = CURRENT_TIMESTAMP,
    "aiClaimedAt" = NULL,
    "aiAttempts" = 0
FROM moved
WHERE user_resumes.id = moved.id;
