ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "bannedAt" TIMESTAMP(3);

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL PRIMARY KEY,
  "familyId" UUID NOT NULL,
  "userId" INTEGER NOT NULL,
  "tokenVersion" INTEGER NOT NULL,
  "userAgent" TEXT,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auth_sessions_expiry_check" CHECK ("expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "auth_sessions_familyId_key" ON "auth_sessions"("familyId");
CREATE INDEX "auth_sessions_userId_revokedAt_expiresAt_idx" ON "auth_sessions"("userId", "revokedAt", "expiresAt");

CREATE TABLE "auth_refresh_tokens" (
  "id" UUID NOT NULL PRIMARY KEY,
  "sessionId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "replacedById" UUID,
  CONSTRAINT "auth_refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "auth_refresh_tokens_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "auth_refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "auth_refresh_tokens_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "auth_refresh_tokens_expiry_check" CHECK ("expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "auth_refresh_tokens_tokenHash_key" ON "auth_refresh_tokens"("tokenHash");
CREATE INDEX "auth_refresh_tokens_sessionId_expiresAt_idx" ON "auth_refresh_tokens"("sessionId", "expiresAt");
