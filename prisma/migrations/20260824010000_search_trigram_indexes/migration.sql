CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "jobs_title_trgm_idx"
ON "jobs" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "jobs_description_trgm_idx"
ON "jobs" USING GIN ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "jobs_short_description_trgm_idx"
ON "jobs" USING GIN ("shortDescription" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_name_trgm_idx"
ON "users" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_headline_trgm_idx"
ON "users" USING GIN ("headline" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_location_trgm_idx"
ON "users" USING GIN ("location" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_skill_trgm_idx"
ON "users" USING GIN ("skill" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "user_skills_name_trgm_idx"
ON "user_skills" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "hiring_posts_title_trgm_idx"
ON "hiring_posts" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "hiring_posts_description_trgm_idx"
ON "hiring_posts" USING GIN ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "hiring_posts_requirements_trgm_idx"
ON "hiring_posts" USING GIN ("requirements" gin_trgm_ops);
