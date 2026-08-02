-- CreateEnum
CREATE TYPE "AccountClaimStatus" AS ENUM ('UNCLAIMED', 'CLAIMED');

-- CreateTable
CREATE TABLE "account_claim" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "status" "AccountClaimStatus" NOT NULL DEFAULT 'UNCLAIMED',
    "claimCodeHash" TEXT,
    "claimCodeExpiresAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "account_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_claim_userId_key" ON "account_claim"("userId");

-- CreateIndex
CREATE INDEX "account_claim_playerId_idx" ON "account_claim"("playerId");
