-- Service contracts: proposals with versions, milestone contracts, a demo credit wallet
-- (wallets, ledger entries, top-ups), contract reviews, and a copy of every old hire
-- as an imported contract.
--
-- The tables below are what `prisma migrate diff` prints for the schema. Prisma also printed
-- DROP INDEX lines for the hand-made trigram (text search) indexes and an index rename; those
-- are old drift (differences Prisma does not know about) and are left out on purpose.
-- The parts after the tables are written by hand: CHECKs (database rules), partial unique
-- indexes (unique over only some rows), the review trigger change and the hire import.

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('REMOTE', 'ONSITE', 'BOTH');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ENDED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'FUNDED', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AmendmentStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('SEED', 'TOP_UP', 'FUND_HOLD', 'RELEASE', 'REFUND');

-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "contractId" INTEGER;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "milestoneTemplate" JSONB,
ADD COLUMN     "serviceArea" TEXT,
ADD COLUMN     "workMode" "WorkMode" NOT NULL DEFAULT 'REMOTE';

-- CreateTable
CREATE TABLE "proposals" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "freelancerId" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'OPEN',
    "latestVersion" INTEGER NOT NULL DEFAULT 1,
    "turnUserId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "declineNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_versions" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "brief" TEXT NOT NULL,
    "referenceLinks" TEXT[],
    "referenceImages" TEXT[],
    "deadline" TIMESTAMP(3) NOT NULL,
    "milestones" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER,
    "jobId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "freelancerId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "referenceLinks" TEXT[],
    "referenceImages" TEXT[],
    "deadline" TIMESTAMP(3) NOT NULL,
    "total" INTEGER NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "endReason" TEXT,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "endRequestedById" INTEGER,
    "endRequestNote" TEXT,
    "endRequestChoice" TEXT,
    "endRequestedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "fundedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "changesRequestedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "lateWarnedAt" TIMESTAMP(3),
    "silentWarnedAt" TIMESTAMP(3),
    "unfundedWarnedAt" TIMESTAMP(3),

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" SERIAL NOT NULL,
    "milestoneId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "images" TEXT[],
    "links" TEXT[],
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amendments" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "proposerId" INTEGER NOT NULL,
    "status" "AmendmentStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "deadline" TIMESTAMP(3),
    "changes" JSONB NOT NULL,
    "declineNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_events" (
    "id" SERIAL NOT NULL,
    "proposalId" INTEGER,
    "contractId" INTEGER,
    "actorId" INTEGER,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "userId" INTEGER NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "LedgerType" NOT NULL,
    "availableDelta" INTEGER NOT NULL,
    "heldDelta" INTEGER NOT NULL,
    "availableAfter" INTEGER NOT NULL,
    "heldAfter" INTEGER NOT NULL,
    "contractId" INTEGER,
    "milestoneId" INTEGER,
    "topUpId" INTEGER,
    "counterpartyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top_ups" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "amountVnd" INTEGER NOT NULL,
    "txnRef" TEXT NOT NULL,
    "status" "TopUpStatus" NOT NULL DEFAULT 'PENDING',
    "vnpTransactionNo" TEXT,
    "bankCode" TEXT,
    "responseCode" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposals_clientId_status_updatedAt_idx" ON "proposals"("clientId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "proposals_freelancerId_status_updatedAt_idx" ON "proposals"("freelancerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "proposals_status_expiresAt_idx" ON "proposals"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_versions_proposalId_number_key" ON "proposal_versions"("proposalId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_proposalId_key" ON "contracts"("proposalId");

-- CreateIndex
CREATE INDEX "contracts_clientId_status_updatedAt_idx" ON "contracts"("clientId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "contracts_freelancerId_status_updatedAt_idx" ON "contracts"("freelancerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

-- CreateIndex
CREATE INDEX "milestones_status_idx" ON "milestones"("status");

-- CreateIndex
CREATE UNIQUE INDEX "milestones_contractId_position_key" ON "milestones"("contractId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_milestoneId_number_key" ON "submissions"("milestoneId", "number");

-- CreateIndex
CREATE INDEX "amendments_contractId_createdAt_idx" ON "amendments"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "contract_events_contractId_createdAt_idx" ON "contract_events"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "contract_events_proposalId_createdAt_idx" ON "contract_events"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_userId_createdAt_id_idx" ON "ledger_entries"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_contractId_idx" ON "ledger_entries"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "top_ups_txnRef_key" ON "top_ups"("txnRef");

-- CreateIndex
CREATE INDEX "top_ups_userId_createdAt_idx" ON "top_ups"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "comments_contractId_key" ON "comments"("contractId");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_endRequestedById_fkey" FOREIGN KEY ("endRequestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amendments" ADD CONSTRAINT "amendments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amendments" ADD CONSTRAINT "amendments_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_topUpId_fkey" FOREIGN KEY ("topUpId") REFERENCES "top_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- CHECKs (database rules that reject bad rows)
-- ---------------------------------------------------------------------------
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_available_check" CHECK ("available" >= 0);
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_held_check" CHECK ("held" >= 0);
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_amount_check" CHECK ("amount" >= 1);
ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_credits_check" CHECK ("credits" BETWEEN 10 AND 10000);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_two_people_check" CHECK ("clientId" <> "freelancerId");
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_two_people_check" CHECK ("clientId" <> "freelancerId");
-- A ledger row always moves something.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_moves_check" CHECK ("availableDelta" <> 0 OR "heldDelta" <> 0);

-- ---------------------------------------------------------------------------
-- Partial unique indexes
-- ---------------------------------------------------------------------------
-- One OPEN proposal per client per service.
CREATE UNIQUE INDEX "proposals_one_open_per_client_job" ON "proposals"("jobId", "clientId") WHERE "status" = 'OPEN';
-- One OPEN amendment per contract.
CREATE UNIQUE INDEX "amendments_one_open_per_contract" ON "amendments"("contractId") WHERE "status" = 'OPEN';

-- ---------------------------------------------------------------------------
-- Review trigger: the one-review-per-service rule now applies only to old-style reviews
-- (contractId null). A contract review is kept unique by the unique contractId.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_duplicate_job_review()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."contractId" IS NULL THEN
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
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Hire -> contract copy
-- One imported contract per hire whose hirer is not the service owner (self-hires are
-- skipped; the CHECK above would reject them). No ledger rows and no wallets are made:
-- imported contracts are left out of wallet totals.
-- "importedHireId" is a temporary column that links each new contract to its hire;
-- it is dropped at the end of this file. Times are stored in UTC, as Prisma does.
-- ---------------------------------------------------------------------------
ALTER TABLE "contracts" ADD COLUMN "importedHireId" INTEGER;

INSERT INTO "contracts" (
  "jobId", "clientId", "freelancerId", "title", "brief", "referenceLinks", "referenceImages",
  "deadline", "total", "status", "imported", "completedAt", "createdAt", "updatedAt", "importedHireId"
)
SELECT
  h."jobId",
  h."hirerId",
  j."creatorId",
  j."title",
  COALESCE(j."shortDescription", ''),
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  -- Open hires are due 14 days from now; completed ones end on the hire date.
  CASE WHEN h."completed" THEN h."hiredAt" ELSE (now() AT TIME ZONE 'UTC') + interval '14 days' END,
  GREATEST(j."price", 1),
  (CASE WHEN h."completed" THEN 'COMPLETED' ELSE 'ACTIVE' END)::"ContractStatus",
  true,
  CASE WHEN h."completed" THEN h."hiredAt" END,
  h."hiredAt",
  now() AT TIME ZONE 'UTC',
  h."id"
FROM "hires" h
JOIN "jobs" j ON j."id" = h."jobId"
WHERE h."hirerId" <> j."creatorId"
ORDER BY h."id";

-- One milestone per imported contract, for the whole amount:
-- completed hire -> APPROVED (due and approved on the hire date);
-- open hire -> PENDING (due on the contract deadline; the client can fund it).
INSERT INTO "milestones" ("contractId", "position", "title", "dueDate", "amount", "status", "fundedAt", "approvedAt")
SELECT
  c."id",
  1,
  c."title",
  c."deadline",
  c."total",
  (CASE WHEN c."status" = 'COMPLETED' THEN 'APPROVED' ELSE 'PENDING' END)::"MilestoneStatus",
  CASE WHEN c."status" = 'COMPLETED' THEN c."createdAt" END,
  CASE WHEN c."status" = 'COMPLETED' THEN c."createdAt" END
FROM "contracts" c
WHERE c."importedHireId" IS NOT NULL;

-- History: one "imported" row per contract, naming the old hire.
INSERT INTO "contract_events" ("contractId", "actorId", "type", "data", "createdAt")
SELECT c."id", NULL, 'imported', jsonb_build_object('hireId', c."importedHireId"), c."createdAt"
FROM "contracts" c
WHERE c."importedHireId" IS NOT NULL;

-- Link an old review to the imported contract when exactly one imported contract has that
-- service and that reviewer as the client. If one person wrote several reviews on the
-- service, only the earliest is linked (contractId is unique).
UPDATE "comments" cm
SET "contractId" = pick."contractId"
FROM (
  SELECT DISTINCT ON (cm2."jobId", cm2."commenterId") cm2."id" AS "commentId", one."contractId"
  FROM "comments" cm2
  JOIN (
    SELECT "jobId", "clientId", MIN("id") AS "contractId"
    FROM "contracts"
    WHERE "importedHireId" IS NOT NULL
    GROUP BY "jobId", "clientId"
    HAVING COUNT(*) = 1
  ) one ON one."jobId" = cm2."jobId" AND one."clientId" = cm2."commenterId"
  ORDER BY cm2."jobId", cm2."commenterId", cm2."commentedAt", cm2."id"
) pick
WHERE cm."id" = pick."commentId";

ALTER TABLE "contracts" DROP COLUMN "importedHireId";
