-- A Final won because the opponent forfeited.
--
-- The championship is still awarded — somebody has to hold the title, and the opponent's failure to
-- appear does not make the other player not the winner. What is NOT awarded is a competitive result:
-- no W/L, no rating, no games, no differential, no streak. The marker exists so every surface that
-- shows the champion can say which of the two happened, rather than presenting a walkover as a win.
--
-- Forward-only and additive: a boolean with a default, so every existing row answers "no" without
-- being rewritten, and nothing that reads these tables today needs to know the column is there.
ALTER TABLE "public"."season"
  ADD COLUMN IF NOT EXISTS "finalsForfeit" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "public"."comp_tournament"
  ADD COLUMN IF NOT EXISTS "finalsForfeit" BOOLEAN NOT NULL DEFAULT false;
