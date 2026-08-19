-- Optional division metadata on Season.
--
-- Forward-only and purely additive: a nullable column plus its index. Every existing row stays
-- NULL, which the Rankings filter shows as "Unassigned". Nothing is inferred from a season's name,
-- number or year, and no existing Season record is restructured.
--
-- Deliberately a nullable code rather than a table or an enum: the archive import that will
-- populate it has not run, and whether a divided year becomes one Season row or two is still open.

ALTER TABLE "public"."season" ADD COLUMN IF NOT EXISTS "division" TEXT;
CREATE INDEX IF NOT EXISTS "season_division_idx" ON "public"."season"("division");
