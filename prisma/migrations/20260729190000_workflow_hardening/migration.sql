-- CreateEnum
CREATE TYPE "MatchResolution" AS ENUM ('PLAYED', 'WALKOVER', 'FORFEIT', 'DOUBLE_FORFEIT', 'BYE', 'RETIREMENT', 'ADMIN_DECISION');

-- CreateEnum
CREATE TYPE "RegistrationMode" AS ENUM ('OPEN', 'INVITE_ONLY', 'CLOSED');

-- CreateEnum
CREATE TYPE "EntryMethod" AS ENUM ('PUBLIC_REGISTRATION', 'ADMIN_INVITE', 'ADMIN_ADDED', 'QUALIFIED', 'SEEDED');

-- CreateEnum
CREATE TYPE "PlayerLinkStatus" AS ENUM ('UNLINKED', 'PENDING', 'VERIFIED', 'REVOKED');

-- AlterEnum
BEGIN;
CREATE TYPE "MatchStatus_new" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'CANCELLED', 'VOID');
ALTER TABLE "public"."Match" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Match" ALTER COLUMN "status" TYPE "MatchStatus_new" USING ("status"::text::"MatchStatus_new");
ALTER TYPE "MatchStatus" RENAME TO "MatchStatus_old";
ALTER TYPE "MatchStatus_new" RENAME TO "MatchStatus";
DROP TYPE "public"."MatchStatus_old";
ALTER TABLE "Match" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
COMMIT;

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_competitorAId_fkey";

-- DropForeignKey
ALTER TABLE "Match" DROP CONSTRAINT "Match_competitorBId_fkey";

-- AlterTable
ALTER TABLE "Championship" ADD COLUMN     "decidedByMatchId" TEXT,
ADD COLUMN     "stageId" TEXT;

-- AlterTable
ALTER TABLE "Competition" ADD COLUMN     "registrationMode" "RegistrationMode" NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "CompetitionEntry" ADD COLUMN     "entryMethod" "EntryMethod" NOT NULL DEFAULT 'PUBLIC_REGISTRATION',
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "competitorAHandle" TEXT,
ADD COLUMN     "competitorBHandle" TEXT,
ALTER COLUMN "competitorAId" DROP NOT NULL,
ALTER COLUMN "competitorBId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MatchResult" ADD COLUMN     "resolution" "MatchResolution" NOT NULL DEFAULT 'PLAYED',
ALTER COLUMN "scoreA" DROP NOT NULL,
ALTER COLUMN "scoreA" DROP DEFAULT,
ALTER COLUMN "scoreB" DROP NOT NULL,
ALTER COLUMN "scoreB" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "linkStatus" "PlayerLinkStatus" NOT NULL DEFAULT 'UNLINKED',
ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "linkedUserId" TEXT;

-- AlterTable
ALTER TABLE "SourceReference" ADD COLUMN     "assertedValue" TEXT,
ADD COLUMN     "field" TEXT;

-- CreateIndex
CREATE INDEX "Championship_stageId_idx" ON "Championship"("stageId");

-- CreateIndex
CREATE INDEX "Championship_decidedByMatchId_idx" ON "Championship"("decidedByMatchId");

-- CreateIndex
CREATE INDEX "CompetitionEntry_status_idx" ON "CompetitionEntry"("status");

-- CreateIndex
CREATE INDEX "Match_status_idx" ON "Match"("status");

-- CreateIndex
CREATE INDEX "Player_linkedUserId_idx" ON "Player"("linkedUserId");

-- CreateIndex
CREATE INDEX "SourceReference_targetType_targetId_field_idx" ON "SourceReference"("targetType", "targetId", "field");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitorAId_fkey" FOREIGN KEY ("competitorAId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitorBId_fkey" FOREIGN KEY ("competitorBId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Championship" ADD CONSTRAINT "Championship_decidedByMatchId_fkey" FOREIGN KEY ("decidedByMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

