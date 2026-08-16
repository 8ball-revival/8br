-- Competition ownership for Seasons.
--
-- Introduces CompetitionSeries (labelled "Competition" throughout the UI; named Series in code so
-- it is never confused with an individual Tournament) and links Season to it.
--
-- The relation is added NULLABLE here. Enforcing NOT NULL is a SEPARATE, later step so existing
-- Seasons can be mapped deliberately rather than guessed at. In this database the two pre-existing
-- Seasons were confirmed test data and deleted by the owner beforehand, so there is nothing to
-- backfill — but the two-step shape is kept because any other environment may still hold rows.
--
-- The icon is a Payload media id held as a plain string, matching Season.bannerMediaId. No image
-- bytes are stored in PostgreSQL.

CREATE TABLE "public"."competition_series" (
  "id"          SERIAL       PRIMARY KEY,
  "name"        TEXT         NOT NULL,
  "slug"        TEXT         NOT NULL,
  "shortName"   TEXT         NOT NULL,
  "iconMediaId" TEXT,
  "active"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "competition_series_slug_key" ON "public"."competition_series"("slug");
CREATE INDEX "competition_series_active_idx" ON "public"."competition_series"("active");

ALTER TABLE "public"."season" ADD COLUMN "competitionSeriesId" INTEGER;

-- Restrict, not Cascade: deleting a Competition must never silently take its Seasons with it.
ALTER TABLE "public"."season"
  ADD CONSTRAINT "season_competitionSeriesId_fkey"
  FOREIGN KEY ("competitionSeriesId") REFERENCES "public"."competition_series"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "season_competitionSeriesId_idx" ON "public"."season"("competitionSeriesId");
