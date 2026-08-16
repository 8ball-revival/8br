# 8BR — Workflow Validation

A practical review proving the implemented schema supports the **actual ways 8BR
competitions operate** — not merely that the models compile. Each of the ten
operational workflows below is traced against the schema in
[`prisma/schema.prisma`](./prisma/schema.prisma): the models/relationships
involved, the record lifecycle, gaps found, what the database enforces vs. what
application logic must handle, and a support verdict.

No data was imported, no fake records were created, and the source archive was not
touched. Genuine gaps found during the review were fixed with a single migration
(`20260729190000_workflow_hardening`); see §Schema changes.

> **Update — policy layer.** The *interpretation* of these workflows (registration approval,
> seeding, tiebreaks, ranking formulas, championship counting, forfeit/bye stat treatment,
> correction authority, account linking, historical confidence, bracket progression) is now
> fixed by **[POLICY_FRAMEWORK.md](./POLICY_FRAMEWORK.md)**. That review added a further
> migration (`20260729200000_policy_framework`) with policy-required fields — registration
> modes (`APPROVAL_REQUIRED`/`QUALIFICATION_ONLY`), `EntryStatus.DECLINED`,
> `Seed.seedingMethod`/`proposedSeedNo`, `PlayerLinkStatus.REJECTED`,
> `RecordType.HISTORICAL_CORRECTION`, and **bracket feed links**
> (`Match.slot{A,B}Source*`) for reliable live double-elimination. The database stores facts;
> the application applies policy.

## Summary

| # | Workflow | Verdict |
|---|---|---|
| 1 | Standard 8BR Season | ✅ Supported (traceability enhanced) |
| 2 | Cup — direct single-elim, varied race lengths | ✅ Supported, no change |
| 3 | Double-elimination tournament (+ reset) | ✅ Supported, no change |
| 4 | Invitational — admin-selected, no public registration | ✅ Supported after changes |
| 5 | Ties, forfeits, withdrawals, DQs, byes, unplayed, reschedules, admin decisions | ✅ Supported after changes |
| 6 | Historical edge cases (missing score, inferred champion, source conflict, alias fix, merge, split, auditable correction) | ✅ Supported after changes |
| 7 | Ranking vs. standings separation | ✅ Supported, no change |
| 8 | Championship & accomplishment counting | ✅ Supported, no change |
| 9 | Canonical player identity (aliases, per-match alias, name/country change, account linking) | ✅ Supported after changes |
| 10 | Source & provenance tracking | ✅ Supported (conflict handling enhanced) |

**Already fully supported with no schema change:** 2, 3, 7, 8, 10 (and 1 functionally).
**Gaps found and fixed:** 4, 5, 6, 9 (plus optional enhancements to 1 and 10).

## Schema changes made (migration `20260729190000_workflow_hardening`)

| Change | Workflow(s) | Why |
|---|---|---|
| `MatchStatus` reduced to a pure **lifecycle** enum (`SCHEDULED, IN_PROGRESS, COMPLETED, POSTPONED, CANCELLED, VOID`) | 5 | separate lifecycle from outcome method |
| New enum **`MatchResolution`** + `MatchResult.resolution` (`PLAYED, WALKOVER, FORFEIT, DOUBLE_FORFEIT, BYE, RETIREMENT, ADMIN_DECISION`) | 5 | forfeits, byes, admin rulings, retirements are first-class |
| `Match.competitorAId` / `competitorBId` made **nullable** | 3, 5 | byes (one empty side) and not-yet-determined bracket fixtures |
| `Match.competitorAHandle` / `competitorBHandle` added | 9 | tie alias usage to a specific historical match |
| `MatchResult.scoreA` / `scoreB` made **nullable** (no default) | 6 | a missing/unknown score is distinct from a real 0–0 |
| `Competition.registrationMode` (`OPEN, INVITE_ONLY, CLOSED`) | 4 | invitationals with no public registration |
| `CompetitionEntry.entryMethod` (`PUBLIC_REGISTRATION, ADMIN_INVITE, ADMIN_ADDED, QUALIFIED, SEEDED`) | 4, 5 | how a competitor got in |
| `CompetitionEntry.statusReason` + `updatedAt` | 5 | reason + timing for withdrawals/DQs |
| `Player.linkedUserId` + `linkStatus` (`UNLINKED, PENDING, VERIFIED, REVOKED`) + `linkedAt` | 9 | account claims identity without owning it |
| `Championship.stageId` + `decidedByMatchId` | 1 | trace a title to the deciding stage/match |
| `SourceReference.field` + `assertedValue` | 6, 10 | structured, conflict-detectable source claims |
| Indexes: `Match(status)`, `CompetitionEntry(status)`, `Player(linkedUserId)`, `Championship(stageId)`, `Championship(decidedByMatchId)`, `SourceReference(targetType,targetId,field)` | 4,5,9 | operational query paths |

Existing CHECK constraints (`match_distinct_competitors`, `match_result_nonnegative_scores`)
remain valid: SQL CHECKs pass on NULL, so nullable competitor slots and scores do not
violate them (distinctness/non-negativity are still enforced when values are present).

---

## Workflow 1 — Standard 8BR Season

**Models & relationships.** `Competition(type=SEASON)` → `Division`* → `Stage`(GROUP,
seq 1) → `Group`* → `Match`(groupId) → `MatchResult` → `StandingRow`; then
`Stage`(SINGLE_ELIM, seq 2) → `Bracket`(MAIN) → `Match`(bracketId, round, matchNo) →
`MatchResult`; qualification via `Seed`(stage=playoff); title via `Championship`
(champion/runnerUp Competitor, now `stageId` + `decidedByMatchId`). Registration via
`CompetitionEntry`.

**Lifecycle.** Competition `UPCOMING → REGISTRATION_OPEN` (entries `REGISTERED/CONFIRMED`)
`→ IN_PROGRESS` (group matches played → standings recomputed) → top-N `Seed`ed into the
playoff stage → single-elim played → final `Match` → `Championship` row → competition
`COMPLETED`.

**Gaps.** None blocking. **Enhancement made:** `Championship.stageId` +
`decidedByMatchId` so the title is traceably linked to the match that decided it.

**DB-enforced vs. app logic.** FKs/uniques enforce structure. **App logic:** the
qualification cut (which standings rows become playoff seeds), standings computation,
and champion derivation from the final match.

**Verdict:** ✅ **Supported** (traceability enhanced).

---

## Workflow 2 — Cup: no group stage, direct single-elim, different race lengths per round

**Models & relationships.** `Competition(type=CUP)` → one `Stage`(SINGLE_ELIM) →
`Bracket`(MAIN) → `Match`* with **per-match `matchFormatId`** → `MatchResult`.

**Lifecycle.** Entries seeded straight into the bracket; each round's matches reference
the appropriate `MatchFormat` (e.g. `RACE_TO_5` early, `RACE_TO_7` semis, `RACE_TO_9`
final).

**Gaps.** None. Different race lengths per round are handled because **every `Match`
carries its own `matchFormatId`** — no per-round format table needed.

**DB-enforced vs. app logic.** DB stores the per-match format; app assigns formats by
round from rules/config.

**Verdict:** ✅ **Supported, no change.**

---

## Workflow 3 — Double-elimination tournament (winners, losers, grand final, reset)

**Models & relationships.** `Competition(type=TOURNAMENT)` → `Stage`(DOUBLE_ELIM) →
two `Bracket`s (`WINNERS`, `LOSERS`) → `Match`(bracketId, `bracketType`, round, matchNo)
→ `MatchResult`. Grand final = a `Bracket`/matches with `BracketType.FINALS`.

**Lifecycle.** Losers drop from winners to losers bracket (app progression logic);
grand final match 1; if the losers-bracket entrant wins, a **reset** match (matchNo 2)
is played; last match's winner is champion.

**Gaps.** None blocking. The **bracket reset** is represented as a second finals `Match`
(matchNo/round), needing no extra column. Nullable competitor slots (added for WF5) also
let an empty double-elim bracket be pre-created with TBD fixtures.

**DB-enforced vs. app logic.** DB stores brackets/matches/positions. **App logic:**
bracket progression (who advances where), and detecting that a reset is required.
*(Note: the schema stores bracket structure by position, not explicit feed links — see
Decisions.)*

**Verdict:** ✅ **Supported, no change** (nullable slots help live brackets).

---

## Workflow 4 — Invitational: admin-selected players, no public registration, custom seeding

**Models & relationships.** `Competition(type=TOURNAMENT, registrationMode=INVITE_ONLY)`
→ `CompetitionEntry`(entryMethod=`ADMIN_INVITE`/`ADMIN_ADDED`, status=`CONFIRMED`) →
`Seed`(seedNo set manually).

**Lifecycle.** Admin creates the competition as invite-only; adds selected competitors as
entries with an admin entry method; sets custom `Seed.seedNo`; competition proceeds.

**Gaps found & fixed.** Previously there was no way to record that a competition had **no
public registration** or that a player was **admin-selected** vs. self-registered. Added
`Competition.registrationMode` and `CompetitionEntry.entryMethod`. Custom seeding was
already supported via `Seed.seedNo` / `CompetitionEntry.seed`.

**DB-enforced vs. app logic.** DB stores registration mode, entry method, seeds. **App
logic / policy:** who may invite, and seeding rules (see Decisions).

**Verdict:** ✅ **Supported after changes.**

---

## Workflow 5 — Ties, forfeits, withdrawals, DQs, byes, unplayed, reschedules, admin decisions

**Models & relationships.** `StandingRow` (ties), `Match` + `MatchResult`
(`resolution`, `status`), `CompetitionEntry` (`status`, `statusReason`), `HeadToHead`
(tiebreak input).

**Lifecycle / handling:**
- **Tied standings:** equal `points`/`total`; final order stored in `StandingRow.rank`.
  Tiebreak inputs present: `points`, `gamesFor`/`gamesAgainst` (game diff), `winPct`,
  and pairwise `HeadToHead`. *Tiebreak policy itself is a decision.*
- **Forfeit / walkover / double forfeit:** `MatchResult.resolution` +
  `winnerCompetitorId` (winner is the non-forfeiting side; null for double forfeit).
- **Withdrawal / DQ:** `CompetitionEntry.status = WITHDRAWN/DISQUALIFIED` with
  `statusReason` + `updatedAt`; affected fixtures become `WALKOVER`/`VOID`.
- **Bye:** a `Match` with one competitor slot **null**, `resolution = BYE`, winner = the
  present competitor. (Enabled by making competitor slots nullable.)
- **Unplayed match:** a `Match` with no `MatchResult`, or `status = VOID/CANCELLED`.
- **Rescheduled:** update `Match.scheduledAt` (+ `updatedAt`); `POSTPONED` marks a match
  awaiting a new date. History via `HistoricalCorrection` if needed.
- **Administratively decided:** `MatchResult.resolution = ADMIN_DECISION` +
  `enteredByUserId`.

**Gaps found & fixed.** Byes had no representation (both competitor slots were required);
match "status" conflated lifecycle with outcome; there was no explicit admin-decision or
forfeit-method marker; entries had no status reason/timestamp. Fixed via nullable slots,
the `MatchResolution` enum, the lifecycle-only `MatchStatus`, and
`CompetitionEntry.statusReason`/`updatedAt`.

**DB-enforced vs. app logic.** DB enforces distinct competitors when both present,
non-negative scores, and the valid status/resolution sets. **App logic / policy:**
tiebreak ordering; whether forfeits/byes count toward W-L and stats; cascading a
withdrawal onto remaining fixtures.

**Verdict:** ✅ **Supported after changes.**

---

## Workflow 6 — Historical edge cases

**Models & relationships.** `MatchResult` (missing score, confidence), `Championship`
(inferred champion), `SourceReference` (conflicts), `PlayerAlias` (misassigned alias),
`PlayerMerge`, `PlayerSplit`, `HistoricalCorrection` (auditable change).

**Handling:**
- **Missing score:** `MatchResult.scoreA/scoreB = NULL` + `confidence = UNKNOWN` — now
  distinct from a genuine 0–0.
- **Inferred champion:** `Championship.confidence = HEURISTIC_LABEL/HEURISTIC_COUNT/
  RECONSTRUCTED`, `championHandle` for an unresolved name, `bracketReconstructed`.
- **Conflicting sources:** multiple `SourceReference` rows on the same
  `(targetType, targetId, field)` with differing `assertedValue` = a detectable conflict;
  resolved by a `HistoricalCorrection`.
- **Alias assigned to wrong person:** repoint `PlayerAlias.playerId`; log a
  `HistoricalCorrection` (targetType `PLAYER_ALIAS`, before/after).
- **Merge two identities:** `PlayerMerge`. **Split one identity:** `PlayerSplit`.
- **Approved correction, previous value auditable:** `HistoricalCorrection` stores
  `beforeValue`/`afterValue` and `status = APPROVED/APPLIED` — the old value is retained.

**Gaps found & fixed.** Missing-score was indistinguishable from 0–0 (fixed: nullable
scores). Conflicting sources could only live in free-text notes (fixed:
`SourceReference.field` + `assertedValue`).

**DB-enforced vs. app logic.** DB retains before/after values and multiple source claims.
**App logic:** conflict detection across sources; applying an approved correction to the
live record; repointing aliases during merge/split.

**Verdict:** ✅ **Supported after changes.**

---

## Workflow 7 — Ranking vs. standings separation

**Models & relationships.** Standings: `StandingRow` → `Group` → `Stage` → `Competition`
(scoped to one stage/competition). Rankings: `RankingSystem` → `RankingSnapshot`(asOf,
scope) → `RankingSnapshotItem` → `Competitor` (spans competitions).

**Handling.** Standings are inherently competition/stage-scoped via their group. Global
rankings are snapshots under a system with `scope = "all-time"`. Multiple systems coexist
(rows in `RankingSystem`). Each recalculation creates a **new** `RankingSnapshot`;
existing snapshots and their items are never mutated, so historical positions are
preserved and recalculating "current" cannot rewrite old snapshots.

**Gaps.** None. (No `isCurrent` flag — "current" = latest `asOf` per system, by query;
this is intentional so snapshots stay immutable.)

**DB-enforced vs. app logic.** DB keeps snapshots immutable by convention (append-only).
**App logic:** ranking computation; choosing the latest snapshot as "current".

**Verdict:** ✅ **Supported, no change.**

---

## Workflow 8 — Championship & accomplishment counting

**Models & relationships.** `Championship` → `Competition` → `CompetitionType` (for
type-specific totals) and → `Competitor` (for per-player totals). Non-championship
accomplishments: `Achievement`. Recognition: `HallOfFameEntry` (independent of titles).
Cached aggregates: `PlayerCareerStat`.

**Handling.**
- Season/Cup/Tournament titles are all `Championship` rows; the **type** comes from
  `Competition.competitionTypeId`, so type-specific totals are a `GROUP BY` on
  `CompetitionType`.
- All-time totals: count `Championship` by `championCompetitorId`.
- Accomplishments that aren't championships: `Achievement`.
- Hall of Fame is a separate table, so recognition is independent of title counts.

**Gaps.** None. Type-specific totals are **computable** from
`Championship → Competition → CompetitionType`. `PlayerCareerStat.championships` caches an
overall total; per-type caching is optional (derivable on demand).

**DB-enforced vs. app logic.** DB stores every title with its competition/type. **App
logic:** the counting queries and any cached breakdowns; championship-counting policy
(see Decisions).

**Verdict:** ✅ **Supported, no change.**

---

## Workflow 9 — Canonical player identity

**Models & relationships.** `Player` (canonical, `primaryName`, `country`,
`linkedUserId`/`linkStatus`), `PlayerAlias` (many→one), `Match.competitorAHandle/
BHandle` (per-match alias), `HistoricalCorrection` (name/country history),
`PlayerMerge`/`PlayerSplit`.

**Handling.**
- **One player, many aliases:** `PlayerAlias`* → `Player`.
- **Alias tied to a specific match:** `Match.competitorAHandle/BHandle` records the handle
  used in that match, preserving source display even after identity resolution.
- **Display-name change over time:** update `Player.primaryName`; the previous value is
  auditable via `HistoricalCorrection` and can be retained as a `PlayerAlias`.
- **Country change/correction:** update `Player.country`; audited via
  `HistoricalCorrection`.
- **Account linking without ownership:** `Player.linkedUserId` (+ `linkStatus`,
  `linkedAt`) records that a Payload user *claims* the identity; the `Player` remains the
  canonical record and is never owned by the account.

**Gaps found & fixed.** No per-match alias link (fixed: match handles) and no
account↔player link (fixed: `linkedUserId`/`linkStatus`/`linkedAt`). Name/country history
is handled via the existing correction log rather than a dedicated history table (adequate;
a history table would be speculative).

**DB-enforced vs. app logic.** DB stores aliases, per-match handles, and the link fields.
**App logic / policy:** verifying an account link (who sets `VERIFIED`); merge/split
execution; treating handles as alias candidates.

**Verdict:** ✅ **Supported after changes.**

---

## Workflow 10 — Source & provenance tracking

**Models & relationships.** `Provenance` (on every entity), `SourceReference`
(kind, locator, `field`, `assertedValue`, confidence), `HistoricalCorrection`,
`MatchResult.verifiedByUserId/verifiedAt`, `RecordConfidence`.

**Handling.**
- **Imported vs. native:** `provenance = IMPORTED_8BR | NATIVE_EGO`.
- **Exact file:row:** `SourceReference(kind=FILE_ROW, locator="players.csv:412")`.
- **Manual admin entry:** `SourceReference(kind=MANUAL_REVIEW)` and/or `enteredByUserId`.
- **Correction history:** `HistoricalCorrection` (before/after/status).
- **Confidence / verification:** `RecordConfidence` on results/championships;
  `verifiedByUserId`/`verifiedAt` on results; per-source `confidence`.

**Gaps.** None blocking. **Enhancement made:** `SourceReference.field`/`assertedValue`
(shared with WF6) makes what a source *claims* explicit and conflict-detectable.

**DB-enforced vs. app logic.** DB stores provenance, sources, confidence, verification.
**App logic:** enforcing that verification happens; conflict detection.

**Verdict:** ✅ **Supported** (conflict handling enhanced).

---

## What requires application logic (not DB enforcement) — cross-cutting

These are correct to keep in the application/import layer; noted so they aren't assumed to
be database-guaranteed:

- **Polymorphic integrity** for `SourceReference` / `HistoricalCorrection` / `IssueReport`
  — `(targetType, targetId)` cannot be a DB foreign key; the app/import layer must ensure
  the target exists.
- **Cross-layer references** — `*ByUserId` and `News/Rules` → competition IDs are plain
  fields (no cross-ORM FK); resolution is app-side by design.
- **Winner ∈ {A, B}** — `MatchResult.winnerCompetitorId` matching a match competitor is
  app-enforced (winner lives on a different table than the slots).
- **Standings, head-to-head, and per-player stats** are **derived**; correctness depends
  on the recompute job, not constraints.
- **Bracket progression** (who advances to which fixture) and the **playoff qualification
  cut** are computed by the app.
- **Applying** an approved correction to the live record is an app action; the DB stores
  the audit trail.

---

## Decisions still requiring your input

The schema **supports** each of these; the **policy** is yours to set (and will live in
`Stage.config` / `RankingSystem.config` / rules, or in admin logic):

1. **Registration approval rules** — does `REGISTERED → CONFIRMED` require admin approval,
   and per competition or globally?
2. **Seeding rules** — how are `Seed.seedNo` values derived (prior ranking, group finish,
   manual, random)? Per competition type?
3. **Tiebreak policies** — the ordered tiebreaker list for tied standings (head-to-head,
   game difference, win %, playoff, …).
4. **Ranking formulas** — the algorithm(s) and parameters for each `RankingSystem`
   (all-time wins, season points weighting, ELO constants).
5. **Championship-counting policies** — do division titles count as championships? Are
   cup/tournament titles weighted equally with seasons for "all-time" counts? How are
   shared/vacated titles handled?
6. **Correction approval authority** — who may approve a `HistoricalCorrection`,
   `PlayerMerge`, or `PlayerSplit`, and is a second-reviewer step required before it is
   `APPLIED`?
7. **Do forfeits count toward player win-loss records?** — and the same question for
   **byes**, **walkovers**, and **double forfeits** (affects `PlayerCareerStat` /
   standings computation).
8. **Account↔player link verification** — who may set a `Player.linkStatus` to `VERIFIED`,
   and what evidence is required (relates to preventing cross-alias impersonation).
9. **Bracket feed links (optional)** — should the schema later store explicit
   "winner-of-match-X feeds slot-Y" progression links for live bracket generation, or is
   position-based (round/matchNo) + app logic sufficient? (Currently the latter.)

These are policy choices, not schema blockers — the model already stores the inputs and
outcomes each one governs.
