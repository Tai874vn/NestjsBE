-- 20261117090500 missed resumes whose data has no Occupation key (or is not a JSON object): there its test is
-- NULL, not true, so the row kept its old level. Same clearing, with a missing Occupation counted as no occupation.
UPDATE user_resumes
SET "predictedSeniority" = NULL,
    "predictedSeniorityConfidence" = NULL,
    "predictedSeniorityModel" = NULL,
    "predictedSeniorityMetadata" = NULL,
    "predictedSeniorityAt" = NULL
WHERE NOT COALESCE(jsonb_typeof(data -> 'Occupation') = 'string' AND btrim(data ->> 'Occupation') <> '', false)
  AND ("predictedSeniority" IS NOT NULL
       OR "predictedSeniorityConfidence" IS NOT NULL
       OR "predictedSeniorityModel" IS NOT NULL
       OR "predictedSeniorityMetadata" IS NOT NULL
       OR "predictedSeniorityAt" IS NOT NULL);
