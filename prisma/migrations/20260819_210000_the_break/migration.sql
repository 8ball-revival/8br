-- The Break: one sitewide community — posts, threaded comments, voting, moderation.
--
-- ADDITIVE AND FORWARD-ONLY. Nothing here drops or alters an existing table. The editorial tables
-- (article, article_comment, …) are deliberately left in place: the data migration reads them, and
-- keeping them is what makes the compatibility period real rather than a promise.
--
-- The three ALTER INDEX ... RENAME statements below are PRE-EXISTING DRIFT, not part of this
-- feature: earlier migrations named two indexes by hand and the schema expects Prisma's generated
-- names. The diff picks them up, and renaming an index is safe and non-destructive, so they are
-- applied here rather than left to surprise the next migration.

-- CreateEnum
CREATE TYPE "BreakPostType" AS ENUM ('TEXT', 'IMAGE', 'GALLERY', 'GIF', 'VIDEO', 'LINK', 'POLL');

-- CreateEnum
CREATE TYPE "BreakPostState" AS ENUM ('DRAFT', 'PUBLISHED', 'REMOVED', 'DELETED');

-- CreateEnum
CREATE TYPE "BreakMediaKind" AS ENUM ('IMAGE', 'GIF', 'VIDEO');

-- CreateEnum
CREATE TYPE "BreakMediaStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "BreakReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'PERSONAL_INFO', 'CHEATING', 'OFF_TOPIC', 'INAPPROPRIATE_MEDIA', 'IMPERSONATION', 'OTHER');

-- CreateEnum
CREATE TYPE "BreakReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "BreakNotificationKind" AS ENUM ('POST_REPLY', 'COMMENT_REPLY', 'MENTION', 'MOD_REMOVED', 'MOD_RESTORED', 'MOD_LOCKED', 'POLL_CLOSED', 'OFFICIAL_REPLY');

-- CreateTable
CREATE TABLE "break_category" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'gold',
    "adminOnly" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "break_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_post" (
    "id" SERIAL NOT NULL,
    "type" "BreakPostType" NOT NULL DEFAULT 'TEXT',
    "state" "BreakPostState" NOT NULL DEFAULT 'DRAFT',
    "authorPlayerId" TEXT,
    "authorNameSnapshot" TEXT NOT NULL,
    "authorHandleSnapshot" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "slugKey" TEXT NOT NULL,
    "body" JSONB,
    "bodyText" TEXT,
    "categoryId" INTEGER,
    "linkUrl" TEXT,
    "linkDomain" TEXT,
    "linkTitle" TEXT,
    "linkDescription" TEXT,
    "linkImageUrl" TEXT,
    "linkPreviewRemoved" BOOLEAN NOT NULL DEFAULT false,
    "spoiler" BOOLEAN NOT NULL DEFAULT false,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "official" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "pinOrder" INTEGER NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "commentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "muteReplies" BOOLEAN NOT NULL DEFAULT false,
    "removedAt" TIMESTAMP(3),
    "removedByPlayerId" TEXT,
    "removalReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "editedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "saveCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "hotRank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repostOfId" INTEGER,
    "legacyArticleId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "break_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_post_slug" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "slugKey" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_post_slug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_post_media" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "kind" "BreakMediaKind" NOT NULL,
    "status" "BreakMediaStatus" NOT NULL DEFAULT 'READY',
    "url" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "posterUrl" TEXT,
    "captionsUrl" TEXT,
    "alt" TEXT,
    "caption" TEXT,
    "sourceProvider" TEXT NOT NULL DEFAULT 'upload',
    "sourceId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_poll" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "totalVotes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_poll_option" (
    "id" SERIAL NOT NULL,
    "pollId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "voteCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "break_poll_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_poll_vote" (
    "id" SERIAL NOT NULL,
    "pollId" INTEGER NOT NULL,
    "optionId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_poll_vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_comment" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "authorPlayerId" TEXT,
    "authorNameSnapshot" TEXT NOT NULL,
    "authorHandleSnapshot" TEXT,
    "body" JSONB NOT NULL,
    "bodyText" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "distinguished" BOOLEAN NOT NULL DEFAULT false,
    "sticky" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "spoiler" BOOLEAN NOT NULL DEFAULT false,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "muteReplies" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedByPlayerId" TEXT,
    "removalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "break_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_comment_media" (
    "id" SERIAL NOT NULL,
    "commentId" INTEGER NOT NULL,
    "kind" "BreakMediaKind" NOT NULL,
    "status" "BreakMediaStatus" NOT NULL DEFAULT 'READY',
    "url" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "posterUrl" TEXT,
    "alt" TEXT,
    "caption" TEXT,
    "sourceProvider" TEXT NOT NULL DEFAULT 'upload',
    "sourceId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_comment_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_post_vote" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "break_post_vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_comment_vote" (
    "id" SERIAL NOT NULL,
    "commentId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "break_comment_vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_saved_post" (
    "playerId" TEXT NOT NULL,
    "postId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_saved_post_pkey" PRIMARY KEY ("playerId","postId")
);

-- CreateTable
CREATE TABLE "break_saved_comment" (
    "playerId" TEXT NOT NULL,
    "commentId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_saved_comment_pkey" PRIMARY KEY ("playerId","commentId")
);

-- CreateTable
CREATE TABLE "break_hidden_post" (
    "playerId" TEXT NOT NULL,
    "postId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_hidden_post_pkey" PRIMARY KEY ("playerId","postId")
);

-- CreateTable
CREATE TABLE "break_report" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER,
    "commentId" INTEGER,
    "reporterPlayerId" TEXT,
    "reason" "BreakReportReason" NOT NULL,
    "detail" TEXT,
    "status" "BreakReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByPlayerId" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_moderation_action" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "postId" INTEGER,
    "commentId" INTEGER,
    "actorPlayerId" TEXT,
    "actorName" TEXT NOT NULL,
    "publicReason" TEXT,
    "note" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_moderation_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_notification" (
    "id" SERIAL NOT NULL,
    "recipientPlayerId" TEXT NOT NULL,
    "kind" "BreakNotificationKind" NOT NULL,
    "postId" INTEGER,
    "commentId" INTEGER,
    "actorPlayerId" TEXT,
    "actorName" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_karma" (
    "playerId" TEXT NOT NULL,
    "postKarma" INTEGER NOT NULL DEFAULT 0,
    "commentKarma" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "break_karma_pkey" PRIMARY KEY ("playerId")
);

-- CreateTable
CREATE TABLE "break_post_daily_view" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "break_post_daily_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_action_log" (
    "id" BIGSERIAL NOT NULL,
    "playerId" TEXT,
    "clientHash" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_action_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "break_category_slug_key" ON "break_category"("slug");

-- CreateIndex
CREATE INDEX "break_category_active_sortOrder_idx" ON "break_category"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "break_post_slugKey_key" ON "break_post"("slugKey");

-- CreateIndex
CREATE UNIQUE INDEX "break_post_legacyArticleId_key" ON "break_post"("legacyArticleId");

-- CreateIndex
CREATE INDEX "break_post_state_pinned_pinOrder_idx" ON "break_post"("state", "pinned", "pinOrder");

-- CreateIndex
CREATE INDEX "break_post_state_hotRank_idx" ON "break_post"("state", "hotRank");

-- CreateIndex
CREATE INDEX "break_post_state_publishedAt_idx" ON "break_post"("state", "publishedAt");

-- CreateIndex
CREATE INDEX "break_post_state_score_publishedAt_idx" ON "break_post"("state", "score", "publishedAt");

-- CreateIndex
CREATE INDEX "break_post_state_publishedAt_score_idx" ON "break_post"("state", "publishedAt", "score");

-- CreateIndex
CREATE INDEX "break_post_authorPlayerId_state_publishedAt_idx" ON "break_post"("authorPlayerId", "state", "publishedAt");

-- CreateIndex
CREATE INDEX "break_post_categoryId_state_publishedAt_idx" ON "break_post"("categoryId", "state", "publishedAt");

-- CreateIndex
CREATE INDEX "break_post_state_removedAt_deletedAt_idx" ON "break_post"("state", "removedAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "break_post_slug_slugKey_key" ON "break_post_slug"("slugKey");

-- CreateIndex
CREATE INDEX "break_post_slug_postId_idx" ON "break_post_slug"("postId");

-- CreateIndex
CREATE INDEX "break_post_media_postId_position_idx" ON "break_post_media"("postId", "position");

-- CreateIndex
CREATE INDEX "break_post_media_status_idx" ON "break_post_media"("status");

-- CreateIndex
CREATE UNIQUE INDEX "break_poll_postId_key" ON "break_poll"("postId");

-- CreateIndex
CREATE INDEX "break_poll_option_pollId_position_idx" ON "break_poll_option"("pollId", "position");

-- CreateIndex
CREATE INDEX "break_poll_vote_optionId_idx" ON "break_poll_vote"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "break_poll_vote_pollId_playerId_key" ON "break_poll_vote"("pollId", "playerId");

-- CreateIndex
CREATE INDEX "break_comment_postId_path_idx" ON "break_comment"("postId", "path");

-- CreateIndex
CREATE INDEX "break_comment_postId_score_idx" ON "break_comment"("postId", "score");

-- CreateIndex
CREATE INDEX "break_comment_postId_createdAt_idx" ON "break_comment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "break_comment_parentId_idx" ON "break_comment"("parentId");

-- CreateIndex
CREATE INDEX "break_comment_authorPlayerId_createdAt_idx" ON "break_comment"("authorPlayerId", "createdAt");

-- CreateIndex
CREATE INDEX "break_comment_postId_sticky_score_idx" ON "break_comment"("postId", "sticky", "score");

-- CreateIndex
CREATE UNIQUE INDEX "break_comment_media_commentId_key" ON "break_comment_media"("commentId");

-- CreateIndex
CREATE INDEX "break_post_vote_playerId_createdAt_idx" ON "break_post_vote"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "break_post_vote_postId_value_idx" ON "break_post_vote"("postId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "break_post_vote_postId_playerId_key" ON "break_post_vote"("postId", "playerId");

-- CreateIndex
CREATE INDEX "break_comment_vote_playerId_createdAt_idx" ON "break_comment_vote"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "break_comment_vote_commentId_value_idx" ON "break_comment_vote"("commentId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "break_comment_vote_commentId_playerId_key" ON "break_comment_vote"("commentId", "playerId");

-- CreateIndex
CREATE INDEX "break_saved_post_playerId_createdAt_idx" ON "break_saved_post"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "break_saved_comment_playerId_createdAt_idx" ON "break_saved_comment"("playerId", "createdAt");

-- CreateIndex
CREATE INDEX "break_report_status_createdAt_idx" ON "break_report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "break_report_postId_idx" ON "break_report"("postId");

-- CreateIndex
CREATE INDEX "break_report_commentId_idx" ON "break_report"("commentId");

-- CreateIndex
CREATE INDEX "break_moderation_action_postId_createdAt_idx" ON "break_moderation_action"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "break_moderation_action_commentId_createdAt_idx" ON "break_moderation_action"("commentId", "createdAt");

-- CreateIndex
CREATE INDEX "break_moderation_action_createdAt_idx" ON "break_moderation_action"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "break_notification_dedupeKey_key" ON "break_notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "break_notification_recipientPlayerId_readAt_createdAt_idx" ON "break_notification"("recipientPlayerId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "break_post_daily_view_day_idx" ON "break_post_daily_view"("day");

-- CreateIndex
CREATE UNIQUE INDEX "break_post_daily_view_postId_day_key" ON "break_post_daily_view"("postId", "day");

-- CreateIndex
CREATE INDEX "break_action_log_playerId_action_createdAt_idx" ON "break_action_log"("playerId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "break_action_log_clientHash_action_createdAt_idx" ON "break_action_log"("clientHash", "action", "createdAt");

-- CreateIndex
CREATE INDEX "break_action_log_createdAt_idx" ON "break_action_log"("createdAt");

-- AddForeignKey
ALTER TABLE "break_post" ADD CONSTRAINT "break_post_authorPlayerId_fkey" FOREIGN KEY ("authorPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_post" ADD CONSTRAINT "break_post_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "break_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_post" ADD CONSTRAINT "break_post_repostOfId_fkey" FOREIGN KEY ("repostOfId") REFERENCES "break_post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_post_slug" ADD CONSTRAINT "break_post_slug_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_post_media" ADD CONSTRAINT "break_post_media_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_poll" ADD CONSTRAINT "break_poll_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_poll_option" ADD CONSTRAINT "break_poll_option_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "break_poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_poll_vote" ADD CONSTRAINT "break_poll_vote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "break_poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_poll_vote" ADD CONSTRAINT "break_poll_vote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "break_poll_option"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_poll_vote" ADD CONSTRAINT "break_poll_vote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_comment" ADD CONSTRAINT "break_comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_comment" ADD CONSTRAINT "break_comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "break_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_comment" ADD CONSTRAINT "break_comment_authorPlayerId_fkey" FOREIGN KEY ("authorPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_comment_media" ADD CONSTRAINT "break_comment_media_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "break_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_post_vote" ADD CONSTRAINT "break_post_vote_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_post_vote" ADD CONSTRAINT "break_post_vote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_comment_vote" ADD CONSTRAINT "break_comment_vote_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "break_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_comment_vote" ADD CONSTRAINT "break_comment_vote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_saved_post" ADD CONSTRAINT "break_saved_post_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_saved_post" ADD CONSTRAINT "break_saved_post_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_saved_comment" ADD CONSTRAINT "break_saved_comment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_saved_comment" ADD CONSTRAINT "break_saved_comment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "break_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_hidden_post" ADD CONSTRAINT "break_hidden_post_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_hidden_post" ADD CONSTRAINT "break_hidden_post_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_report" ADD CONSTRAINT "break_report_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_report" ADD CONSTRAINT "break_report_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "break_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_report" ADD CONSTRAINT "break_report_reporterPlayerId_fkey" FOREIGN KEY ("reporterPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_notification" ADD CONSTRAINT "break_notification_recipientPlayerId_fkey" FOREIGN KEY ("recipientPlayerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_notification" ADD CONSTRAINT "break_notification_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_notification" ADD CONSTRAINT "break_notification_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "break_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_karma" ADD CONSTRAINT "break_karma_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_post_daily_view" ADD CONSTRAINT "break_post_daily_view_postId_fkey" FOREIGN KEY ("postId") REFERENCES "break_post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "tournament_lifecycle_visible_idx" RENAME TO "comp_tournament_lifecycleState_publiclyVisible_idx";

-- RenameIndex
ALTER INDEX "tournament_reconstruction_idx" RENAME TO "comp_tournament_reconstruction_idx";

-- RenameIndex
ALTER INDEX "season_lifecycle_visible_idx" RENAME TO "season_lifecycleState_publiclyVisible_idx";



-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Things Prisma's schema language cannot express, added by hand.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── Search ─────────────────────────────────────────────────────────────────────────────────────
-- A stored generated tsvector, so search is an index scan rather than a scan of every post with
-- ILIKE. Title is weighted above body: a word in the title is a better match than the same word
-- buried in a paragraph. The author fields are included so searching a CueVerse ID finds their
-- posts, which the spec asks for.
ALTER TABLE "break_post"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("authorNameSnapshot", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("authorHandleSnapshot", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("bodyText", '')), 'C')
  ) STORED;

CREATE INDEX "break_post_search_idx" ON "break_post" USING GIN ("searchVector");

-- Trigram index for partial-word and handle matching, which a tsvector alone does not do well:
-- searching "adnan" should find "x0_adnan_0x".
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "break_post_title_trgm_idx" ON "break_post" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "break_post_author_trgm_idx" ON "break_post" USING GIN ("authorHandleSnapshot" gin_trgm_ops);

-- ── One open report per account, per target, per reason ────────────────────────────────────────
-- Two partial unique indexes rather than one constraint: a report points at EITHER a post or a
-- comment, so the nullable column has to be excluded from each index or NULLs would defeat it.
-- Scoped to OPEN so a member can report the same thing again after a moderator has dealt with it.
CREATE UNIQUE INDEX "break_report_post_unique"
  ON "break_report" ("postId", "reporterPlayerId", "reason")
  WHERE "postId" IS NOT NULL AND "reporterPlayerId" IS NOT NULL AND "status" = 'OPEN';

CREATE UNIQUE INDEX "break_report_comment_unique"
  ON "break_report" ("commentId", "reporterPlayerId", "reason")
  WHERE "commentId" IS NOT NULL AND "reporterPlayerId" IS NOT NULL AND "status" = 'OPEN';

-- A report must name exactly one target. Without this a row with both, or neither, is representable.
ALTER TABLE "break_report"
  ADD CONSTRAINT "break_report_one_target"
  CHECK (("postId" IS NULL) <> ("commentId" IS NULL));

-- ── Votes are +1 or -1, never 0 ────────────────────────────────────────────────────────────────
-- "No vote" is the absence of a row. Allowing a zero would give it two representations, and every
-- count would then have to remember to exclude it.
ALTER TABLE "break_post_vote"
  ADD CONSTRAINT "break_post_vote_value" CHECK ("value" IN (-1, 1));
ALTER TABLE "break_comment_vote"
  ADD CONSTRAINT "break_comment_vote_value" CHECK ("value" IN (-1, 1));

-- ── A poll vote must belong to its own poll ────────────────────────────────────────────────────
-- Without this, an option id from a DIFFERENT poll would be accepted and counted.
CREATE UNIQUE INDEX "break_poll_option_poll_unique" ON "break_poll_option" ("id", "pollId");
ALTER TABLE "break_poll_vote"
  ADD CONSTRAINT "break_poll_vote_option_matches_poll"
  FOREIGN KEY ("optionId", "pollId") REFERENCES "break_poll_option" ("id", "pollId") ON DELETE CASCADE;

-- ── Comment tree ───────────────────────────────────────────────────────────────────────────────
-- The path index supports the one range scan that fetches a whole thread in display order.
CREATE INDEX "break_comment_path_idx" ON "break_comment" ("postId", "path" text_pattern_ops);

-- ── Feed visibility ────────────────────────────────────────────────────────────────────────────
-- Partial indexes over PUBLISHED, visible posts only. The feed never looks at anything else, so the
-- indexes it uses should not carry drafts and removals either.
CREATE INDEX "break_post_public_hot_idx" ON "break_post" ("hotRank" DESC, "id" DESC)
  WHERE "state" = 'PUBLISHED' AND "removedAt" IS NULL AND "deletedAt" IS NULL;
CREATE INDEX "break_post_public_new_idx" ON "break_post" ("publishedAt" DESC, "id" DESC)
  WHERE "state" = 'PUBLISHED' AND "removedAt" IS NULL AND "deletedAt" IS NULL;
CREATE INDEX "break_post_public_top_idx" ON "break_post" ("score" DESC, "commentCount" DESC, "publishedAt" DESC, "id" DESC)
  WHERE "state" = 'PUBLISHED' AND "removedAt" IS NULL AND "deletedAt" IS NULL;

-- ── Seed the starting categories ───────────────────────────────────────────────────────────────
-- Idempotent, so re-running the migration on a database that already has them is a no-op.
INSERT INTO "break_category" ("slug", "name", "description", "color", "adminOnly", "sortOrder", "active", "createdAt", "updatedAt")
VALUES
  ('announcement', 'Announcement', 'Official word from the 8 Ball Registry.', 'gold',   true,  10, true, NOW(), NOW()),
  ('prediction',   'Prediction',   'Calls on matches, Seasons and Cups.',      'purple', false, 20, true, NOW(), NOW()),
  ('history',      'History',      'The archive, the old rooms, the records.', 'blue',   false, 30, true, NOW(), NOW()),
  ('news',         'News',         'What is happening in the game.',           'green',  false, 40, true, NOW(), NOW()),
  ('discussion',   'Discussion',   'Everything else worth talking about.',     'slate',  false, 50, true, NOW(), NOW()),
  ('meme',         'Meme',         'Post the picture.',                        'orange', false, 60, true, NOW(), NOW()),
  ('video',        'Video',        'Clips, runs and highlights.',              'red',    false, 70, true, NOW(), NOW()),
  ('question',     'Question',     'Ask the room.',                            'teal',   false, 80, true, NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;
