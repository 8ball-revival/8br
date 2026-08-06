-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'TIMED_OUT', 'BANNED', 'DELETED');

-- CreateEnum
CREATE TYPE "PenaltyType" AS ENUM ('TIMEOUT', 'BAN');

-- CreateTable
CREATE TABLE "member_moderation" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "timeoutUntil" TIMESTAMP(3),
    "bannedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_moderation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_penalty" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "playerId" TEXT,
    "type" "PenaltyType" NOT NULL,
    "reason" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3),
    "appliedByUserId" INTEGER NOT NULL,
    "appliedByUsername" TEXT NOT NULL,
    "removedByUserId" INTEGER,
    "removedByUsername" TEXT,
    "removedReason" TEXT,
    "removedAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_penalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_warning" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "playerId" TEXT,
    "reason" TEXT NOT NULL,
    "internalNotes" TEXT,
    "staffUserId" INTEGER NOT NULL,
    "staffUsername" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_warning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_designation" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "headAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_designation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_moderation_userId_key" ON "member_moderation"("userId");

-- CreateIndex
CREATE INDEX "member_moderation_status_idx" ON "member_moderation"("status");

-- CreateIndex
CREATE INDEX "member_penalty_userId_idx" ON "member_penalty"("userId");

-- CreateIndex
CREATE INDEX "member_penalty_type_idx" ON "member_penalty"("type");

-- CreateIndex
CREATE INDEX "member_penalty_userId_removedAt_idx" ON "member_penalty"("userId", "removedAt");

-- CreateIndex
CREATE INDEX "member_warning_userId_idx" ON "member_warning"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_designation_userId_key" ON "staff_designation"("userId");

-- CreateIndex
CREATE INDEX "staff_designation_headAdmin_idx" ON "staff_designation"("headAdmin");
