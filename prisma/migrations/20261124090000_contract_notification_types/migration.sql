-- Notification types for service contracts.
-- Kept in its own migration: Postgres cannot use a value added by ADD VALUE in the same
-- transaction (one all-or-nothing batch of statements) that added it.
-- HIRE_CREATED and HIRE_COMPLETED stay for old rows; they are no longer sent.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PROPOSAL_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'CONTRACT_UPDATE';
