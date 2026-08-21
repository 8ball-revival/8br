-- Groups + Playoffs: record draws, and let an administrator override who qualifies.
--
-- Additive and forward-only. Two nullable-or-defaulted columns, no drops, no renames, no id
-- rewritten. Every existing Tournament, Registration and Standing row reads back unchanged, and the
-- existing Tournament formats (Single Elim, Double Elim, Swiss) never touch either column.
--
-- IF NOT EXISTS so a partially-applied run can simply be repeated.

-- ── Draws ──────────────────────────────────────────────────────────────────────────────────────
-- computeStandings has always counted these — a 10-game group set finishing 5-5 is a draw worth a
-- point under the house rules — but there was no column, so the number was computed and dropped and
-- the W-L on screen quietly excluded them. Defaulting to 0 is correct for every existing row: no
-- Tournament has run a group stage yet.
ALTER TABLE "comp_standing" ADD COLUMN IF NOT EXISTS "draws" INTEGER NOT NULL DEFAULT 0;

-- ── Qualifier override ─────────────────────────────────────────────────────────────────────────
-- An administrator's explicit answer to "does this entrant go through?", overriding the calculated
-- top-N. NULL means "follow the calculation", which is what every existing row means today.
--
-- On the ENTRANT rather than the standings row on purpose: recomputeStandings deletes and rebuilds
-- every standing, so an override stored there would be erased by the next result entered.
ALTER TABLE "comp_registration" ADD COLUMN IF NOT EXISTS "qualifierOverride" BOOLEAN;
