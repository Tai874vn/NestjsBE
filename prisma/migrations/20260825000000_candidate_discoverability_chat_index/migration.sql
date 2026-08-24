ALTER TABLE "users"
ADD COLUMN "candidateDiscoverable" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "users_role_candidateDiscoverable_profileCompleted_updatedAt_id_idx"
ON "users"("role", "candidateDiscoverable", "profileCompleted", "updatedAt", "id");

CREATE INDEX "chat_messages_roomId_id_idx"
ON "chat_messages"("roomId", "id");
