-- Add the RatingLedger table (authoritative per-completed-match Elo record for the Rankings/Ladder).
-- Purely additive: no existing table or column is modified. `(matchKey, playerId)` unique = idempotent.
CREATE TABLE "rating_ledger" (
  "id" SERIAL NOT NULL,
  "tournamentId" INTEGER NOT NULL,
  "matchKey" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "roundLabel" TEXT,
  "playerId" TEXT NOT NULL,
  "playerName" TEXT NOT NULL,
  "opponentId" TEXT,
  "opponentName" TEXT NOT NULL,
  "isTeamMatch" BOOLEAN NOT NULL DEFAULT false,
  "teamName" TEXT,
  "opponentTeamName" TEXT,
  "result" TEXT NOT NULL,
  "isForfeit" BOOLEAN NOT NULL DEFAULT false,
  "actual" DOUBLE PRECISION NOT NULL,
  "preRating" INTEGER NOT NULL,
  "expected" DOUBLE PRECISION NOT NULL,
  "ratingChange" INTEGER NOT NULL,
  "postRating" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rating_ledger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "rating_ledger_matchKey_playerId_key" ON "rating_ledger"("matchKey", "playerId");
CREATE INDEX "rating_ledger_playerId_sequence_idx" ON "rating_ledger"("playerId", "sequence");
CREATE INDEX "rating_ledger_tournamentId_idx" ON "rating_ledger"("tournamentId");
CREATE INDEX "rating_ledger_completedAt_idx" ON "rating_ledger"("completedAt");
ALTER TABLE "rating_ledger" ADD CONSTRAINT "rating_ledger_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "comp_tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
