-- Unified competition model: Cups become live competitions alongside Seasons.
-- Fully additive — new enums, nullable/defaulted columns on comp_season, and new
-- cup bracket/tie tables. Existing Season 2 data is untouched (competitionType
-- defaults to SEASON).

-- CreateEnum
CREATE TYPE "CompetitionKind" AS ENUM ('SEASON', 'CUP');
CREATE TYPE "ParticipantFormat" AS ENUM ('INDIVIDUAL', 'TEAM');
CREATE TYPE "TournamentFormat" AS ENUM ('SINGLE_ELIM', 'DOUBLE_ELIM', 'GROUPS_PLAYOFFS', 'ROUND_ROBIN', 'TEAM_KNOCKOUT');
CREATE TYPE "CupBracketKind" AS ENUM ('MAIN', 'WINNERS', 'LOSERS', 'GRAND_FINAL');

-- AlterTable
ALTER TABLE "comp_season"
  ADD COLUMN "competitionType" "CompetitionKind" NOT NULL DEFAULT 'SEASON',
  ADD COLUMN "competitionCode" TEXT,
  ADD COLUMN "cupNumber" INTEGER,
  ADD COLUMN "gameType" TEXT,
  ADD COLUMN "participantFormat" "ParticipantFormat" NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN "teamSize" INTEGER,
  ADD COLUMN "tournamentFormat" "TournamentFormat",
  ADD COLUMN "importedFromFixture" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "unlockedAt" TIMESTAMP(3),
  ADD COLUMN "cupFormatBadge" TEXT,
  ADD COLUMN "cupYear" INTEGER,
  ADD COLUMN "cupDate" TEXT,
  ADD COLUMN "cupStatus" TEXT,
  ADD COLUMN "entrantsCount" INTEGER,
  ADD COLUMN "currentRound" TEXT,
  ADD COLUMN "finalScore" TEXT,
  ADD COLUMN "championName" TEXT,
  ADD COLUMN "championHandle" TEXT,
  ADD COLUMN "runnerUpName" TEXT,
  ADD COLUMN "runnerUpHandle" TEXT,
  ADD COLUMN "thirdPlaceName" TEXT,
  ADD COLUMN "thirdPlaceHandle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "comp_season_competitionCode_key" ON "comp_season"("competitionCode");
CREATE UNIQUE INDEX "comp_season_cupNumber_key" ON "comp_season"("cupNumber");
CREATE INDEX "comp_season_competitionType_idx" ON "comp_season"("competitionType");

-- CreateTable
CREATE TABLE "comp_cup_bracket_match" (
  "id" SERIAL NOT NULL,
  "competitionId" INTEGER NOT NULL,
  "bracketKind" "CupBracketKind" NOT NULL DEFAULT 'MAIN',
  "roundName" TEXT NOT NULL,
  "roundOrder" INTEGER NOT NULL,
  "matchOrder" INTEGER NOT NULL,
  "aPresent" BOOLEAN NOT NULL DEFAULT true,
  "aName" TEXT,
  "aHandle" TEXT,
  "aSeed" INTEGER,
  "aScore" INTEGER,
  "bPresent" BOOLEAN NOT NULL DEFAULT true,
  "bName" TEXT,
  "bHandle" TEXT,
  "bSeed" INTEGER,
  "bScore" INTEGER,
  "winner" TEXT,
  "note" TEXT,
  CONSTRAINT "comp_cup_bracket_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_cup_team_tie" (
  "id" SERIAL NOT NULL,
  "competitionId" INTEGER NOT NULL,
  "round" TEXT NOT NULL,
  "roundOrder" INTEGER NOT NULL,
  "homeTeam" TEXT NOT NULL,
  "awayTeam" TEXT NOT NULL,
  "homeWins" INTEGER NOT NULL,
  "awayWins" INTEGER NOT NULL,
  "winner" TEXT NOT NULL,
  CONSTRAINT "comp_cup_team_tie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_cup_tie_match" (
  "id" SERIAL NOT NULL,
  "tieId" INTEGER NOT NULL,
  "matchOrder" INTEGER NOT NULL,
  "homeName" TEXT NOT NULL,
  "homeHandle" TEXT,
  "homeCaptain" BOOLEAN NOT NULL DEFAULT false,
  "awayName" TEXT NOT NULL,
  "awayHandle" TEXT,
  "awayCaptain" BOOLEAN NOT NULL DEFAULT false,
  "homeScore" TEXT,
  "awayScore" TEXT,
  "note" TEXT,
  CONSTRAINT "comp_cup_tie_match_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comp_cup_bracket_match_competitionId_bracketKind_roundOrder_matchOrder_idx" ON "comp_cup_bracket_match"("competitionId", "bracketKind", "roundOrder", "matchOrder");
CREATE INDEX "comp_cup_team_tie_competitionId_roundOrder_idx" ON "comp_cup_team_tie"("competitionId", "roundOrder");
CREATE INDEX "comp_cup_tie_match_tieId_matchOrder_idx" ON "comp_cup_tie_match"("tieId", "matchOrder");

-- AddForeignKey
ALTER TABLE "comp_cup_bracket_match" ADD CONSTRAINT "comp_cup_bracket_match_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "comp_season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comp_cup_team_tie" ADD CONSTRAINT "comp_cup_team_tie_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "comp_season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comp_cup_tie_match" ADD CONSTRAINT "comp_cup_tie_match_tieId_fkey" FOREIGN KEY ("tieId") REFERENCES "comp_cup_team_tie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
