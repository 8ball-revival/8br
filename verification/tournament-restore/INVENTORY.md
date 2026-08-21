# Live Tournament system — reference inventory

## Which tree is live

`https://8br.gg` serves `/tournaments` (`X-Matched-Path: /tournaments`) and 301s `/cups` → `/tournaments`.

- `main` / `development` HEAD = `7529a31` — has `/cups` pages and NO `/tournaments` route. **Not deployed.**
- Tag `production-2026-08-18` = **`2e4c528`** — has `/tournaments`, `/tournaments/new`, `/tournaments/[number]`
  and the `/cups` → `/tournaments` permanent redirects in `next.config.ts`. **This matches live exactly.**

Reference commit for this restoration: **`2e4c528`**.

## Delta against redesign-v2 HEAD

The whole engine is still present at HEAD. Only the three page files differ:

| At 2e4c528 | At redesign-v2 HEAD |
|---|---|
| `app/(frontend)/tournaments/page.tsx` | replaced by `app/(frontend)/cups/page.tsx` (different page: archive browser) |
| `app/(frontend)/tournaments/new/page.tsx` | `app/(frontend)/cups/new/page.tsx` |
| `app/(frontend)/tournaments/[number]/page.tsx` | `app/(frontend)/cups/[number]/page.tsx` |
| — | `app/(frontend)/tournaments/route.ts` (redirect stub → /cups) |
| — | `app/(frontend)/tournaments/[number]/route.ts` (redirect stub) |
| — | `app/(frontend)/creator/cups/[id]/page.tsx` |

Unchanged and reusable at HEAD (no port needed):
- `src/components/tournaments/*` — 16 components incl. bracket, workspace, lifecycle controls,
  create form, list, card, history, join panel, winner summary
- `src/lib/competition/tournament-{actions,create,lifecycle,sync}.ts`
- `src/lib/tournaments/{adapter,context,fixtures,list,live,migrate,prime,service}.ts`
- `src/lib/competition/service.ts` (bracket generation, advancement, playoff scoring)

## Lifecycle and engine

- Model `Tournament` (`comp_tournament`) — `lifecycleState`, `status`, `registrationStatus`,
  `groupsStatus`, `playoffsStatus`, `tournamentFormat`, `ladderAppliedAt` (idempotency guard),
  champion/runner-up/third fields, `publiclyVisible`, `reconstruction`.
- Result path: `recordTournamentScoreAction` → `svc.recordPlayoffScore` → `svc.verifyPlayoffMatch`
  (advances via `feedsMatchId`/`feedsSlot`, and `loserFeedsMatchId` for double-elim)
  → `syncLiveTournamentToSnapshot` → rankings.
- Undo: `svc.undoPlayoffResult` clears the downstream slot only if it still holds this match's winner.
- Rankings contribution: `RatingLedger` rows keyed `(matchKey, playerId)` unique, written once at
  COMPLETED, guarded by `ladderAppliedAt`.
- Authorization: `requireCapability('manage_competitions')` for management,
  `requireCapability('edit_results')` for scoring.

## Forfeiture: the existing convention

Already established on the **Season** side and reused here rather than invented:
- `SeasonMatch.forfeitEntrantId Int?` + `SeasonMatchStatus.FORFEIT`
- `RatingLedger.isForfeit Boolean` — "official result but Elo-neutral (no competitive game played)"
- `interpretMatch()` / `parseField()` in `src/lib/seasons/group-stage.ts` parse `FF` case-insensitively
- `LiveMatchStatus` **already has `FORFEIT`** — no enum migration needed for Tournaments.

Gap: `PlayoffMatch` and `TournamentMatch` have no `forfeit*Id` column. Additive migration required.

## Competition selection

`Tournament` has **no** `competitionSeriesId`. `Season` has one (required). Additive nullable
column + relation required on `comp_tournament`.
