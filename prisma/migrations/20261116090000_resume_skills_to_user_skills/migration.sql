-- Skills now live only in user_skills, shared by the profile and the resume.
-- Copy skills that exist only in a resume's Skills text into user_skills (after the user's own, in resume order),
-- then drop the resume's copy.
WITH parts AS (
  SELECT r."userId", btrim(p.name) AS name, p.ord
  FROM user_resumes r
  CROSS JOIN LATERAL unnest(string_to_array(r.data->>'Skills', ',')) WITH ORDINALITY AS p(name, ord)
  WHERE jsonb_typeof(r.data->'Skills') = 'string'
), firsts AS (
  SELECT DISTINCT ON ("userId", lower(name)) "userId", name, ord
  FROM parts
  WHERE name <> ''
  ORDER BY "userId", lower(name), ord
), missing AS (
  SELECT f.*
  FROM firsts f
  WHERE NOT EXISTS (
    SELECT 1 FROM user_skills s WHERE s."userId" = f."userId" AND lower(s.name) = lower(f.name)
  )
)
INSERT INTO user_skills ("userId", name, "sortOrder", "createdAt", "updatedAt")
SELECT m."userId",
       m.name,
       COALESCE((SELECT max(s."sortOrder") FROM user_skills s WHERE s."userId" = m."userId"), -1)
         + row_number() OVER (PARTITION BY m."userId" ORDER BY m.ord),
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM missing m;

UPDATE user_resumes
SET data = data - 'Skills' - 'SkillIds'
WHERE data ? 'Skills' OR data ? 'SkillIds';
