-- Salaries get a unit. Existing posts were always read as USD per month, so they get exactly that;
-- salaryMin and salaryMax are left as they are.
ALTER TABLE "hiring_posts" ADD COLUMN "salaryCurrency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "hiring_posts" ADD COLUMN "salaryPeriod" TEXT NOT NULL DEFAULT 'month';
