-- Mathematical clinch marker on a group standing row.
--
-- Additive and reversible: one nullable column, no default, no backfill, no data touched. Existing
-- rows read NULL, which is exactly "not proved clinched" — the correct answer for every season in
-- the database at the time this ran, since nothing had ever computed it.
--
-- Deliberately NOT the same thing as `qualified`. That column is rewritten on every standings
-- recompute to mark whoever currently occupies a top-N place. This one records the moment a top-N
-- finish became arithmetically impossible to lose, and normal result entry must never clear it.
ALTER TABLE "public"."season_standing" ADD COLUMN "clinchedAt" TIMESTAMP(3);
