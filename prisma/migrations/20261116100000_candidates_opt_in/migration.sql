-- New candidates are hidden from recruiters until they turn on "Visible to recruiters". Existing accounts keep their choice.
ALTER TABLE "users" ALTER COLUMN "candidateDiscoverable" SET DEFAULT false;
