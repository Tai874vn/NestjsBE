-- Structured hiring post fields: company, career field, required years, dictionary skills, closing date.
ALTER TABLE "hiring_posts" ADD COLUMN "companyName" TEXT;
ALTER TABLE "hiring_posts" ADD COLUMN "careerField" TEXT;
ALTER TABLE "hiring_posts" ADD COLUMN "yearsRequired" INTEGER;
ALTER TABLE "hiring_posts" ADD COLUMN "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "hiring_posts" ADD COLUMN "closesAt" TIMESTAMP(3);

CREATE INDEX "hiring_posts_status_careerField_idx" ON "hiring_posts"("status", "careerField");
