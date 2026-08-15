-- Canonical CueVerse ID identity: add a case-insensitive normalized key with a UNIQUE index.
-- The normalized form (trim + lowercase) is the authoritative uniqueness constraint for account
-- identity and is mirrored to the Payload auth `username`. Additive + backfill only; no data loss.
-- NULLs are allowed and treated as distinct (archive/backing players without a CueVerse ID).

ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "cueverseIdNormalized" TEXT;

-- Backfill every existing CueVerse ID to its normalized key.
UPDATE "Player"
   SET "cueverseIdNormalized" = lower(btrim("cueverseId"))
 WHERE "cueverseId" IS NOT NULL
   AND btrim("cueverseId") <> '';

-- Case-insensitive uniqueness at the database level (multiple NULLs remain allowed).
CREATE UNIQUE INDEX IF NOT EXISTS "Player_cueverseIdNormalized_key" ON "Player" ("cueverseIdNormalized");
