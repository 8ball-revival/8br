-- Media upload provenance and rate limiting.
--
-- Records one row per image pasted into an article. It exists for two reasons: uploads need durable
-- rate limiting (a per-process counter resets on restart, and this application runs more than one
-- instance), and the Payload media collection does not record WHO uploaded a file — which an orphan
-- sweep needs in order to tell a member's abandoned paste from site imagery an administrator added.
--
-- Additive only. Nothing existing is read, altered or dropped.

CREATE TABLE IF NOT EXISTS "public"."media_upload" (
  "id"               SERIAL PRIMARY KEY,
  "filename"         TEXT NOT NULL,
  "uploaderPlayerId" TEXT,
  "mimeType"         TEXT NOT NULL,
  "bytes"            INTEGER NOT NULL,
  "width"            INTEGER,
  "height"           INTEGER,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "media_upload_uploaderPlayerId_createdAt_idx"
  ON "public"."media_upload" ("uploaderPlayerId", "createdAt");
CREATE INDEX IF NOT EXISTS "media_upload_filename_idx"
  ON "public"."media_upload" ("filename");

DO $$
BEGIN
  ALTER TABLE "public"."media_upload"
    ADD CONSTRAINT "media_upload_uploaderPlayerId_fkey"
    FOREIGN KEY ("uploaderPlayerId") REFERENCES "public"."Player"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
