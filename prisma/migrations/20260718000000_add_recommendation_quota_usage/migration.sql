CREATE TABLE "recommendation_quota_usages" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_quota_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recommendation_quota_usages_userId_day_key"
ON "recommendation_quota_usages"("userId", "day");

CREATE INDEX "recommendation_quota_usages_day_idx"
ON "recommendation_quota_usages"("day");

ALTER TABLE "recommendation_quota_usages"
ADD CONSTRAINT "recommendation_quota_usages_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
