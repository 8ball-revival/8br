-- Platform separation: Yahoo history and CueVerse present are different ranking universes.
--
-- Additive and idempotent. Nothing is dropped, nothing is recreated, and every entrant, group,
-- match, playoff, champion, id and slug is left exactly where it is. The only thing this adds is a
-- classification the records were always implicitly carrying.

DO $$ BEGIN
  CREATE TYPE "CompetitionPlatform" AS ENUM ('CUEVERSE', 'YAHOO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "season" ADD COLUMN IF NOT EXISTS "platform" "CompetitionPlatform" NOT NULL DEFAULT 'CUEVERSE';
ALTER TABLE "comp_tournament" ADD COLUMN IF NOT EXISTS "platform" "CompetitionPlatform" NOT NULL DEFAULT 'CUEVERSE';

CREATE INDEX IF NOT EXISTS "season_platform_idx" ON "season" ("platform");
CREATE INDEX IF NOT EXISTS "comp_tournament_platform_idx" ON "comp_tournament" ("platform");

-- The ledger carries the platform of the record each row came from, so a ranking query can scope to
-- one universe without joining back through Season and Tournament on every read.
ALTER TABLE "rating_ledger" ADD COLUMN IF NOT EXISTS "platform" "CompetitionPlatform" NOT NULL DEFAULT 'CUEVERSE';
CREATE INDEX IF NOT EXISTS "rating_ledger_platform_idx" ON "rating_ledger" ("platform");
