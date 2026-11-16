-- A resume without an ESCO occupation has no seniority level: the level it still carries came from the old 37
-- career fields (before 20261117090000_resume_occupations), so it is cleared rather than shown next to "choose your
-- occupation". The level comes back when the user picks an occupation and the AI evaluates the resume.
UPDATE user_resumes
SET "predictedSeniority" = NULL,
    "predictedSeniorityConfidence" = NULL,
    "predictedSeniorityModel" = NULL,
    "predictedSeniorityMetadata" = NULL,
    "predictedSeniorityAt" = NULL
WHERE NOT (jsonb_typeof(data -> 'Occupation') = 'string' AND btrim(data ->> 'Occupation') <> '')
  AND ("predictedSeniority" IS NOT NULL
       OR "predictedSeniorityConfidence" IS NOT NULL
       OR "predictedSeniorityModel" IS NOT NULL
       OR "predictedSeniorityMetadata" IS NOT NULL
       OR "predictedSeniorityAt" IS NOT NULL);
