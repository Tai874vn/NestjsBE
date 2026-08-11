-- Constrain role values at the database layer while preserving the existing
-- lowercase role strings used by the application and JWT validation.
UPDATE "users"
SET "role" = 'user'
WHERE "role" NOT IN ('user', 'employer', 'admin');

ALTER TABLE "users"
ADD CONSTRAINT "users_role_check"
CHECK ("role" IN ('user', 'employer', 'admin'));

-- Enforce one direct/private 1-on-1 chat room per user pair for new rooms.
-- Existing duplicate direct rooms, if any, keep NULL directKey so the migration
-- does not destroy user data. The oldest direct room per pair receives the key.
ALTER TABLE "chat_rooms"
ADD COLUMN "directKey" TEXT;

WITH direct_rooms AS (
  SELECT
    rooms.id,
    CONCAT(
      LEAST(MIN(members."userId"), MAX(members."userId")),
      ':',
      GREATEST(MIN(members."userId"), MAX(members."userId"))
    ) AS "directKey"
  FROM "chat_rooms" AS rooms
  JOIN "chat_room_members" AS members
    ON members."roomId" = rooms.id
  WHERE rooms."isPrivate" = true
  GROUP BY rooms.id
  HAVING COUNT(members."userId") = 2
),
ranked_direct_rooms AS (
  SELECT
    id,
    "directKey",
    ROW_NUMBER() OVER (PARTITION BY "directKey" ORDER BY id ASC) AS row_number
  FROM direct_rooms
)
UPDATE "chat_rooms" AS rooms
SET "directKey" = ranked_direct_rooms."directKey"
FROM ranked_direct_rooms
WHERE rooms.id = ranked_direct_rooms.id
  AND ranked_direct_rooms.row_number = 1;

CREATE UNIQUE INDEX "chat_rooms_directKey_key" ON "chat_rooms"("directKey");
