-- Whether a record contributes to Rankings.
--
-- Distinct from publiclyVisible, which decides whether anyone can SEE it. A record can be public and
-- not counted (an exhibition), or counted and not yet public (a reconstruction being checked). Using
-- one flag for both questions would force the two to move together, and they are not the same
-- question.
--
-- Default true, so every existing record keeps contributing exactly as it does today and no ledger
-- rebuild is implied by adding the column.
ALTER TABLE "public"."season"
  ADD COLUMN IF NOT EXISTS "countsTowardRankings" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "public"."comp_tournament"
  ADD COLUMN IF NOT EXISTS "countsTowardRankings" BOOLEAN NOT NULL DEFAULT true;
