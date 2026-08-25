-- Serialize review creation per job/user pair and reject new duplicates.
-- Historical duplicate rows are preserved for explicit administrative cleanup.
CREATE OR REPLACE FUNCTION prevent_duplicate_job_review()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(NEW."jobId", NEW."commenterId");

  IF EXISTS (
    SELECT 1
    FROM "comments"
    WHERE "jobId" = NEW."jobId"
      AND "commenterId" = NEW."commenterId"
  ) THEN
    RAISE EXCEPTION 'A user may review a job only once'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "comments_prevent_duplicate_review" ON "comments";
CREATE TRIGGER "comments_prevent_duplicate_review"
BEFORE INSERT ON "comments"
FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_job_review();

CREATE OR REPLACE FUNCTION sync_job_review_summary()
RETURNS TRIGGER AS $$
DECLARE
  affected_job_id INTEGER;
BEGIN
  affected_job_id := COALESCE(NEW."jobId", OLD."jobId");

  UPDATE "jobs"
  SET
    "reviews" = summary.review_count,
    "rating" = summary.average_rating
  FROM (
    SELECT
      COUNT(*)::INTEGER AS review_count,
      COALESCE(ROUND(AVG("rating")), 0)::INTEGER AS average_rating
    FROM "comments"
    WHERE "jobId" = affected_job_id
  ) AS summary
  WHERE "jobs".id = affected_job_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "comments_sync_job_review_summary" ON "comments";
CREATE TRIGGER "comments_sync_job_review_summary"
AFTER INSERT OR UPDATE OF "rating" OR DELETE ON "comments"
FOR EACH ROW EXECUTE FUNCTION sync_job_review_summary();

UPDATE "jobs" AS job
SET
  "reviews" = summary.review_count,
  "rating" = summary.average_rating
FROM (
  SELECT
    jobs.id AS job_id,
    COUNT(comments.id)::INTEGER AS review_count,
    COALESCE(ROUND(AVG(comments."rating")), 0)::INTEGER AS average_rating
  FROM "jobs"
  LEFT JOIN "comments" ON "comments"."jobId" = jobs.id
  GROUP BY jobs.id
) AS summary
WHERE job.id = summary.job_id;
