DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'recommendation_quota_usages_used_nonnegative_check'
  ) THEN
    ALTER TABLE "recommendation_quota_usages"
    ADD CONSTRAINT "recommendation_quota_usages_used_nonnegative_check"
    CHECK ("used" >= 0);
  END IF;
END $$;
