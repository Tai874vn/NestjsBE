UPDATE "users"
SET "candidateDiscoverable" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "candidateDiscoverable" = false;
