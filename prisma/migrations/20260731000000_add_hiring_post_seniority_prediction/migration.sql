ALTER TABLE "hiring_posts"
ADD COLUMN "predictedSeniority" TEXT,
ADD COLUMN "predictedSeniorityConfidence" DOUBLE PRECISION,
ADD COLUMN "predictedSeniorityModel" TEXT,
ADD COLUMN "predictedSeniorityMetadata" JSONB,
ADD COLUMN "predictedSeniorityAt" TIMESTAMP(3);
