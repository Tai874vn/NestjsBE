CREATE INDEX IF NOT EXISTS "users_bio_trgm_idx"
ON "users" USING GIN ("bio" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "user_portfolio_items_title_trgm_idx"
ON "user_portfolio_items" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "user_portfolio_items_description_trgm_idx"
ON "user_portfolio_items" USING GIN ("description" gin_trgm_ops);
