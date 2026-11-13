-- Links each profile skill to the AI service skill dictionary. Additive: existing rows keep a null id.
ALTER TABLE "user_skills" ADD COLUMN "skillId" TEXT;
