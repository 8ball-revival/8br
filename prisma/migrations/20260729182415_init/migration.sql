-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('IMPORTED_8BRCAM', 'NATIVE_EGO');

-- CreateEnum
CREATE TYPE "CompetitorType" AS ENUM ('PLAYER', 'TEAM');

-- CreateEnum
CREATE TYPE "AliasType" AS ENUM ('HANDLE', 'YAHOO_MESSENGER', 'EMAIL', 'FORUM', 'OTHER');

-- CreateEnum
CREATE TYPE "CompetitionStatus" AS ENUM ('UPCOMING', 'REGISTRATION_OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StageFormatFamily" AS ENUM ('GROUP_BASED', 'BRACKET_BASED', 'SINGLE_MATCH', 'HYBRID');

-- CreateEnum
CREATE TYPE "BracketType" AS ENUM ('MAIN', 'WINNERS', 'LOSERS', 'CONSOLATION', 'FINALS');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'WALKOVER', 'FORFEIT', 'BYE', 'VOID', 'DISPUTED');

-- CreateEnum
CREATE TYPE "MatchFormatKind" AS ENUM ('RACE_TO', 'BEST_OF');

-- CreateEnum
CREATE TYPE "RecordConfidence" AS ENUM ('EXPLICIT', 'HEURISTIC_LABEL', 'HEURISTIC_COUNT', 'RECONSTRUCTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('REGISTERED', 'CONFIRMED', 'WAITLISTED', 'WITHDRAWN', 'DISQUALIFIED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PROPOSED', 'APPROVED', 'APPLIED', 'REJECTED', 'REVERTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'TRIAGED', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('FILE_ROW', 'URL', 'WAYBACK', 'MANUAL_REVIEW', 'IMPORT_JOB', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordType" AS ENUM ('PLAYER', 'PLAYER_ALIAS', 'TEAM', 'COMPETITOR', 'COMPETITION', 'DIVISION', 'STAGE', 'GROUP', 'BRACKET', 'MATCH', 'MATCH_RESULT', 'STANDING_ROW', 'SEED', 'COMPETITION_ENTRY', 'CHAMPIONSHIP', 'ACHIEVEMENT', 'RANKING_SNAPSHOT', 'RANKING_SNAPSHOT_ITEM', 'HALL_OF_FAME_ENTRY', 'HEAD_TO_HEAD', 'PLAYER_MERGE', 'PLAYER_SPLIT');

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "legacyPlayerId" TEXT,
    "primaryName" TEXT NOT NULL,
    "country" TEXT,
    "firstYear" INTEGER,
    "lastYear" INTEGER,
    "primaryYm" TEXT,
    "primaryEmail" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAlias" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasType" "AliasType" NOT NULL DEFAULT 'HANDLE',
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "country" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "role" TEXT,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "type" "CompetitorType" NOT NULL DEFAULT 'PLAYER',
    "playerId" TEXT,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompetitionType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "competitionTypeId" TEXT NOT NULL,
    "legacyId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "edition" TEXT,
    "year" INTEGER,
    "period" TEXT,
    "era" TEXT,
    "status" "CompetitionStatus" NOT NULL DEFAULT 'UPCOMING',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "rulesRef" TEXT,
    "metadata" JSONB,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "legacyId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageFormat" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "family" "StageFormatFamily" NOT NULL,
    "description" TEXT,
    "configSchema" JSONB,

    CONSTRAINT "StageFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "divisionId" TEXT,
    "stageFormatId" TEXT NOT NULL,
    "legacyId" TEXT,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "config" JSONB,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "divisionId" TEXT,
    "legacyId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "scoreModel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bracket" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "legacyId" TEXT,
    "type" "BracketType" NOT NULL DEFAULT 'MAIN',
    "name" TEXT,
    "size" INTEGER,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',

    CONSTRAINT "Bracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seed" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "bracketId" TEXT,
    "competitorId" TEXT NOT NULL,
    "seedNo" INTEGER NOT NULL,
    "handle" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',

    CONSTRAINT "Seed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionEntry" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "divisionId" TEXT,
    "competitorId" TEXT NOT NULL,
    "seed" INTEGER,
    "status" "EntryStatus" NOT NULL DEFAULT 'REGISTERED',
    "registeredAt" TIMESTAMP(3),
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchFormat" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MatchFormatKind" NOT NULL DEFAULT 'RACE_TO',
    "raceLength" INTEGER NOT NULL,
    "description" TEXT,

    CONSTRAINT "MatchFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "legacyMatchId" TEXT,
    "competitionId" TEXT NOT NULL,
    "divisionId" TEXT,
    "stageId" TEXT NOT NULL,
    "groupId" TEXT,
    "bracketId" TEXT,
    "matchFormatId" TEXT,
    "bracketType" "BracketType",
    "round" INTEGER,
    "roundName" TEXT,
    "matchNo" INTEGER,
    "competitorAId" TEXT NOT NULL,
    "competitorBId" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "scoreA" INTEGER NOT NULL DEFAULT 0,
    "scoreB" INTEGER NOT NULL DEFAULT 0,
    "isDraw" BOOLEAN NOT NULL DEFAULT false,
    "winnerCompetitorId" TEXT,
    "scoreModel" TEXT,
    "confidence" "RecordConfidence" NOT NULL DEFAULT 'EXPLICIT',
    "enteredByUserId" TEXT,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandingRow" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "slot" INTEGER,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "gamesFor" INTEGER NOT NULL DEFAULT 0,
    "gamesAgainst" INTEGER NOT NULL DEFAULT 0,
    "winPct" DOUBLE PRECISION,
    "points" DOUBLE PRECISION,
    "bonus" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "rank" INTEGER,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',

    CONSTRAINT "StandingRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeadToHead" (
    "id" TEXT NOT NULL,
    "competitorLoId" TEXT NOT NULL,
    "competitorHiId" TEXT NOT NULL,
    "matches" INTEGER NOT NULL DEFAULT 0,
    "loWins" INTEGER NOT NULL DEFAULT 0,
    "hiWins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "loGames" INTEGER NOT NULL DEFAULT 0,
    "hiGames" INTEGER NOT NULL DEFAULT 0,
    "groupMatches" INTEGER NOT NULL DEFAULT 0,
    "playoffMatches" INTEGER NOT NULL DEFAULT 0,
    "lastCompetitionId" TEXT,

    CONSTRAINT "HeadToHead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Championship" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT,
    "competitionId" TEXT NOT NULL,
    "divisionId" TEXT,
    "championCompetitorId" TEXT,
    "runnerUpCompetitorId" TEXT,
    "championHandle" TEXT,
    "confidence" "RecordConfidence" NOT NULL DEFAULT 'EXPLICIT',
    "bracketReconstructed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Championship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT,
    "playerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "competitionId" TEXT,
    "divisionCode" TEXT,
    "value" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSystem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB,

    CONSTRAINT "RankingSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSnapshot" (
    "id" TEXT NOT NULL,
    "rankingSystemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "note" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSnapshotItem" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "value" DOUBLE PRECISION,
    "movement" INTEGER,
    "detail" JSONB,

    CONSTRAINT "RankingSnapshotItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallOfFameEntry" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "category" TEXT,
    "rank" INTEGER,
    "value" TEXT,
    "citation" TEXT,
    "inductedYear" INTEGER,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HallOfFameEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerSeasonStat" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "divisionCode" TEXT,
    "groupPlayed" INTEGER NOT NULL DEFAULT 0,
    "groupWins" INTEGER NOT NULL DEFAULT 0,
    "groupLosses" INTEGER NOT NULL DEFAULT 0,
    "groupPoints" DOUBLE PRECISION,
    "groupWinPct" DOUBLE PRECISION,
    "madePlayoffs" BOOLEAN NOT NULL DEFAULT false,
    "playoffSeed" INTEGER,
    "result" TEXT,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',

    CONSTRAINT "PlayerSeasonStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerCareerStat" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "seasonsPlayed" INTEGER NOT NULL DEFAULT 0,
    "totalMatches" INTEGER NOT NULL DEFAULT 0,
    "totalWins" INTEGER NOT NULL DEFAULT 0,
    "totalLosses" INTEGER NOT NULL DEFAULT 0,
    "totalWinPct" DOUBLE PRECISION,
    "championships" INTEGER NOT NULL DEFAULT 0,
    "runnerUps" INTEGER NOT NULL DEFAULT 0,
    "finalsAppearances" INTEGER NOT NULL DEFAULT 0,
    "semifinals" INTEGER NOT NULL DEFAULT 0,
    "playoffAppearances" INTEGER NOT NULL DEFAULT 0,
    "longestTitleStreak" INTEGER NOT NULL DEFAULT 0,
    "longestPlayoffRun" INTEGER NOT NULL DEFAULT 0,
    "provenance" "Provenance" NOT NULL DEFAULT 'NATIVE_EGO',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerCareerStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerMerge" (
    "id" TEXT NOT NULL,
    "canonicalPlayerId" TEXT NOT NULL,
    "mergedPlayerId" TEXT NOT NULL,
    "note" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerMerge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerSplit" (
    "id" TEXT NOT NULL,
    "sourcePlayerId" TEXT NOT NULL,
    "newPlayerId" TEXT NOT NULL,
    "competitionId" TEXT,
    "divisionCode" TEXT,
    "newPrimaryName" TEXT,
    "note" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceReference" (
    "id" TEXT NOT NULL,
    "targetType" "RecordType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "locator" TEXT NOT NULL,
    "note" TEXT,
    "confidence" "RecordConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalCorrection" (
    "id" TEXT NOT NULL,
    "targetType" "RecordType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "reason" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "sourceReferenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueReport" (
    "id" TEXT NOT NULL,
    "targetType" "RecordType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "suggestedCorrection" TEXT,
    "reportedByUserId" TEXT,
    "reporterContact" TEXT,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_legacyPlayerId_key" ON "Player"("legacyPlayerId");

-- CreateIndex
CREATE INDEX "Player_primaryName_idx" ON "Player"("primaryName");

-- CreateIndex
CREATE INDEX "Player_provenance_idx" ON "Player"("provenance");

-- CreateIndex
CREATE INDEX "PlayerAlias_alias_idx" ON "PlayerAlias"("alias");

-- CreateIndex
CREATE INDEX "PlayerAlias_aliasType_idx" ON "PlayerAlias"("aliasType");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAlias_playerId_alias_aliasType_key" ON "PlayerAlias"("playerId", "alias", "aliasType");

-- CreateIndex
CREATE UNIQUE INDEX "Team_legacyId_key" ON "Team"("legacyId");

-- CreateIndex
CREATE INDEX "Team_name_idx" ON "Team"("name");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_idx" ON "TeamMembership"("teamId");

-- CreateIndex
CREATE INDEX "TeamMembership_playerId_idx" ON "TeamMembership"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_teamId_playerId_joinedAt_key" ON "TeamMembership"("teamId", "playerId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_playerId_key" ON "Competitor"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_teamId_key" ON "Competitor"("teamId");

-- CreateIndex
CREATE INDEX "Competitor_type_idx" ON "Competitor"("type");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionType_code_key" ON "CompetitionType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_legacyId_key" ON "Competition"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_slug_key" ON "Competition"("slug");

-- CreateIndex
CREATE INDEX "Competition_competitionTypeId_idx" ON "Competition"("competitionTypeId");

-- CreateIndex
CREATE INDEX "Competition_status_idx" ON "Competition"("status");

-- CreateIndex
CREATE INDEX "Competition_year_idx" ON "Competition"("year");

-- CreateIndex
CREATE UNIQUE INDEX "Division_legacyId_key" ON "Division"("legacyId");

-- CreateIndex
CREATE INDEX "Division_competitionId_idx" ON "Division"("competitionId");

-- CreateIndex
CREATE UNIQUE INDEX "Division_competitionId_code_key" ON "Division"("competitionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StageFormat_code_key" ON "StageFormat"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_legacyId_key" ON "Stage"("legacyId");

-- CreateIndex
CREATE INDEX "Stage_competitionId_idx" ON "Stage"("competitionId");

-- CreateIndex
CREATE INDEX "Stage_divisionId_idx" ON "Stage"("divisionId");

-- CreateIndex
CREATE INDEX "Stage_stageFormatId_idx" ON "Stage"("stageFormatId");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_competitionId_sequence_divisionId_key" ON "Stage"("competitionId", "sequence", "divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_legacyId_key" ON "Group"("legacyId");

-- CreateIndex
CREATE INDEX "Group_stageId_idx" ON "Group"("stageId");

-- CreateIndex
CREATE INDEX "Group_divisionId_idx" ON "Group"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Bracket_legacyId_key" ON "Bracket"("legacyId");

-- CreateIndex
CREATE INDEX "Bracket_stageId_idx" ON "Bracket"("stageId");

-- CreateIndex
CREATE INDEX "Seed_stageId_idx" ON "Seed"("stageId");

-- CreateIndex
CREATE INDEX "Seed_bracketId_idx" ON "Seed"("bracketId");

-- CreateIndex
CREATE INDEX "Seed_competitorId_idx" ON "Seed"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "Seed_stageId_competitorId_key" ON "Seed"("stageId", "competitorId");

-- CreateIndex
CREATE INDEX "CompetitionEntry_competitionId_idx" ON "CompetitionEntry"("competitionId");

-- CreateIndex
CREATE INDEX "CompetitionEntry_competitorId_idx" ON "CompetitionEntry"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionEntry_competitionId_competitorId_divisionId_key" ON "CompetitionEntry"("competitionId", "competitorId", "divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchFormat_code_key" ON "MatchFormat"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Match_legacyMatchId_key" ON "Match"("legacyMatchId");

-- CreateIndex
CREATE INDEX "Match_competitionId_idx" ON "Match"("competitionId");

-- CreateIndex
CREATE INDEX "Match_stageId_idx" ON "Match"("stageId");

-- CreateIndex
CREATE INDEX "Match_groupId_idx" ON "Match"("groupId");

-- CreateIndex
CREATE INDEX "Match_bracketId_idx" ON "Match"("bracketId");

-- CreateIndex
CREATE INDEX "Match_competitorAId_idx" ON "Match"("competitorAId");

-- CreateIndex
CREATE INDEX "Match_competitorBId_idx" ON "Match"("competitorBId");

-- CreateIndex
CREATE INDEX "Match_competitionId_round_idx" ON "Match"("competitionId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "MatchResult_matchId_key" ON "MatchResult"("matchId");

-- CreateIndex
CREATE INDEX "MatchResult_winnerCompetitorId_idx" ON "MatchResult"("winnerCompetitorId");

-- CreateIndex
CREATE INDEX "MatchResult_confidence_idx" ON "MatchResult"("confidence");

-- CreateIndex
CREATE INDEX "StandingRow_groupId_idx" ON "StandingRow"("groupId");

-- CreateIndex
CREATE INDEX "StandingRow_competitorId_idx" ON "StandingRow"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "StandingRow_groupId_competitorId_key" ON "StandingRow"("groupId", "competitorId");

-- CreateIndex
CREATE INDEX "HeadToHead_competitorLoId_idx" ON "HeadToHead"("competitorLoId");

-- CreateIndex
CREATE INDEX "HeadToHead_competitorHiId_idx" ON "HeadToHead"("competitorHiId");

-- CreateIndex
CREATE UNIQUE INDEX "HeadToHead_competitorLoId_competitorHiId_key" ON "HeadToHead"("competitorLoId", "competitorHiId");

-- CreateIndex
CREATE UNIQUE INDEX "Championship_legacyId_key" ON "Championship"("legacyId");

-- CreateIndex
CREATE INDEX "Championship_competitionId_idx" ON "Championship"("competitionId");

-- CreateIndex
CREATE INDEX "Championship_championCompetitorId_idx" ON "Championship"("championCompetitorId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_legacyId_key" ON "Achievement"("legacyId");

-- CreateIndex
CREATE INDEX "Achievement_playerId_idx" ON "Achievement"("playerId");

-- CreateIndex
CREATE INDEX "Achievement_code_idx" ON "Achievement"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RankingSystem_code_key" ON "RankingSystem"("code");

-- CreateIndex
CREATE INDEX "RankingSnapshot_rankingSystemId_idx" ON "RankingSnapshot"("rankingSystemId");

-- CreateIndex
CREATE INDEX "RankingSnapshot_asOf_idx" ON "RankingSnapshot"("asOf");

-- CreateIndex
CREATE INDEX "RankingSnapshotItem_snapshotId_rank_idx" ON "RankingSnapshotItem"("snapshotId", "rank");

-- CreateIndex
CREATE INDEX "RankingSnapshotItem_competitorId_idx" ON "RankingSnapshotItem"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "RankingSnapshotItem_snapshotId_competitorId_key" ON "RankingSnapshotItem"("snapshotId", "competitorId");

-- CreateIndex
CREATE INDEX "HallOfFameEntry_playerId_idx" ON "HallOfFameEntry"("playerId");

-- CreateIndex
CREATE INDEX "HallOfFameEntry_category_idx" ON "HallOfFameEntry"("category");

-- CreateIndex
CREATE INDEX "PlayerSeasonStat_playerId_idx" ON "PlayerSeasonStat"("playerId");

-- CreateIndex
CREATE INDEX "PlayerSeasonStat_competitionId_idx" ON "PlayerSeasonStat"("competitionId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSeasonStat_playerId_competitionId_divisionCode_key" ON "PlayerSeasonStat"("playerId", "competitionId", "divisionCode");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerCareerStat_playerId_key" ON "PlayerCareerStat"("playerId");

-- CreateIndex
CREATE INDEX "PlayerMerge_canonicalPlayerId_idx" ON "PlayerMerge"("canonicalPlayerId");

-- CreateIndex
CREATE INDEX "PlayerMerge_mergedPlayerId_idx" ON "PlayerMerge"("mergedPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerMerge_canonicalPlayerId_mergedPlayerId_key" ON "PlayerMerge"("canonicalPlayerId", "mergedPlayerId");

-- CreateIndex
CREATE INDEX "PlayerSplit_sourcePlayerId_idx" ON "PlayerSplit"("sourcePlayerId");

-- CreateIndex
CREATE INDEX "PlayerSplit_newPlayerId_idx" ON "PlayerSplit"("newPlayerId");

-- CreateIndex
CREATE INDEX "SourceReference_targetType_targetId_idx" ON "SourceReference"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "SourceReference_kind_idx" ON "SourceReference"("kind");

-- CreateIndex
CREATE INDEX "HistoricalCorrection_targetType_targetId_idx" ON "HistoricalCorrection"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "HistoricalCorrection_status_idx" ON "HistoricalCorrection"("status");

-- CreateIndex
CREATE INDEX "IssueReport_targetType_targetId_idx" ON "IssueReport"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "IssueReport_status_idx" ON "IssueReport"("status");

-- AddForeignKey
ALTER TABLE "PlayerAlias" ADD CONSTRAINT "PlayerAlias_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_competitionTypeId_fkey" FOREIGN KEY ("competitionTypeId") REFERENCES "CompetitionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Division" ADD CONSTRAINT "Division_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_stageFormatId_fkey" FOREIGN KEY ("stageFormatId") REFERENCES "StageFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bracket" ADD CONSTRAINT "Bracket_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seed" ADD CONSTRAINT "Seed_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seed" ADD CONSTRAINT "Seed_bracketId_fkey" FOREIGN KEY ("bracketId") REFERENCES "Bracket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seed" ADD CONSTRAINT "Seed_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEntry" ADD CONSTRAINT "CompetitionEntry_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_bracketId_fkey" FOREIGN KEY ("bracketId") REFERENCES "Bracket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_matchFormatId_fkey" FOREIGN KEY ("matchFormatId") REFERENCES "MatchFormat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitorAId_fkey" FOREIGN KEY ("competitorAId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitorBId_fkey" FOREIGN KEY ("competitorBId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_winnerCompetitorId_fkey" FOREIGN KEY ("winnerCompetitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingRow" ADD CONSTRAINT "StandingRow_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandingRow" ADD CONSTRAINT "StandingRow_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadToHead" ADD CONSTRAINT "HeadToHead_competitorLoId_fkey" FOREIGN KEY ("competitorLoId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeadToHead" ADD CONSTRAINT "HeadToHead_competitorHiId_fkey" FOREIGN KEY ("competitorHiId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_championCompetitorId_fkey" FOREIGN KEY ("championCompetitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_runnerUpCompetitorId_fkey" FOREIGN KEY ("runnerUpCompetitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_rankingSystemId_fkey" FOREIGN KEY ("rankingSystemId") REFERENCES "RankingSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshotItem" ADD CONSTRAINT "RankingSnapshotItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshotItem" ADD CONSTRAINT "RankingSnapshotItem_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallOfFameEntry" ADD CONSTRAINT "HallOfFameEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSeasonStat" ADD CONSTRAINT "PlayerSeasonStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSeasonStat" ADD CONSTRAINT "PlayerSeasonStat_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerCareerStat" ADD CONSTRAINT "PlayerCareerStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMerge" ADD CONSTRAINT "PlayerMerge_canonicalPlayerId_fkey" FOREIGN KEY ("canonicalPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMerge" ADD CONSTRAINT "PlayerMerge_mergedPlayerId_fkey" FOREIGN KEY ("mergedPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSplit" ADD CONSTRAINT "PlayerSplit_sourcePlayerId_fkey" FOREIGN KEY ("sourcePlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSplit" ADD CONSTRAINT "PlayerSplit_newPlayerId_fkey" FOREIGN KEY ("newPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
