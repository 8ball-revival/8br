-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cueverseId" TEXT,
ADD COLUMN     "discord" TEXT,
ADD COLUMN     "timeZone" TEXT;

-- AlterTable
ALTER TABLE "comp_registration" ADD COLUMN     "cueverseId" TEXT,
ADD COLUMN     "discord" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "playerId" TEXT,
ADD COLUMN     "timeZone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Player_linkedUserId_key" ON "Player"("linkedUserId");

-- CreateIndex
CREATE INDEX "comp_registration_playerId_idx" ON "comp_registration"("playerId");

