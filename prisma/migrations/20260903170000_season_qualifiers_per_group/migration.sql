-- How many players advance from each group, per Season.
--
-- Additive and reversible, and deliberately done in three steps so no existing season changes.
--
-- The count used to be a single module constant (SEASON_QUALIFIERS_PER_GROUP = 3) shared by all 50
-- seasons in this database. Moving the live competition to a top-four cutoff by editing that
-- constant would also have redrawn the cutoff on the 49 COMPLETED seasons — the Yahoo archive runs
-- back to 2005 — and rewritten their `qualified` flags on the next standings recompute. A season's
-- advancement count is a fact about how that season was played, so it belongs on the row.

-- 1. Add it with the OLD value as the default, so every existing row keeps exactly what it played.
ALTER TABLE "public"."season" ADD COLUMN "qualifiersPerGroup" INTEGER NOT NULL DEFAULT 3;

-- 2. The live CueVerse-era competition moves to top four, from Season 2 onward. Season 1 of 2026 is
--    COMPLETED and keeps the top three it was actually decided under, as does every Yahoo season.
UPDATE "public"."season"
   SET "qualifiersPerGroup" = 4
 WHERE "platform" = 'CUEVERSE'
   AND "number" >= 2;

-- 3. Seasons created from here on default to four.
ALTER TABLE "public"."season" ALTER COLUMN "qualifiersPerGroup" SET DEFAULT 4;
