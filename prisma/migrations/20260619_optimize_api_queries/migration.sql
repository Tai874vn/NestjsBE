CREATE INDEX IF NOT EXISTS "users_role_profileCompleted_updatedAt_id_idx"
ON "users"("role", "profileCompleted", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "jobs_creatorId_id_idx"
ON "jobs"("creatorId", "id");

CREATE INDEX IF NOT EXISTS "jobs_subcategoryId_id_idx"
ON "jobs"("subcategoryId", "id");

CREATE INDEX IF NOT EXISTS "comments_jobId_commentedAt_idx"
ON "comments"("jobId", "commentedAt");

CREATE INDEX IF NOT EXISTS "hires_hirerId_completed_hiredAt_idx"
ON "hires"("hirerId", "completed", "hiredAt");

CREATE INDEX IF NOT EXISTS "hires_jobId_completed_idx"
ON "hires"("jobId", "completed");

CREATE INDEX IF NOT EXISTS "chat_room_members_userId_roomId_idx"
ON "chat_room_members"("userId", "roomId");

CREATE INDEX IF NOT EXISTS "chat_messages_roomId_createdAt_idx"
ON "chat_messages"("roomId", "createdAt");
