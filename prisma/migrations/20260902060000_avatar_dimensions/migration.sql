-- The uploaded picture's own dimensions, so the frame can be zoomed out to show all of it.
--
-- Nullable and additive: an avatar whose dimensions are unknown keeps exactly today's behaviour,
-- which is that the picture can fill the frame but not come back past it.
ALTER TABLE "Player" ADD COLUMN "avatarWidth" INTEGER,
ADD COLUMN "avatarHeight" INTEGER;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Backfill: Payload already measured every one of these when it stored them.
--
-- The avatar is served through Payload's media collection, which records `width` and `height` on
-- the row beside the file. So an avatar uploaded before this column existed does not need re-doing
-- and does not need re-measuring - the number is already in the database, one schema over.
--
-- Nothing else is touched: no file is read, moved or re-encoded, and a player whose filename has no
-- matching media row simply keeps NULL and the old behaviour.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE "Player" p
SET "avatarWidth"  = m.width,
    "avatarHeight" = m.height
FROM payload.media m
WHERE m.filename = p."avatarFilename"
  AND m.width IS NOT NULL
  AND m.height IS NOT NULL;
