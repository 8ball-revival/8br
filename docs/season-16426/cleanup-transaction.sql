\set ON_ERROR_STOP on
BEGIN;
-- 1. rating_ledger: restore the original rows, original surrogate ids and original createdAt.
--    Nothing references this table (checked), so replacing it wholesale is safe.
DELETE FROM public.rating_ledger;
INSERT INTO public.rating_ledger (id, "tournamentId", "matchKey", stage, "roundLabel", "playerId", "playerName", "opponentId", "opponentName", "isTeamMatch", "teamName", "opponentTeamName", result, "isForfeit", actual, "preRating", expected, "ratingChange", "postRating", sequence, "completedAt", "createdAt", "seasonId", platform) VALUES (61745402, NULL, 'season-playoff:35858', 'PLAYOFF', 'Round 2 · Match 6', 'cmt1wikqt005h6r0ca753aard', 'Daz', 'cmt0q3eyc00206rpo0313fhcm', 'MJ', false, NULL, NULL, 'LOSS', false, 0, 1573, 0.2812431701012181, -9, 1564, 7109, '2026-08-25 20:20:28.453', '2026-08-27 18:35:02.235', 5501, 'YAHOO');
-- ... 16,110 INSERT statements, one per original rating_ledger row, taken from the backup
SELECT setval('public.rating_ledger_id_seq', (SELECT max(id) FROM public.rating_ledger), true);
-- 2. article: restore only the updatedAt stamp that this work touched. Nothing else is written.
UPDATE public.article SET "updatedAt" = TIMESTAMP '2026-08-27 18:31:08.895' WHERE id IN (188,249,390);
COMMIT;
