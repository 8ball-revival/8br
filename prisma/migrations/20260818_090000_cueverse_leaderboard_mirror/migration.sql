-- CueVerse leaderboard mirror.
--
-- A local copy of the public CueVerse top-5, refreshed on a schedule rather than on demand, so the
-- homepage never waits on — or breaks because of — an external service. Only public leaderboard
-- data is stored, and nothing here is joined to an 8 Ball Registry player: the two identity spaces
-- are deliberately separate.
--
-- Additive only. Nothing existing is read, altered or dropped.

CREATE TABLE IF NOT EXISTS "public"."cueverse_snapshot" (
  "id"              SERIAL PRIMARY KEY,
  "provider"        TEXT NOT NULL DEFAULT 'cueverse',
  "fetchedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceUpdatedAt" TIMESTAMP(3),
  "checksum"        TEXT,
  "raw"             JSONB,
  "playersOnline"   INTEGER,
  "tablesActive"    INTEGER
);

CREATE INDEX IF NOT EXISTS "cueverse_snapshot_provider_fetchedAt_idx"
  ON "public"."cueverse_snapshot" ("provider", "fetchedAt");

CREATE TABLE IF NOT EXISTS "public"."cueverse_snapshot_entry" (
  "id"          SERIAL PRIMARY KEY,
  "snapshotId"  INTEGER NOT NULL,
  "rank"        INTEGER NOT NULL,
  "name"        TEXT NOT NULL,
  "rating"      INTEGER NOT NULL,
  "wins"        INTEGER,
  "losses"      INTEGER,
  "provisional" BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS "cueverse_snapshot_entry_snapshotId_rank_key"
  ON "public"."cueverse_snapshot_entry" ("snapshotId", "rank");
CREATE INDEX IF NOT EXISTS "cueverse_snapshot_entry_snapshotId_idx"
  ON "public"."cueverse_snapshot_entry" ("snapshotId");

DO $$
BEGIN
  ALTER TABLE "public"."cueverse_snapshot_entry"
    ADD CONSTRAINT "cueverse_snapshot_entry_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "public"."cueverse_snapshot"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
