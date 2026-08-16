-- Enforce Competition ownership on Seasons.
--
-- The previous migration (20260816_add_competition_series) added the relation NULLABLE so existing
-- Seasons could be mapped deliberately. In this database the owner confirmed the two pre-existing
-- Seasons were test data and deleted them, so there is nothing to backfill and the column can be
-- tightened directly.
--
-- The guard below is not ceremony: any other environment may still hold Seasons, and this must fail
-- loudly rather than silently invent an owner.

DO $$
DECLARE unmapped BIGINT;
BEGIN
  SELECT count(*) INTO unmapped FROM "public"."season" WHERE "competitionSeriesId" IS NULL;
  IF unmapped > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce Competition ownership: % Season(s) have no competitionSeriesId. Map them first.',
      unmapped;
  END IF;
END $$;

ALTER TABLE "public"."season" ALTER COLUMN "competitionSeriesId" SET NOT NULL;
