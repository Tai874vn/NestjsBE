-- CreateEnum
CREATE TYPE "HiringPostStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "HiringApplicationStatus" AS ENUM ('APPLIED', 'REVIEWING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "recommendation_snapshots" ADD COLUMN "hiringPostId" INTEGER;

-- CreateTable
CREATE TABLE "hiring_posts" (
    "id" SERIAL NOT NULL,
    "recruiterId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "location" TEXT,
    "employmentType" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "status" "HiringPostStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hiring_applications" (
    "id" SERIAL NOT NULL,
    "hiringPostId" INTEGER NOT NULL,
    "applicantId" INTEGER NOT NULL,
    "coverLetter" TEXT,
    "status" "HiringApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recommendation_snapshots_userId_kind_hiringPostId_idx" ON "recommendation_snapshots"("userId", "kind", "hiringPostId");

-- CreateIndex
CREATE INDEX "hiring_posts_recruiterId_status_updatedAt_id_idx" ON "hiring_posts"("recruiterId", "status", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "hiring_posts_status_updatedAt_id_idx" ON "hiring_posts"("status", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "hiring_applications_hiringPostId_applicantId_key" ON "hiring_applications"("hiringPostId", "applicantId");

-- CreateIndex
CREATE INDEX "hiring_applications_applicantId_status_updatedAt_id_idx" ON "hiring_applications"("applicantId", "status", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "hiring_applications_hiringPostId_status_updatedAt_id_idx" ON "hiring_applications"("hiringPostId", "status", "updatedAt", "id");

-- AddForeignKey
ALTER TABLE "recommendation_snapshots" ADD CONSTRAINT "recommendation_snapshots_hiringPostId_fkey" FOREIGN KEY ("hiringPostId") REFERENCES "hiring_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_posts" ADD CONSTRAINT "hiring_posts_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_applications" ADD CONSTRAINT "hiring_applications_hiringPostId_fkey" FOREIGN KEY ("hiringPostId") REFERENCES "hiring_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hiring_applications" ADD CONSTRAINT "hiring_applications_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
