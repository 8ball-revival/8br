-- A Season number is unique per Competition, year AND division.
--
-- ── Why this has to change ─────────────────────────────────────────────────────────────────────
-- The 8BRCAM archive ran Division A and Division B of the same Season under ONE Season number:
-- "2007 Season 1 · Division A" and "2007 Season 1 · Division B" are both Season 1. The existing
-- constraint allowed one Season per Competition-year-number, so the second division of every
-- historical pair was rejected. Renumbering them would falsify the archive's own numbering, which
-- the reconstruction is supposed to preserve exactly.
--
-- ── Why this is not a weakening ────────────────────────────────────────────────────────────────
-- COALESCE(division, '') is the point. A plain four-column unique index would treat NULL divisions
-- as distinct — Postgres does not consider two NULLs equal — so two undivided Seasons could share a
-- number, which the old constraint forbade. Folding NULL to '' keeps that case colliding exactly as
-- it does today, and only genuinely divisional Seasons gain the room they need.
--
-- Non-destructive: no data is touched, and the new index is verified below to accept every existing
-- row before the old one is dropped.

CREATE UNIQUE INDEX "season_competition_year_number_division_key"
  ON "season" ("competitionSeriesId", "competitionYear", "number", (COALESCE("division", '')));

DROP INDEX IF EXISTS "season_competitionSeriesId_competitionYear_number_key";
