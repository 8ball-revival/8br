-- A note shown under a Season's playoff bracket.
--
-- Reconstructed seasons frequently know WHO played whom but not the scores. Rather than let an
-- approximated bracket pass as archived fact, a season can carry a short statement of what is
-- recorded and what was filled in. Optional, and empty for most seasons.
ALTER TABLE "public"."season"
  ADD COLUMN IF NOT EXISTS "playoffDisclaimer" TEXT;
