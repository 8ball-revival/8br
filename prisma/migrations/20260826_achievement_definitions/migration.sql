-- Achievement definitions: the rule that decides a holder, not the holder itself.
--
-- Additive only. This migration was hand-written rather than taken from `prisma migrate diff`,
-- because the generated diff also carried unrelated drift between the schema file and the live
-- database — it wanted to DROP break_post."searchVector", several trigram/search indexes and a
-- poll constraint, all of which exist in the database via raw SQL that the schema does not model.
-- Applying that would have deleted working search infrastructure as a side effect of adding a
-- table. Only the achievement objects are created here; nothing existing is touched.

CREATE TYPE "AchievementAwardType" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "AchievementStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AchievementScope" AS ENUM ('ALL_COMPETITIONS', 'SEASONS', 'TOURNAMENTS', 'SPECIFIC_COMPETITION', 'SPECIFIC_SEASON', 'SPECIFIC_TOURNAMENT');

-- CreateEnum
CREATE TYPE "AchievementStage" AS ENUM ('ALL_MATCHES', 'GROUP_STAGE', 'PLAYOFFS', 'FINALS');

-- CreateEnum
CREATE TYPE "AchievementWinner" AS ENUM ('HIGHEST', 'LOWEST');

-- CreateEnum
CREATE TYPE "AchievementTiePolicy" AS ENUM ('SHOW_ALL', 'SECONDARY_STAT');

-- CreateEnum
CREATE TYPE "AchievementEmptyBehavior" AS ENUM ('HIDE', 'SHOW_PLACEHOLDER');

CREATE TABLE "achievement_definition" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "flavorText" TEXT,
    "description" TEXT,
    "awardType" "AchievementAwardType" NOT NULL DEFAULT 'AUTOMATIC',
    "status" "AchievementStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "displayFormat" TEXT NOT NULL DEFAULT '{value}',
    "statistic" TEXT,
    "scope" "AchievementScope" NOT NULL DEFAULT 'ALL_COMPETITIONS',
    "competitionId" INTEGER,
    "seasonId" INTEGER,
    "tournamentId" INTEGER,
    "stage" "AchievementStage" NOT NULL DEFAULT 'ALL_MATCHES',
    "winner" "AchievementWinner" NOT NULL DEFAULT 'HIGHEST',
    "platform" "CompetitionPlatform" NOT NULL DEFAULT 'YAHOO',
    "minMatches" INTEGER,
    "minSeasons" INTEGER,
    "minFinals" INTEGER,
    "minPlayoffMatches" INTEGER,
    "tiePolicy" "AchievementTiePolicy" NOT NULL DEFAULT 'SHOW_ALL',
    "tieBreakStat" TEXT,
    "emptyBehavior" "AchievementEmptyBehavior" NOT NULL DEFAULT 'HIDE',
    "manualPlayerId" TEXT,
    "manualValue" TEXT,
    "manualNote" TEXT,
    "manualDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "achievement_definition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "achievement_definition_key_key" ON "achievement_definition"("key");
CREATE INDEX "achievement_definition_status_sortOrder_idx" ON "achievement_definition"("status", "sortOrder");

ALTER TABLE "achievement_definition" ADD CONSTRAINT "achievement_definition_manualPlayerId_fkey" FOREIGN KEY ("manualPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
