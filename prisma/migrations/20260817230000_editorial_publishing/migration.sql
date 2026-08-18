-- The Break — editorial publishing.
--
-- One canonical, Prisma-backed article system: articles, categories, tags, revisions, slug history,
-- comments, reports, moderation records, daily metrics, standalone pages and homepage settings.
--
-- It lives in Prisma rather than Payload because authorship, permissions, comments, account merges
-- and account-deletion safeguards are all tied to the main application accounts. Images are NOT
-- stored here: they stay in the Payload Media system and are referenced by media id.
--
-- Additive only. Nothing existing is dropped or rewritten, so this is safe against a database
-- holding live Seasons, Tournaments and accounts.

-- Trusted Author: server-enforced, set only by an owner/admin, default off.
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "blogTrustedAuthor" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "article_category" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "adminOnly" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_tag" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_tag_link" (
    "articleId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "article_tag_link_pkey" PRIMARY KEY ("articleId","tagId")
);

-- CreateTable
CREATE TABLE "article" (
    "id" SERIAL NOT NULL,
    "authorPlayerId" TEXT,
    "authorNameSnapshot" TEXT NOT NULL,
    "authorHandleSnapshot" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "slugKey" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" JSONB NOT NULL,
    "coverMediaId" TEXT,
    "coverAlt" TEXT,
    "categoryId" INTEGER,
    "state" "ArticleState" NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3),
    "official" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "pinOrder" INTEGER NOT NULL DEFAULT 0,
    "commentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "commentsLocked" BOOLEAN NOT NULL DEFAULT false,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "canonicalUrl" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "pendingBody" JSONB,
    "pendingTitle" TEXT,
    "pendingExcerpt" TEXT,
    "pendingSubmittedAt" TIMESTAMP(3),
    "reviewerPlayerId" TEXT,
    "reviewFeedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_slug_history" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "slugKey" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_slug_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_revision" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" JSONB NOT NULL,
    "editorPlayerId" TEXT,
    "editorName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_relation" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "competitionSeriesId" INTEGER,
    "seasonId" INTEGER,
    "tournamentId" INTEGER,
    "playerId" TEXT,

    CONSTRAINT "article_relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_comment" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "authorPlayerId" TEXT,
    "authorNameSnapshot" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "hiddenByPlayerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_report" (
    "id" SERIAL NOT NULL,
    "commentId" INTEGER NOT NULL,
    "reporterPlayerId" TEXT,
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByPlayerId" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_moderation_record" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "articleId" INTEGER,
    "commentId" INTEGER,
    "actorPlayerId" TEXT,
    "actorName" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "editorial_moderation_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_daily_metric" (
    "id" SERIAL NOT NULL,
    "articleId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "article_daily_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_page" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "excerpt" TEXT,
    "state" "ArticleState" NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3),
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "canonicalUrl" TEXT,
    "showInNav" BOOLEAN NOT NULL DEFAULT false,
    "navOrder" INTEGER NOT NULL DEFAULT 0,
    "commentsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "editorial_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "featuredArticleId" INTEGER,
    "showFeatured" BOOLEAN NOT NULL DEFAULT true,
    "showOfficial" BOOLEAN NOT NULL DEFAULT true,
    "showPredictions" BOOLEAN NOT NULL DEFAULT true,
    "showCommunity" BOOLEAN NOT NULL DEFAULT true,
    "showDiscussed" BOOLEAN NOT NULL DEFAULT true,
    "sectionOrder" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editorial_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "article_category_slug_key" ON "article_category"("slug");

-- CreateIndex
CREATE INDEX "article_category_active_sortOrder_idx" ON "article_category"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "article_tag_slug_key" ON "article_tag"("slug");

-- CreateIndex
CREATE INDEX "article_tag_link_tagId_idx" ON "article_tag_link"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "article_slugKey_key" ON "article"("slugKey");

-- CreateIndex
CREATE INDEX "article_state_publishAt_idx" ON "article"("state", "publishAt");

-- CreateIndex
CREATE INDEX "article_authorPlayerId_idx" ON "article"("authorPlayerId");

-- CreateIndex
CREATE INDEX "article_categoryId_idx" ON "article"("categoryId");

-- CreateIndex
CREATE INDEX "article_featured_state_publishAt_idx" ON "article"("featured", "state", "publishAt");

-- CreateIndex
CREATE INDEX "article_official_state_publishAt_idx" ON "article"("official", "state", "publishAt");

-- CreateIndex
CREATE INDEX "article_pinned_pinOrder_idx" ON "article"("pinned", "pinOrder");

-- CreateIndex
CREATE UNIQUE INDEX "article_slug_history_slugKey_key" ON "article_slug_history"("slugKey");

-- CreateIndex
CREATE INDEX "article_slug_history_articleId_idx" ON "article_slug_history"("articleId");

-- CreateIndex
CREATE INDEX "article_revision_articleId_createdAt_idx" ON "article_revision"("articleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "article_revision_articleId_revision_key" ON "article_revision"("articleId", "revision");

-- CreateIndex
CREATE INDEX "article_relation_articleId_idx" ON "article_relation"("articleId");

-- CreateIndex
CREATE INDEX "article_relation_competitionSeriesId_idx" ON "article_relation"("competitionSeriesId");

-- CreateIndex
CREATE INDEX "article_relation_seasonId_idx" ON "article_relation"("seasonId");

-- CreateIndex
CREATE INDEX "article_relation_tournamentId_idx" ON "article_relation"("tournamentId");

-- CreateIndex
CREATE INDEX "article_relation_playerId_idx" ON "article_relation"("playerId");

-- CreateIndex
CREATE INDEX "article_comment_articleId_createdAt_idx" ON "article_comment"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "article_comment_parentId_idx" ON "article_comment"("parentId");

-- CreateIndex
CREATE INDEX "article_comment_authorPlayerId_idx" ON "article_comment"("authorPlayerId");

-- CreateIndex
CREATE INDEX "comment_report_resolvedAt_idx" ON "comment_report"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "comment_report_commentId_reporterPlayerId_key" ON "comment_report"("commentId", "reporterPlayerId");

-- CreateIndex
CREATE INDEX "editorial_moderation_record_articleId_idx" ON "editorial_moderation_record"("articleId");

-- CreateIndex
CREATE INDEX "editorial_moderation_record_commentId_idx" ON "editorial_moderation_record"("commentId");

-- CreateIndex
CREATE INDEX "editorial_moderation_record_createdAt_idx" ON "editorial_moderation_record"("createdAt");

-- CreateIndex
CREATE INDEX "article_daily_metric_day_idx" ON "article_daily_metric"("day");

-- CreateIndex
CREATE UNIQUE INDEX "article_daily_metric_articleId_day_key" ON "article_daily_metric"("articleId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "editorial_page_slug_key" ON "editorial_page"("slug");

-- CreateIndex
CREATE INDEX "editorial_page_state_publishAt_idx" ON "editorial_page"("state", "publishAt");

-- AddForeignKey
ALTER TABLE "article_tag_link" ADD CONSTRAINT "article_tag_link_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tag_link" ADD CONSTRAINT "article_tag_link_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "article_tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article" ADD CONSTRAINT "article_authorPlayerId_fkey" FOREIGN KEY ("authorPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article" ADD CONSTRAINT "article_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "article_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article" ADD CONSTRAINT "article_reviewerPlayerId_fkey" FOREIGN KEY ("reviewerPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_slug_history" ADD CONSTRAINT "article_slug_history_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_revision" ADD CONSTRAINT "article_revision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_relation" ADD CONSTRAINT "article_relation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_relation" ADD CONSTRAINT "article_relation_competitionSeriesId_fkey" FOREIGN KEY ("competitionSeriesId") REFERENCES "competition_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_relation" ADD CONSTRAINT "article_relation_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_relation" ADD CONSTRAINT "article_relation_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "comp_tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_relation" ADD CONSTRAINT "article_relation_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comment" ADD CONSTRAINT "article_comment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comment" ADD CONSTRAINT "article_comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "article_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comment" ADD CONSTRAINT "article_comment_authorPlayerId_fkey" FOREIGN KEY ("authorPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_report" ADD CONSTRAINT "comment_report_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "article_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_daily_metric" ADD CONSTRAINT "article_daily_metric_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
