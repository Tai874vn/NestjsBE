-- CreateIndex
CREATE INDEX "user_certifications_userId_idx" ON "user_certifications"("userId");

-- CreateIndex
CREATE INDEX "user_portfolio_items_userId_idx" ON "user_portfolio_items"("userId");

-- CreateIndex
CREATE INDEX "jobs_createdAt_id_idx" ON "jobs"("createdAt", "id");

-- CreateIndex
CREATE INDEX "jobs_price_id_idx" ON "jobs"("price", "id");

-- CreateIndex
CREATE INDEX "jobs_rating_id_idx" ON "jobs"("rating", "id");
