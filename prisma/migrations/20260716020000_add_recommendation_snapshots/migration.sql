-- CreateEnum
CREATE TYPE "RecommendationSnapshotKind" AS ENUM ('JOBS', 'CANDIDATES');

-- CreateTable
CREATE TABLE "recommendation_snapshots" (
    "id" SERIAL NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "kind" "RecommendationSnapshotKind" NOT NULL,
    "jobId" INTEGER,
    "topK" INTEGER NOT NULL,
    "poolSize" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "modelName" TEXT,
    "elapsedMs" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_snapshots_scopeKey_key" ON "recommendation_snapshots"("scopeKey");

-- CreateIndex
CREATE INDEX "recommendation_snapshots_userId_kind_jobId_idx" ON "recommendation_snapshots"("userId", "kind", "jobId");

-- CreateIndex
CREATE INDEX "recommendation_snapshots_updatedAt_idx" ON "recommendation_snapshots"("updatedAt");

-- AddForeignKey
ALTER TABLE "recommendation_snapshots" ADD CONSTRAINT "recommendation_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_snapshots" ADD CONSTRAINT "recommendation_snapshots_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
