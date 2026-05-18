-- Add profile scalar fields
ALTER TABLE "users" ADD COLUMN "headline" TEXT;
ALTER TABLE "users" ADD COLUMN "bio" TEXT;
ALTER TABLE "users" ADD COLUMN "location" TEXT;
ALTER TABLE "users" ADD COLUMN "website" TEXT;
ALTER TABLE "users" ADD COLUMN "coverImage" TEXT;
ALTER TABLE "users" ADD COLUMN "profileCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Structured profile sections
CREATE TABLE "user_skills" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_certifications" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "credentialUrl" TEXT,
    "credentialId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_certifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_portfolio_items" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "url" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_portfolio_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_skills_userId_name_key" ON "user_skills"("userId", "name");

ALTER TABLE "user_skills" ADD CONSTRAINT "user_skills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_certifications" ADD CONSTRAINT "user_certifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_portfolio_items" ADD CONSTRAINT "user_portfolio_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill JSON-array legacy fields where they contain valid JSON arrays.
CREATE OR REPLACE FUNCTION "_profile_jsonb_array_text"("rawValue" TEXT)
RETURNS TABLE("value" TEXT, "ordinality" BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT parsed_values."value", parsed_values."ordinality"
  FROM jsonb_array_elements_text("rawValue"::jsonb) WITH ORDINALITY AS parsed_values("value", "ordinality");
EXCEPTION WHEN others THEN
  RETURN;
END;
$$;

INSERT INTO "user_skills" ("userId", "name", "sortOrder", "updatedAt")
SELECT
    u."id",
    skill_values."value",
    skill_values."ordinality"::INTEGER - 1,
    CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN LATERAL "_profile_jsonb_array_text"(u."skill") AS skill_values("value", "ordinality")
WHERE u."skill" IS NOT NULL
ON CONFLICT ("userId", "name") DO NOTHING;

INSERT INTO "user_certifications" ("userId", "name", "sortOrder", "updatedAt")
SELECT
    u."id",
    certification_values."value",
    certification_values."ordinality"::INTEGER - 1,
    CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN LATERAL "_profile_jsonb_array_text"(u."certification") AS certification_values("value", "ordinality")
WHERE u."certification" IS NOT NULL;

DROP FUNCTION "_profile_jsonb_array_text"(TEXT);
