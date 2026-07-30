-- CreateEnum
CREATE TYPE "SeasonState" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RegistrationState" AS ENUM ('NOT_OPEN', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "StageState" AS ENUM ('PENDING', 'PUBLISHED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LiveMatchStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'FORFEIT', 'NO_SHOW', 'DISPUTED');

-- CreateEnum
CREATE TYPE "VerificationState" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateTable
CREATE TABLE "comp_season" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seasonStatus" "SeasonState" NOT NULL DEFAULT 'UPCOMING',
    "registrationStatus" "RegistrationState" NOT NULL DEFAULT 'NOT_OPEN',
    "registrationOpensAt" TIMESTAMP(3),
    "registrationClosesAt" TIMESTAMP(3),
    "groupsStatus" "StageState" NOT NULL DEFAULT 'PENDING',
    "playoffsStatus" "StageState" NOT NULL DEFAULT 'PENDING',
    "raceLength" INTEGER NOT NULL DEFAULT 5,
    "qualifiersPerGroup" INTEGER NOT NULL DEFAULT 2,
    "formatSummary" TEXT NOT NULL DEFAULT 'Group stage into single-elimination playoffs',
    "eligibilitySummary" TEXT NOT NULL DEFAULT 'Open to all registered EGO account holders.',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comp_season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_registration" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "seed" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "approvedByUserId" INTEGER,

    CONSTRAINT "comp_registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_group" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "generationSeed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comp_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_group_player" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "registrationId" INTEGER NOT NULL,
    "seed" INTEGER NOT NULL,

    CONSTRAINT "comp_group_player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_match" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "homeRegistrationId" INTEGER NOT NULL,
    "awayRegistrationId" INTEGER NOT NULL,
    "homeUsername" TEXT NOT NULL,
    "awayUsername" TEXT NOT NULL,
    "status" "LiveMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "homeGames" INTEGER,
    "awayGames" INTEGER,
    "winnerRegistrationId" INTEGER,
    "loserRegistrationId" INTEGER,
    "verification" "VerificationState" NOT NULL DEFAULT 'UNVERIFIED',
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comp_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_playoff_match" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "label" TEXT,
    "homeRegistrationId" INTEGER,
    "awayRegistrationId" INTEGER,
    "homeUsername" TEXT,
    "awayUsername" TEXT,
    "homeSeed" INTEGER,
    "awaySeed" INTEGER,
    "homeGames" INTEGER,
    "awayGames" INTEGER,
    "status" "LiveMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "winnerRegistrationId" INTEGER,
    "verification" "VerificationState" NOT NULL DEFAULT 'UNVERIFIED',
    "feedsMatchId" INTEGER,
    "feedsSlot" INTEGER,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comp_playoff_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_standing" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "registrationId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "gamesLost" INTEGER NOT NULL DEFAULT 0,
    "gameDiff" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "qualified" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comp_standing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_audit_log" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" INTEGER NOT NULL,
    "actorUsername" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,

    CONSTRAINT "comp_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comp_season_slug_key" ON "comp_season"("slug");

-- CreateIndex
CREATE INDEX "comp_registration_seasonId_status_idx" ON "comp_registration"("seasonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "comp_registration_seasonId_userId_key" ON "comp_registration"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "comp_group_seasonId_idx" ON "comp_group"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "comp_group_seasonId_code_key" ON "comp_group"("seasonId", "code");

-- CreateIndex
CREATE INDEX "comp_group_player_groupId_idx" ON "comp_group_player"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "comp_group_player_groupId_registrationId_key" ON "comp_group_player"("groupId", "registrationId");

-- CreateIndex
CREATE INDEX "comp_match_groupId_idx" ON "comp_match"("groupId");

-- CreateIndex
CREATE INDEX "comp_match_seasonId_verification_idx" ON "comp_match"("seasonId", "verification");

-- CreateIndex
CREATE INDEX "comp_match_seasonId_status_idx" ON "comp_match"("seasonId", "status");

-- CreateIndex
CREATE INDEX "comp_playoff_match_seasonId_round_slot_idx" ON "comp_playoff_match"("seasonId", "round", "slot");

-- CreateIndex
CREATE INDEX "comp_standing_seasonId_idx" ON "comp_standing"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "comp_standing_groupId_registrationId_key" ON "comp_standing"("groupId", "registrationId");

-- CreateIndex
CREATE INDEX "comp_audit_log_createdAt_idx" ON "comp_audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "comp_audit_log_entity_entityId_idx" ON "comp_audit_log"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "comp_registration" ADD CONSTRAINT "comp_registration_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "comp_season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_group" ADD CONSTRAINT "comp_group_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "comp_season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_group_player" ADD CONSTRAINT "comp_group_player_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "comp_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_group_player" ADD CONSTRAINT "comp_group_player_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "comp_registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_match" ADD CONSTRAINT "comp_match_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "comp_season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_match" ADD CONSTRAINT "comp_match_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "comp_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_playoff_match" ADD CONSTRAINT "comp_playoff_match_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "comp_season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_standing" ADD CONSTRAINT "comp_standing_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "comp_season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_standing" ADD CONSTRAINT "comp_standing_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "comp_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
