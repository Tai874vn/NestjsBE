-- B-tree indexes for the new list orders, so a page of OPEN posts is read in order and the scan stops after
-- pageSize rows instead of sorting every open post. Column directions match the ORDER BY exactly.
-- sort=closing_soon: ORDER BY "closesAt" ASC NULLS LAST, "id" DESC (ASC is NULLS LAST by default).
CREATE INDEX IF NOT EXISTS "hiring_posts_status_closesAt_id_idx"
ON "hiring_posts" ("status", "closesAt" ASC, "id" DESC);

-- sort=salary_high: ORDER BY "salaryMax" DESC NULLS LAST, "salaryMin" DESC NULLS LAST, "id" DESC.
-- DESC alone would be NULLS FIRST and could not serve this order.
CREATE INDEX IF NOT EXISTS "hiring_posts_status_salaryMax_salaryMin_id_idx"
ON "hiring_posts" ("status", "salaryMax" DESC NULLS LAST, "salaryMin" DESC NULLS LAST, "id" DESC);

-- Keyword search now covers the company name, and ?location= is "contains": trigram indexes, like the ones
-- on title, description and requirements (20260824010000_search_trigram_indexes).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "hiring_posts_company_name_trgm_idx"
ON "hiring_posts" USING GIN ("companyName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "hiring_posts_location_trgm_idx"
ON "hiring_posts" USING GIN ("location" gin_trgm_ops);
