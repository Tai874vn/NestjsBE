-- CreateIndex
CREATE INDEX "notifications_recipientId_updatedAt_id_idx" ON "notifications"("recipientId", "updatedAt", "id");
