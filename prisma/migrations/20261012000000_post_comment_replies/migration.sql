ALTER TABLE "post_comments" ADD COLUMN "parentId" INTEGER;

CREATE UNIQUE INDEX "post_comments_id_postId_key"
    ON "post_comments"("id", "postId");

CREATE INDEX "post_comments_postId_parentId_id_idx"
    ON "post_comments"("postId", "parentId", "id");

ALTER TABLE "post_comments"
    ADD CONSTRAINT "post_comments_parentId_postId_fkey"
    FOREIGN KEY ("parentId", "postId") REFERENCES "post_comments"("id", "postId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "post_comments"
    ADD CONSTRAINT "post_comments_not_own_parent_check"
    CHECK ("parentId" IS NULL OR "parentId" <> "id");
