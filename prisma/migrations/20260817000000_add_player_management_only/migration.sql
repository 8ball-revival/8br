-- Mark a profile as a management-only account.
--
-- Some logins exist to run the site rather than to compete — the head-admin account being the
-- obvious one. Those accounts still need a real login and a linked profile, but they should never
-- appear in the member list or in an entrant/free-agent picker, where they can only be added to a
-- Season or Tournament by mistake.
--
-- This is deliberately separate from `active`. An inactive profile is hidden outright (that is how a
-- merged secondary is suppressed); a management-only profile is perfectly valid and reachable, it
-- simply does not take part in competitions.
--
-- Defaults to false, so every existing profile keeps competing exactly as before.
ALTER TABLE "public"."Player"
  ADD COLUMN IF NOT EXISTS "managementOnly" BOOLEAN NOT NULL DEFAULT false;

-- The selectors filter on this alongside `active`, so index the pair they actually query.
CREATE INDEX IF NOT EXISTS "Player_managementOnly_active_idx"
  ON "public"."Player" ("managementOnly", "active");
