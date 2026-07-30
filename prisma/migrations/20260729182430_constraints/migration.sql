-- Integrity constraints that Prisma's schema language cannot express natively.
-- These are enforced at the database level in addition to the application layer.

-- Competitor supertype: exactly one of (playerId, teamId) must be set, and it
-- must agree with the declared type.
ALTER TABLE "Competitor"
  ADD CONSTRAINT "competitor_exactly_one_identity"
  CHECK (("playerId" IS NOT NULL)::int + ("teamId" IS NOT NULL)::int = 1);

ALTER TABLE "Competitor"
  ADD CONSTRAINT "competitor_type_matches_identity"
  CHECK (
    ("type" = 'PLAYER' AND "playerId" IS NOT NULL) OR
    ("type" = 'TEAM'   AND "teamId"   IS NOT NULL)
  );

-- A match must be between two distinct competitors.
ALTER TABLE "Match"
  ADD CONSTRAINT "match_distinct_competitors"
  CHECK ("competitorAId" <> "competitorBId");

-- Scores are non-negative.
ALTER TABLE "MatchResult"
  ADD CONSTRAINT "match_result_nonnegative_scores"
  CHECK ("scoreA" >= 0 AND "scoreB" >= 0);

-- Head-to-head rows store the pair in a canonical order (lo < hi) so each
-- unordered pair has exactly one row.
ALTER TABLE "HeadToHead"
  ADD CONSTRAINT "h2h_canonical_ordering"
  CHECK ("competitorLoId" < "competitorHiId");

-- Identity corrections must reference two different players.
ALTER TABLE "PlayerMerge"
  ADD CONSTRAINT "merge_distinct_players"
  CHECK ("canonicalPlayerId" <> "mergedPlayerId");

ALTER TABLE "PlayerSplit"
  ADD CONSTRAINT "split_distinct_players"
  CHECK ("sourcePlayerId" <> "newPlayerId");

-- Match format race length must be positive.
ALTER TABLE "MatchFormat"
  ADD CONSTRAINT "match_format_positive_race_length"
  CHECK ("raceLength" > 0);
