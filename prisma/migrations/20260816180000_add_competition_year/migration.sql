-- Competition Year on Seasons and Tournaments.
--
-- Season already carried a required `year` column, so that is renamed in place — the values are
-- already correct and no backfill is needed. Tournament had no year at all, so the column is added
-- NULLABLE, backfilled, verified, and only then made NOT NULL. That ordering is deliberate: adding
-- a NOT NULL column to a populated table without a default would fail outright, and backfilling
-- before the constraint means a bad backfill is caught by the verification block rather than by a
-- half-applied migration.
--
-- Neither column is unique: many competitions share a year. A CHECK keeps values in 1900-2100.

-- ---------------------------------------------------------------- Season: rename in place
ALTER TABLE "public"."season" RENAME COLUMN "year" TO "competitionYear";

-- ---------------------------------------------------------------- Tournament: add nullable
ALTER TABLE "public"."comp_tournament" ADD COLUMN "competitionYear" INTEGER;

-- Backfill: prefer the scheduled start (the competition's own date), else the creation timestamp.
UPDATE "public"."comp_tournament"
SET "competitionYear" = EXTRACT(YEAR FROM COALESCE("scheduledStartAt", "createdAt"))::INTEGER
WHERE "competitionYear" IS NULL;

-- Verify BEFORE tightening the constraint. Abort the whole migration if anything is unset or the
-- backfill produced a year outside the supported range.
DO $$
DECLARE missing BIGINT; out_of_range BIGINT;
BEGIN
  SELECT count(*) INTO missing
  FROM "public"."comp_tournament" WHERE "competitionYear" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'competitionYear backfill incomplete: % tournament row(s) still NULL', missing;
  END IF;

  SELECT count(*) INTO out_of_range
  FROM "public"."comp_tournament" WHERE "competitionYear" NOT BETWEEN 1900 AND 2100;
  IF out_of_range > 0 THEN
    RAISE EXCEPTION 'competitionYear backfill out of range on % tournament row(s)', out_of_range;
  END IF;

  SELECT count(*) INTO out_of_range
  FROM "public"."season" WHERE "competitionYear" IS NULL OR "competitionYear" NOT BETWEEN 1900 AND 2100;
  IF out_of_range > 0 THEN
    RAISE EXCEPTION 'season competitionYear invalid on % row(s)', out_of_range;
  END IF;
END $$;

-- ---------------------------------------------------------------- Tighten
ALTER TABLE "public"."comp_tournament" ALTER COLUMN "competitionYear" SET NOT NULL;

ALTER TABLE "public"."comp_tournament"
  ADD CONSTRAINT "comp_tournament_competitionYear_range"
  CHECK ("competitionYear" BETWEEN 1900 AND 2100);

ALTER TABLE "public"."season"
  ADD CONSTRAINT "season_competitionYear_range"
  CHECK ("competitionYear" BETWEEN 1900 AND 2100);

-- ---------------------------------------------------------------- Ordering indexes
CREATE INDEX "comp_tournament_competitionYear_idx" ON "public"."comp_tournament"("competitionYear");
CREATE INDEX "season_competitionYear_idx" ON "public"."season"("competitionYear");
