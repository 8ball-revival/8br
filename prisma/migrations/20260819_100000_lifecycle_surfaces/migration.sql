-- Lifecycle presentation state for Live / Archives / Creator.
--
-- Forward-only and purely additive: new nullable columns and new columns with defaults chosen so
-- every existing row keeps behaving exactly as it does today. No table is recreated, no id changes,
-- no URL changes, and no existing value is rewritten.
--
--   publiclyVisible  default TRUE  — existing Seasons and Tournaments are already public
--   reconstruction   default FALSE — nothing existing was built as a reconstruction
--   dataCompleteness default 'full'— nothing existing is flagged as partial
--   reopenedAt / cancelledAt / deletedAt  NULL — no existing record is in those states
--
-- The indexes match the two queries this redesign actually runs: "what is Live" and "what is
-- archived", both of which filter on lifecycle plus visibility.

ALTER TABLE "public"."season"
  ADD COLUMN IF NOT EXISTS "publiclyVisible"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "reconstruction"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reopenedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dataCompleteness" TEXT NOT NULL DEFAULT 'full';

ALTER TABLE "public"."comp_tournament"
  ADD COLUMN IF NOT EXISTS "publiclyVisible"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "reconstruction"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reopenedAt"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dataCompleteness" TEXT NOT NULL DEFAULT 'full';

CREATE INDEX IF NOT EXISTS "season_lifecycle_visible_idx"     ON "public"."season"("lifecycleState", "publiclyVisible");
CREATE INDEX IF NOT EXISTS "season_reconstruction_idx"        ON "public"."season"("reconstruction");
CREATE INDEX IF NOT EXISTS "tournament_lifecycle_visible_idx" ON "public"."comp_tournament"("lifecycleState", "publiclyVisible");
CREATE INDEX IF NOT EXISTS "tournament_reconstruction_idx"    ON "public"."comp_tournament"("reconstruction");
