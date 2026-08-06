-- CreateEnum
CREATE TYPE "CupLifecycleState" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "comp_season" ADD COLUMN     "cupState" "CupLifecycleState",
ADD COLUMN     "ladderAppliedAt" TIMESTAMP(3);
