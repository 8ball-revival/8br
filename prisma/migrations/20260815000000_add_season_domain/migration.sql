-- CreateEnum
CREATE TYPE "SeasonLifecycleState" AS ENUM ('REGISTRATION_SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUP_SETUP', 'GROUP_STAGE_LIVE', 'GROUPS_CLOSED', 'PLAYOFF_SETUP', 'PLAYOFFS_LIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SeasonEntrantStatus" AS ENUM ('PENDING', 'APPROVED', 'WITHDRAWN', 'KICKED_OUT');

-- CreateEnum
CREATE TYPE "SeasonMatchStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'FORFEIT', 'NO_CONTEST', 'VOID');

-- CreateEnum
CREATE TYPE "SeasonQualification" AS ENUM ('NOT_SELECTED', 'AUTOMATIC', 'WILDCARD', 'DISQUALIFIED', 'KICKED_OUT');



-- CreateTable
CREATE TABLE "season" (
    "id" SERIAL NOT NULL,
    "number" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "subtitle" TEXT,
    "lifecycleState" "SeasonLifecycleState" NOT NULL DEFAULT 'REGISTRATION_SCHEDULED',
    "lounge" TEXT NOT NULL DEFAULT 'Social',
    "accessMode" "AccessMode" NOT NULL DEFAULT 'OPEN',
    "joinPasswordHash" TEXT,
    "registrationOpensAt" TIMESTAMP(3),
    "scheduledStartAt" TIMESTAMP(3),
    "description" TEXT,
    "bannerMediaId" TEXT,
    "groupStageGames" INTEGER NOT NULL DEFAULT 10,
    "earlyRaceTo" INTEGER NOT NULL DEFAULT 7,
    "semifinalRaceTo" INTEGER NOT NULL DEFAULT 9,
    "finalRaceTo" INTEGER NOT NULL DEFAULT 9,
    "playoffDoubleElim" BOOLEAN NOT NULL DEFAULT false,
    "ratingSnapshotAt" TIMESTAMP(3),
    "ladderAppliedAt" TIMESTAMP(3),
    "entrantsCount" INTEGER NOT NULL DEFAULT 0,
    "championName" TEXT,
    "championHandle" TEXT,
    "championPlayerId" TEXT,
    "runnerUpName" TEXT,
    "runnerUpHandle" TEXT,
    "finalScore" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_entrant" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "userId" INTEGER,
    "playerId" TEXT,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "cueverseId" TEXT,
    "status" "SeasonEntrantStatus" NOT NULL DEFAULT 'APPROVED',
    "seed" INTEGER,
    "addedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "ratingSnapshot" INTEGER,
    "playoffIncluded" BOOLEAN NOT NULL DEFAULT false,
    "qualification" "SeasonQualification" NOT NULL DEFAULT 'NOT_SELECTED',
    "qualificationReason" TEXT,
    "playoffSeed" INTEGER,
    "kickedOut" BOOLEAN NOT NULL DEFAULT false,
    "kickedReason" TEXT,
    "kickedAt" TIMESTAMP(3),
    "kickedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_entrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_group" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "ordinal" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "generationSeed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "season_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_group_player" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "entrantId" INTEGER NOT NULL,
    "seed" INTEGER,

    CONSTRAINT "season_group_player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_match" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "homeEntrantId" INTEGER NOT NULL,
    "awayEntrantId" INTEGER NOT NULL,
    "homeUsername" TEXT NOT NULL,
    "awayUsername" TEXT NOT NULL,
    "status" "SeasonMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "homeGames" INTEGER,
    "awayGames" INTEGER,
    "winnerEntrantId" INTEGER,
    "loserEntrantId" INTEGER,
    "forfeitEntrantId" INTEGER,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_standing" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "entrantId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "gamesLost" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "qualified" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_standing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_playoff_match" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "label" TEXT,
    "homeEntrantId" INTEGER,
    "awayEntrantId" INTEGER,
    "homeUsername" TEXT,
    "awayUsername" TEXT,
    "homeSeed" INTEGER,
    "awaySeed" INTEGER,
    "homeGames" INTEGER,
    "awayGames" INTEGER,
    "status" "SeasonMatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "winnerEntrantId" INTEGER,
    "verification" "VerificationState" NOT NULL DEFAULT 'UNVERIFIED',
    "note" TEXT,
    "feedsMatchId" INTEGER,
    "feedsSlot" INTEGER,
    "loserFeedsMatchId" INTEGER,
    "loserFeedsSlot" INTEGER,
    "section" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_playoff_match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "season_number_key" ON "season"("number");

-- CreateIndex
CREATE UNIQUE INDEX "season_slug_key" ON "season"("slug");

-- CreateIndex
CREATE INDEX "season_lifecycleState_idx" ON "season"("lifecycleState");

-- CreateIndex
CREATE INDEX "season_entrant_seasonId_idx" ON "season_entrant"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "season_entrant_seasonId_userId_key" ON "season_entrant"("seasonId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "season_entrant_seasonId_playerId_key" ON "season_entrant"("seasonId", "playerId");

-- CreateIndex
CREATE INDEX "season_group_seasonId_idx" ON "season_group"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "season_group_seasonId_code_key" ON "season_group"("seasonId", "code");

-- CreateIndex
CREATE INDEX "season_group_player_entrantId_idx" ON "season_group_player"("entrantId");

-- CreateIndex
CREATE UNIQUE INDEX "season_group_player_groupId_entrantId_key" ON "season_group_player"("groupId", "entrantId");

-- CreateIndex
CREATE INDEX "season_match_groupId_idx" ON "season_match"("groupId");

-- CreateIndex
CREATE INDEX "season_match_seasonId_status_idx" ON "season_match"("seasonId", "status");

-- CreateIndex
CREATE INDEX "season_standing_seasonId_idx" ON "season_standing"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "season_standing_groupId_entrantId_key" ON "season_standing"("groupId", "entrantId");

-- CreateIndex
CREATE INDEX "season_playoff_match_seasonId_round_slot_idx" ON "season_playoff_match"("seasonId", "round", "slot");

-- AddForeignKey
ALTER TABLE "season_entrant" ADD CONSTRAINT "season_entrant_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_group" ADD CONSTRAINT "season_group_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_group_player" ADD CONSTRAINT "season_group_player_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "season_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_group_player" ADD CONSTRAINT "season_group_player_entrantId_fkey" FOREIGN KEY ("entrantId") REFERENCES "season_entrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_match" ADD CONSTRAINT "season_match_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_match" ADD CONSTRAINT "season_match_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "season_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_standing" ADD CONSTRAINT "season_standing_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_standing" ADD CONSTRAINT "season_standing_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "season_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_playoff_match" ADD CONSTRAINT "season_playoff_match_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

