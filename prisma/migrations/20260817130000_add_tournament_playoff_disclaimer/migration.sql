-- A note shown under a Tournament's playoff bracket, mirroring season.playoffDisclaimer.
-- Reconstructed tournaments have the same problem as reconstructed seasons: the pairings survive
-- in the archive, the scores often do not. Optional, and empty for the overwhelming majority.
ALTER TABLE "public"."comp_tournament"
  ADD COLUMN IF NOT EXISTS "playoffDisclaimer" TEXT;
