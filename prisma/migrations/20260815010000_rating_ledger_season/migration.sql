-- AlterTable: rating_ledger rows may now belong to a Season instead of a Tournament.
ALTER TABLE "rating_ledger" ADD COLUMN "seasonId" INTEGER,
ALTER COLUMN "tournamentId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "rating_ledger_seasonId_idx" ON "rating_ledger"("seasonId");

-- AddForeignKey
ALTER TABLE "rating_ledger" ADD CONSTRAINT "rating_ledger_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
