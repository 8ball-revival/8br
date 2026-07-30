-- CreateEnum
CREATE TYPE "SeedingMethod" AS ENUM ('MANUAL', 'RANDOM_DRAW', 'GLOBAL_RANKING', 'COMPETITION_STANDING', 'PREVIOUS_STAGE', 'PREVIOUS_SEASON', 'QUALIFICATION_ORDER', 'HYBRID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MatchSlotSource" AS ENUM ('WINNER', 'LOSER');

-- AlterEnum
ALTER TYPE "EntryStatus" ADD VALUE 'DECLINED';

-- AlterEnum
ALTER TYPE "PlayerLinkStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "RecordType" ADD VALUE 'HISTORICAL_CORRECTION';

-- AlterEnum
BEGIN;
CREATE TYPE "RegistrationMode_new" AS ENUM ('OPEN', 'APPROVAL_REQUIRED', 'INVITATIONAL', 'QUALIFICATION_ONLY');
ALTER TABLE "public"."Competition" ALTER COLUMN "registrationMode" DROP DEFAULT;
ALTER TABLE "Competition" ALTER COLUMN "registrationMode" TYPE "RegistrationMode_new" USING ("registrationMode"::text::"RegistrationMode_new");
ALTER TYPE "RegistrationMode" RENAME TO "RegistrationMode_old";
ALTER TYPE "RegistrationMode_new" RENAME TO "RegistrationMode";
DROP TYPE "public"."RegistrationMode_old";
ALTER TABLE "Competition" ALTER COLUMN "registrationMode" SET DEFAULT 'OPEN';
COMMIT;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "slotASource" "MatchSlotSource",
ADD COLUMN     "slotASourceMatchId" TEXT,
ADD COLUMN     "slotBSource" "MatchSlotSource",
ADD COLUMN     "slotBSourceMatchId" TEXT;

-- AlterTable
ALTER TABLE "Seed" ADD COLUMN     "proposedSeedNo" INTEGER,
ADD COLUMN     "seedingMethod" "SeedingMethod" NOT NULL DEFAULT 'UNKNOWN';

-- CreateIndex
CREATE INDEX "Match_slotASourceMatchId_idx" ON "Match"("slotASourceMatchId");

-- CreateIndex
CREATE INDEX "Match_slotBSourceMatchId_idx" ON "Match"("slotBSourceMatchId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_slotASourceMatchId_fkey" FOREIGN KEY ("slotASourceMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_slotBSourceMatchId_fkey" FOREIGN KEY ("slotBSourceMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A match cannot be its own slot source (prevents trivial feed self-loops).
-- IS DISTINCT FROM passes on NULL, so static brackets (null sources) are unaffected.
ALTER TABLE "Match"
  ADD CONSTRAINT "match_slot_source_not_self"
  CHECK ("slotASourceMatchId" IS DISTINCT FROM "id" AND "slotBSourceMatchId" IS DISTINCT FROM "id");
