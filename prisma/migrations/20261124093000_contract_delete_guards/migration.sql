-- A service or an account that has contracts can no longer be deleted (RESTRICT = the
-- database refuses the delete). Before this, deleting one removed its contracts, milestones and
-- submissions, and the client's held credits were stranded. The app answers 409 first.

-- contracts: the service and both people
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_jobId_fkey";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contracts" DROP CONSTRAINT "contracts_clientId_fkey";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contracts" DROP CONSTRAINT "contracts_freelancerId_fkey";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_freelancerId_fkey" FOREIGN KEY ("freelancerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The person who asked to end: only the open request is cleared (SET NULL).
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_endRequestedById_fkey";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_endRequestedById_fkey" FOREIGN KEY ("endRequestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Work and change requests are written by one of the two people, so they are kept too.
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_authorId_fkey";
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "amendments" DROP CONSTRAINT "amendments_proposerId_fkey";
ALTER TABLE "amendments" ADD CONSTRAINT "amendments_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The client's end-request choice (APPROVE or REFUND) is tied to the work it was made for:
-- the SUBMITTED milestone and its latest submission at that time.
ALTER TABLE "contracts" ADD COLUMN "endRequestMilestoneId" INTEGER;
ALTER TABLE "contracts" ADD COLUMN "endRequestSubmissionId" INTEGER;
