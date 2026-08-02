-- Results management: optional admin notes on live matches + competition archive timestamp.
-- AlterTable
ALTER TABLE "comp_season" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "comp_match" ADD COLUMN "note" TEXT;

-- AlterTable
ALTER TABLE "comp_playoff_match" ADD COLUMN "note" TEXT;
