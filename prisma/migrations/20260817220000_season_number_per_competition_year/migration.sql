-- Season numbers become per Competition and year instead of one global sequence.
--
-- "8BR Season 1 - 2005", "8BR Retro Season 1 - 2026" and "8BR Season 1 - 2026" must all be able to
-- exist together; only a repeat of the SAME competition, year and number is a conflict.
--
-- The migration refuses to run rather than renumbering anything: if existing rows would collide
-- under the new rule, or hold a non-positive number, it raises and leaves the data untouched for a
-- human to resolve.
DO $$
DECLARE
  clashes int;
  bad int;
BEGIN
  SELECT count(*) INTO clashes FROM (
    SELECT 1 FROM "public"."season"
    GROUP BY "competitionSeriesId", "competitionYear", "number"
    HAVING count(*) > 1
  ) d;
  IF clashes > 0 THEN
    RAISE EXCEPTION
      'Aborting: % Competition/year/number combination(s) are already duplicated. Resolve them by hand; this migration will not renumber Seasons.', clashes;
  END IF;

  SELECT count(*) INTO bad FROM "public"."season" WHERE "number" <= 0;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Aborting: % Season(s) hold a number of zero or less.', bad;
  END IF;
END $$;

-- The global sequence is gone; a number only has to be unique inside its Competition and year.
DROP INDEX IF EXISTS "public"."season_number_key";

CREATE UNIQUE INDEX "season_competition_year_number_key"
  ON "public"."season" ("competitionSeriesId", "competitionYear", "number");

-- Positive whole numbers only. The column is already an integer, so this is the remaining half.
ALTER TABLE "public"."season"
  DROP CONSTRAINT IF EXISTS "season_number_positive";
ALTER TABLE "public"."season"
  ADD CONSTRAINT "season_number_positive" CHECK ("number" > 0);
