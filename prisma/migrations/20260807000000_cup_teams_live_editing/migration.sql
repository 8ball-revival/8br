-- CreateTable
CREATE TABLE "comp_cup_team" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "registrationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "seed" INTEGER,
    "placement" INTEGER,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comp_cup_team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_cup_team_member" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "playerId" TEXT,
    "name" TEXT NOT NULL,
    "handle" TEXT,
    "memberOrder" INTEGER NOT NULL DEFAULT 0,
    "captain" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comp_cup_team_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comp_cup_team_registrationId_key" ON "comp_cup_team"("registrationId");

-- CreateIndex
CREATE INDEX "comp_cup_team_seasonId_idx" ON "comp_cup_team"("seasonId");

-- CreateIndex
CREATE INDEX "comp_cup_team_member_teamId_idx" ON "comp_cup_team_member"("teamId");

-- CreateIndex
CREATE INDEX "comp_cup_team_member_playerId_idx" ON "comp_cup_team_member"("playerId");

-- AddForeignKey
ALTER TABLE "comp_cup_team" ADD CONSTRAINT "comp_cup_team_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "comp_season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_cup_team" ADD CONSTRAINT "comp_cup_team_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "comp_registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_cup_team_member" ADD CONSTRAINT "comp_cup_team_member_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "comp_cup_team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "comp_cup_bracket_match_competitionId_bracketKind_roundOrder_mat" RENAME TO "comp_cup_bracket_match_competitionId_bracketKind_roundOrder_idx";
