-- Certifications follow the common credential shape: a kind (schema.org credentialCategory) and the skills shown.
ALTER TABLE "user_certifications" ADD COLUMN "category" TEXT;
ALTER TABLE "user_certifications" ADD COLUMN "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
