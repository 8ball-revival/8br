-- Two additive columns on the playoff match, both forward-only and idempotent.
--
-- forfeitEntrantId — who forfeited, when a tie was decided that way.
--   The group-stage match has carried this for a long time; the playoff match never did, so a
--   forfeit had to be written as a score. Recording it as 7-0 puts seven games nobody played into
--   the winner's differential, their game-win percentage and their rating, and takes seven off a
--   player who never sat down. The column lets the games stay null and the fact be recorded.
--
-- needsReview — this result can no longer be trusted, because a correction upstream replaced one of
--   its participants. Deliberately its own column rather than another SeasonMatchStatus value:
--   the status says what happened in the match, and "somebody else's correction invalidated this"
--   is a statement about the bracket, not about the match. Overloading the status would also make
--   every existing status check silently wrong for these rows.
ALTER TABLE "season_playoff_match" ADD COLUMN IF NOT EXISTS "forfeitEntrantId" INTEGER;
ALTER TABLE "season_playoff_match" ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false;
