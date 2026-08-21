-- Tournaments: a Competition relationship, and a structured forfeiture.
--
-- Additive and forward-only. Nothing is dropped, nothing is renamed, no id is rewritten, and every
-- existing Tournament, PlayoffMatch and TournamentMatch row stays readable exactly as it is: all
-- three columns are nullable with no default, so existing rows simply answer NULL.
--
-- IF NOT EXISTS throughout so a partially-applied run can be repeated safely.

-- ── Which Competition a Tournament belongs to ──────────────────────────────────────────────────
-- The same canonical competition_series table Seasons already use. Nullable because Tournaments
-- predate the relationship — rows created before it existed have no answer, and inventing one would
-- record a guess as fact. Creation requires it going forward, which is where the operator knows.
ALTER TABLE "comp_tournament" ADD COLUMN IF NOT EXISTS "competitionSeriesId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comp_tournament_competitionSeriesId_fkey'
  ) THEN
    ALTER TABLE "comp_tournament"
      ADD CONSTRAINT "comp_tournament_competitionSeriesId_fkey"
      FOREIGN KEY ("competitionSeriesId") REFERENCES "competition_series"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "comp_tournament_competitionSeriesId_idx"
  ON "comp_tournament"("competitionSeriesId");

-- ── Forfeiture ─────────────────────────────────────────────────────────────────────────────────
-- Who forfeited, stored structurally. Mirrors season_match."forfeitEntrantId", which is the
-- convention this project already settled on: the status says FORFEIT, this column says who, and
-- the score columns stay NULL because no games were played. A fabricated 0-7 would be
-- indistinguishable from a real one the moment anybody reads the row back.
--
-- LiveMatchStatus already has FORFEIT, so no enum change is needed.
ALTER TABLE "comp_playoff_match"    ADD COLUMN IF NOT EXISTS "forfeitRegistrationId" INTEGER;
ALTER TABLE "comp_tournament_match" ADD COLUMN IF NOT EXISTS "forfeitRegistrationId" INTEGER;
