-- One-time backfill: align every LINKED account's Payload login username to the canonical
-- normalized CueVerse ID (trim + lowercase). Fixes any historical divergence left by the old
-- change path that updated only the Player side. Idempotent — only rows that actually differ are
-- touched. Cross-schema (payload.users ← public."Player") in the shared database. No secrets read.
UPDATE payload.users u
   SET username = lower(btrim(p."cueverseId"))
  FROM public."Player" p
 WHERE p."linkedUserId" = u.id::text
   AND p."cueverseId" IS NOT NULL
   AND btrim(p."cueverseId") <> ''
   AND u.username IS DISTINCT FROM lower(btrim(p."cueverseId"));
