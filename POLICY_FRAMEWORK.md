# EGO — Policy Framework

The approved initial competition and historical-record policies for EGO, and how each
maps onto the schema. Policies are **application logic**; the database preserves **facts,
sources, and context**. This document is the authority for how the app should *interpret*
the data — it does not, by itself, change behaviour until the app implements it.

> **General principle.** The database preserves facts, sources, and historical context.
> Application logic applies competition policies. **Historical records are never silently
> rewritten to match modern EGO rules** — historical competitions retain the rules and
> interpretations that applied to them whenever those rules are known. Where they are
> unknown, the uncertainty is recorded and not invented away.

## The fact / policy boundary

| The database stores (facts) | The application applies (policy) |
|---|---|
| What happened: entries, seeds, matches, resolutions, scores, championships, sources, corrections, provenance, confidence | How it counts: qualification cuts, tiebreak order, ranking formulas, which titles count all-time, whether a forfeit counts toward W-L |
| Enumerated states (`MatchResolution`, `EntryStatus`, `RegistrationMode`, …) and their audit trail | The *interpretation* of those states per competition, stage, ranking system, or match |

Each policy below states: **default**, **configurable scope**, **audit requirement**, and
**schema support** (all are representable by the current schema; the small set of genuinely
required additions is listed in §Schema changes).

---

## 1. Registration and entry

**Policy.** Each competition controls its own registration mode:
- **OPEN** — any eligible registered user may submit an entry; submission ≠ participation;
  an admin must confirm unless the competition enables **auto-accept**; capacity/deadline/
  eligibility are competition-specific.
- **APPROVAL_REQUIRED** — players submit an entry request; an admin approves or declines;
  declined/withdrawn entries retain their status reason and audit history.
- **INVITATIONAL** — no public registration; players are added administratively; the entry
  method identifies them as invited / admin-selected.
- **QUALIFICATION_ONLY** — entry is earned via another competition, stage, ranking position,
  or qualifying event; qualification origin is recorded via source/note/relationship.

**Schema support.** `Competition.registrationMode` (`OPEN | APPROVAL_REQUIRED | INVITATIONAL
| QUALIFICATION_ONLY`). `CompetitionEntry.status` (`REGISTERED, CONFIRMED, DECLINED,
WAITLISTED, WITHDRAWN, DISQUALIFIED, NO_SHOW`), `entryMethod` (`PUBLIC_REGISTRATION,
ADMIN_INVITE, ADMIN_ADDED, QUALIFIED, SEEDED`), `statusReason`, `registeredAt`, `updatedAt`.
Auto-accept and capacity/deadline/eligibility are per-competition config in
`Competition.metadata` (e.g. `autoAcceptEntries`, `capacity`, `entryDeadline`). Qualification
origin is a `SourceReference` on the entry and/or `entryMethod = QUALIFIED`. **No fake
payment/prize/financial systems.**

**Default:** `OPEN`, auto-accept **off** (admin confirms). **Configurable:** per competition.
**Audit:** every status change is auditable via `CompetitionEntry.updatedAt` + `statusReason`
(and a `HistoricalCorrection` for a contested change).

---

## 2. Seeding

**Policy.** Support multiple seeding methods per competition — manual, random draw, global
ranking, competition-specific standing, previous-stage finish, previous-season finish,
qualification order, hybrid. The selected method and any manual overrides must be recorded.
Manual seeding must **not erase** an originally calculated/proposed seed. Historical unknown
seeds must remain **unknown**, never inferred.

**Schema support.** `Seed.seedingMethod` (`MANUAL, RANDOM_DRAW, GLOBAL_RANKING,
COMPETITION_STANDING, PREVIOUS_STAGE, PREVIOUS_SEASON, QUALIFICATION_ORDER, HYBRID, UNKNOWN`),
`Seed.seedNo` (effective seed), `Seed.proposedSeedNo` (the original calculated/proposed seed,
preserved when `seedNo` is a manual override). Unknown historical seeds = `seedingMethod =
UNKNOWN` (and no invented `seedNo` — omit the `Seed` row rather than guess a number).

**Default:** `UNKNOWN` on import; the stage-level default method for future competitions is
set in `Stage.config.seedingMethod`. **Configurable:** per seed (row) and per stage.
**Audit:** `proposedSeedNo` retains the pre-override value; overrides are attributable via
the admin action log.

---

## 3. Group-stage tiebreakers

**Policy.** Tiebreakers are configured **per stage** as an **ordered list** — never hardcoded
globally. The recommended initial order for future standard EGO **Seasons**:
1. Match record / standings points → 2. Head-to-head (when applicable and unambiguous) →
3. Game differential → 4. Games won → 5. Strength of schedule (only when the format supports
it) → 6. Administrator-approved tiebreak match → 7. Random draw (last resort).
Historical stages use **their documented** tiebreak rules when known; when unknown, record the
uncertainty and **do not invent** a definitive explanation for qualification order.

**Schema support.** `Stage.config.tiebreakers` — an ordered JSON array of tiebreaker keys.
Uncertainty: `Stage.config.tiebreakRulesKnown = false` (+ a note), and/or a `SourceReference`
on the stage. Standings already store every tiebreak input: `StandingRow.points`,
`gamesFor`/`gamesAgainst` (differential), `wins`, plus pairwise `HeadToHead`; the resolved
order is `StandingRow.rank`.

**Default:** the 7-step order above, applied as the **template** for new Season group stages
(written into each stage's `config`, not global code). **Configurable:** per stage. **Audit:**
a tiebreak-match resolution is a `Match` with `resolution` recorded; the applied order lives in
`Stage.config`.

---

## 4. Rankings

**Policy.** Standings and rankings are separate. Standings belong to one competition/stage and
decide placement/qualification there. Rankings span competitions, use a **named, versioned**
`RankingSystem` that stores configuration/formulas **by version**, and produce **immutable**
`RankingSnapshot`s. A formula change creates a **new version** and must **not rewrite historical
snapshots**. **No final ranking formula is implemented yet.** The platform must be ready for
points-based, rating-based (Elo), weighted competition values, recency/decay, minimum
participation, and separate ranking categories.

**Schema support.** Standings: `StandingRow → Group → Stage → Competition`. Rankings:
`RankingSystem` (`code`, `name`, `config` Json for formula + parameters) → `RankingSnapshot`
(`asOf`, `scope` for category) → `RankingSnapshotItem` (`rank`, `value`). **Versioning
convention (no schema change):** each version is a **new `RankingSystem` row** sharing a stable
`name` (e.g. "Elo"), with the version number and formula in `config` (e.g. `{"version": 2,
"formula": {...}}`); each `RankingSnapshot` references the exact version row it was computed
with, so recomputing "current" creates a new snapshot and never touches old ones. Categories
use `RankingSnapshot.scope`.

**Default:** none — formula intentionally undecided (see §Undecided). **Configurable:** per
ranking system/version. **Audit:** snapshots are append-only and immutable by convention.

---

## 5. Championship counting

**Policy.** Championship records are factual and category-specific. Maintain **separate totals**
for: season, cup, tournament, invitational-tournament (when applicable), division/secondary, and
(future) team championships. The public **"All-Time Champions"** total initially includes **only
recognized individual championships from approved top-level competitions**. Do **not**
automatically treat every achievement, division win, group win, qualification, or team event as an
individual championship. Historical **2v2 / team** championships remain recorded but are **not**
added to an individual singles total. The precise recognized-competition list is **admin-controlled
and documented**. Do **not delete disputed titles** — store the record, classification, evidence,
and dispute status separately.

**Schema support.** `Championship` (champion/runner-up `Competitor`, `competitionId`,
`divisionId`, `confidence`, `bracketReconstructed`, `note`, never deleted). **Category is derived**,
not stored redundantly:
- season/cup/tournament → `Competition.competitionTypeId`;
- invitational tournament → `competitionType = TOURNAMENT AND registrationMode = INVITATIONAL`;
- division/secondary → `Championship.divisionId IS NOT NULL`;
- team → champion `Competitor.type = TEAM`; individual → `PLAYER`.

**Recognition for the main all-time leaderboard (convention, no schema change):** a boolean
`Competition.metadata.recognizedForAllTimeChampionships`, admin-controlled. The main leaderboard
counts a `Championship` **iff** champion is an individual (`Competitor.type = PLAYER`) **and** its
competition is recognized **and** it is not excluded (e.g. secondary/division) by the documented
rule. **Dispute status** is a `IssueReport(targetType = CHAMPIONSHIP)`; the title row is never
deleted; **evidence** is `SourceReference(targetType = CHAMPIONSHIP)`.

**Initial recognition default (documented, adjustable):** `SEASON` primary titles are recognized;
`CUP` and `TOURNAMENT` (incl. invitational) titles are **opt-in** per competition by an admin;
division/secondary and team titles are tracked in their own totals and **excluded** from the main
individual total.

**Default:** as above. **Configurable:** per competition (recognition flag). **Audit:** disputes via
`IssueReport`; recognition changes via the admin log; titles are immutable records.

---

## 6. Accomplishments and Hall of Fame

**Policy.** Achievements are broader than championships (runner-up, semifinal, best record,
undefeated season, ranking/statistical milestones, special recognition). Hall of Fame membership is
**independent** of championship totals; HoF entries require an **administrative selection process**
and may carry a category, induction year, citation, and supporting evidence.

**Schema support.** `Achievement` (`code`, `label`, `value`, optional `competitionId`/`divisionCode`).
`HallOfFameEntry` (`category`, `inductedYear`, `citation`, `rank`, `value`), independent of
`Championship`. Selection process = admin-gated creation (RBAC); **evidence** = `SourceReference
(targetType = HALL_OF_FAME_ENTRY)`.

**Default:** none (curated). **Configurable:** per entry. **Audit:** creation is admin-only; evidence
via source references.

---

## 7. Forfeits, walkovers, byes, and records

**Policy.** `MatchResult.resolution` distinguishes how a match was resolved. Initial statistical
policy (defaults, overrideable per match with an audit trail):

| Resolution | Match W-L | Game-level stats | Notes |
|---|---|---|---|
| **PLAYED** | counts | counts normally | — |
| **FORFEIT** | counts (W + L) unless admin-excluded for a documented reason | **do not invent games**; if an official admin score was assigned, keep it as an *official* score, distinct from games played | disciplinary/historical exclusion is explicit + documented |
| **RETIREMENT** | counts (W + L) | only games actually completed count, unless rules assigned an official final score | — |
| **WALKOVER** | **does not** count toward W-L (no competitive match occurred) | none | may count as bracket advancement |
| **BYE** | **does not** count as win/loss/played | none | counts only as advancement |
| **DOUBLE_FORFEIT** | no normal win | per competition rules, explicitly recorded | — |
| **ADMIN_DECISION** | does **not** auto-count | admin specifies whether it counts and why | — |

**Schema support.** `MatchResult.resolution` (enum, all values present), `winnerCompetitorId`,
`scoreA`/`scoreB` (nullable — never invent games). **Game-level aggregation convention:** only
`resolution IN (PLAYED, RETIREMENT)` contributes to games-won/lost tallies; a stored score on a
non-`PLAYED` resolution is treated as an **official administrative score**, not games played.
**Per-match override with audit:** a `HistoricalCorrection(targetType = MATCH_RESULT, field =
"countsTowardRecord", beforeValue, afterValue, reason, approver)` records an explicit exclusion/
inclusion — the override and its documented reason are preserved.

**Default:** the table above (by resolution). **Configurable:** per match (override). **Audit:**
every override is a `HistoricalCorrection` (who/why/before/after/status).

---

## 8. Corrections and approval authority

**Policy.** Role-based approval:
- **REPORTER** (any member) — may submit an issue report; cannot modify official records.
- **EDITOR** — may research sources and propose a correction; may **not approve their own**
  correction when it changes a championship, player identity, match winner, or canonical record.
- **SENIOR_EDITOR / ADMIN** — may approve ordinary corrections.
- **ADMIN** — required for player merges, player splits, championship changes, canonical identity
  reassignment, and destructive/high-impact corrections.
High-impact corrections use a **second-reviewer** principle whenever more than one qualified admin
is available. Every correction preserves: previous value, proposed/replacement value, reason, source
references, proposer, approver, timestamp, approval status. Superseded historical values are **never
permanently deleted** from the audit record.

**Schema support.** `HistoricalCorrection` (`beforeValue`, `afterValue`, `reason`, `status`
[`PROPOSED, APPROVED, APPLIED, REJECTED, REVERTED`], `proposedByUserId`, `reviewedByUserId`,
`appliedAt`, `sourceReferenceId`). **Multiple sources** attach via `SourceReference(targetType =
HISTORICAL_CORRECTION)`. Identity actions: `PlayerMerge`, `PlayerSplit` (both retain notes +
reviewer + status). **Roles** live in Payload `Users.roles` (`admin, senior_editor, editor,
member`). The **second-reviewer** and **impact classification** (which targets require ADMIN) are
app logic: proposer ≠ approver, and target/field determines impact.

**Default:** ordinary corrections → senior_editor/admin; high-impact (championship, identity,
match winner, merge/split) → admin, second reviewer preferred. **Configurable:** by impact class
(app rule). **Audit:** the `HistoricalCorrection` row IS the audit record; nothing is deleted.

---

## 9. Account-to-player linking

**Policy.** A user account does not own or define a canonical historical player. A user may request
a link: submit claim → admin reviews evidence → approve/reject. Verified links use
`PlayerLinkStatus.VERIFIED`; disputed/uncertain links must not be verified. **Only ADMIN** may set
`VERIFIED`. A player may exist permanently without an account. Deleting/disabling/changing an account
must not delete or rewrite the canonical player or historical records. **No automated identity
verification yet.**

**Schema support.** `Player.linkedUserId` (app-level ref to a Payload user — **no cross-ORM FK**, so
deleting a user cannot cascade to the player), `Player.linkStatus` (`UNLINKED, PENDING, VERIFIED,
REJECTED, REVOKED`), `Player.linkedAt`. Claim = `PENDING`; approve = `VERIFIED` (admin only, app
rule); decline = `REJECTED`; later removal = `REVOKED`. A player with `linkedUserId = null` /
`UNLINKED` exists independently.

**Default:** `UNLINKED`. **Configurable:** per player (per claim). **Audit:** status transitions +
`linkedAt`; only ADMIN sets `VERIFIED`.

---

## 10. Historical confidence and inference

**Policy.** Classify historical facts by verification confidence, distinguishing at minimum:
verified-from-authoritative-source, supported-by-one-source, supported-by-multiple-sources,
inferred-from-surrounding-records, disputed, unknown. Inferred/unverified results display with a
clear indicator. Unknown scores remain **null**. Conflicting sources are **both preserved**. Do
**not** resolve conflicts automatically based only on source count.

**Schema support (derived taxonomy, no schema change).** The six display levels are **computed**
from existing structure:

| Display level | Derived from |
|---|---|
| Verified (authoritative) | `RecordConfidence = EXPLICIT` + a `SourceReference(kind ∈ FILE_ROW/URL/WAYBACK)` and/or `MatchResult.verifiedAt` |
| Single source | exactly one `SourceReference` on the record |
| Multiple sources | ≥ 2 `SourceReference`s on the record |
| Inferred | `RecordConfidence ∈ {HEURISTIC_LABEL, HEURISTIC_COUNT, RECONSTRUCTED}` / `Championship.bracketReconstructed` |
| Disputed | an open `IssueReport(targetType = record)` exists |
| Unknown | `RecordConfidence = UNKNOWN`; unknown scores are `NULL` |

Conflicting sources are preserved as multiple `SourceReference` rows sharing `(targetType, targetId,
field)` with differing `assertedValue`; resolution is a `HistoricalCorrection`, never an automatic
count-based pick.

**Default:** as derived. **Configurable:** per record (confidence + sources). **Audit:** confidence,
sources, disputes, and corrections are all persisted; the UI must show an inferred/unverified badge.

---

## 11. Bracket feed relationships

**Question posed:** can the current bracket model reliably support **live** generation/editing of
winners progression, losers drops, grand finals, bracket resets, automatic advancement, and
re-seeding between rounds?

**Why the previous (position-only) model was insufficient for LIVE play.** Before this framework,
a `Match` located itself only by `bracketId` + `bracketType` + `round` + `matchNo` (+ nullable
competitor slots). That is fully sufficient for **imported static** brackets — every competitor is
already known, so the bracket renders from positions. But for **live** competitions the app would
have to *infer* progression from position math. That inference is reliable for a clean power-of-two
single-elim, but **fragile** for: double-elimination **losers-bracket drop patterns** (which
winners match feeds which losers match depends on bracket size and drop scheme), **grand-final
resets**, **byes** (auto-advance), and **re-seeding between rounds**. Encoding progression only in
app code makes the bracket un-editable and un-auditable at the data layer.

**Smallest addition made (implemented in this migration).** Explicit, self-referential match-feed
links on `Match`:

```
slotASourceMatchId  String?           slotASource  MatchSlotSource?   // WINNER | LOSER
slotBSourceMatchId  String?           slotBSource  MatchSlotSource?
```

Slot A of a match is filled by the **winner or loser** of `slotASourceMatch` (and likewise slot B).
Two nullable self-FKs + two small enums — additive, indexed, with a CHECK that a match is not its
own source. Nothing else in the schema changed.

**How winners and losers feed:**
- **Winners-bracket advance:** downstream match `slotASourceMatch = (upstream WB match)`,
  `slotASource = WINNER`.
- **Losers-bracket drop:** a losers match slot `= (the WB match whose loser drops)`,
  `source = LOSER`. The exact WB→LB mapping is encoded by data (the links), not inferred.
- **Grand final:** `slotA = (WB final, WINNER)`, `slotB = (LB final, WINNER)`.
- **Automatic advancement (bye):** a `BYE` match (one competitor, `resolution = BYE`) has a WINNER;
  the downstream slot sourced from it resolves automatically.
- **Re-seeding between rounds:** the re-seed decides *which* prior match feeds *which* slot; that
  resolved mapping is written as the feed links for that round.

**How a bracket reset is represented.** The grand final is one `Match` (GF1). A **reset** is a
**second** finals `Match` (GF2) whose slots are sourced from GF1: `slotA = (GF1, WINNER)`,
`slotB = (GF1, LOSER)`. GF2 exists as a fixture; the app only **activates/schedules** it when the
loser's-bracket entrant (the `LOSER`-sourced side of GF1) wins GF1 — otherwise GF2 is left
`CANCELLED`/unplayed. No special "reset" column is needed; the feed links express it.

**How historical static brackets stay compatible.** Imported brackets set `competitorAId`/
`competitorBId` **directly** and leave `slot*Source*` **null** — they were never generated live, so
they need no feed links. The `IS DISTINCT FROM` CHECK passes on null, so static rows are unaffected.
Live brackets use the feed links and fill competitor slots as sources resolve. Both coexist in the
same table.

**Worked example — 4-competitor double elimination.**
```
WB: M1 (S1 v S4), M2 (S2 v S3)
WB final:  M3   slotA = (M1, WINNER)   slotB = (M2, WINNER)
LB final:  M4   slotA = (M1, LOSER)    slotB = (M2, LOSER)
Grand F1:  M5   slotA = (M3, WINNER)   slotB = (M4, WINNER)
Reset  F2: M6   slotA = (M5, WINNER)   slotB = (M5, LOSER)   # activated only if M4's side wins M5
```
Every progression edge is a row-level fact; the bracket is generatable, editable, and auditable.

**Default:** live competitions use feed links; imported static brackets use direct competitor slots.
**Configurable:** per match. **Audit:** structural edits to feed links are ordinary record edits.

---

## Policy-decision matrix

| # | Policy | Default | Override scope | Required role (to change) | Audit requirement |
|---|---|---|---|---|---|
| 1 | Registration mode | `OPEN`, auto-accept off | Per competition | Admin | Entry status changes (`updatedAt` + `statusReason`) |
| 1 | Entry confirm/decline | Admin confirms | Per entry | Admin (confirm/decline) | Yes — status + reason |
| 2 | Seeding method | `UNKNOWN` (import) / stage default | Per seed & per stage | Editor+ (Admin for high-stakes) | `proposedSeedNo` preserved on override |
| 3 | Tiebreaker order | 7-step Season template | Per stage (`Stage.config`) | Editor+ | Config-versioned; tiebreak match recorded |
| 4 | Ranking formula | **Undecided** | Per ranking-system version | Admin | New version; snapshots immutable |
| 5 | All-time championship recognition | Seasons recognized; cups/tournaments opt-in | Per competition (`metadata` flag) | Admin | Recognition changes logged; titles never deleted |
| 6 | Hall of Fame induction | Curated, admin-gated | Per entry | Admin (+ selection process) | Evidence via source refs |
| 7 | Forfeit/bye/etc. counting | Per-resolution table | Per match | Admin (to override) | `HistoricalCorrection` per override |
| 8 | Correction approval | Ordinary→Senior Editor; high-impact→Admin | Per correction (by impact) | Editor propose / Senior Editor / Admin approve | Full before/after/reason/proposer/approver preserved |
| 9 | Account→player link | `UNLINKED` | Per player/claim | **Admin only** sets `VERIFIED` | Status + `linkedAt` |
| 10 | Historical confidence | Derived taxonomy | Per record | Editor+ (adds sources/confidence) | Sources/disputes/corrections persisted |
| 11 | Bracket progression | Feed-links (live) / direct (static) | Per match | Editor+ | Structural edits are record edits |

**Global defaults (code-level, same everywhere until overridden):** the per-resolution stat table
(§7), the derived confidence taxonomy (§10), the correction role hierarchy (§8), and "only ADMIN
sets VERIFIED" (§9).
**Configurable per competition:** registration mode + auto-accept, all-time recognition (§1, §5).
**Configurable per stage:** tiebreakers, seeding default (§2, §3).
**Configurable per ranking system/version:** ranking formula + categories (§4).
**Configurable per match:** stat-counting override, bracket feed links (§7, §11).
**Always audited:** entry status changes, seed overrides, corrections, forfeit/stat overrides,
account-link status, championship recognition/dispute changes.

---

## Schema changes made for this framework

Migration `20260729200000_policy_framework` (see the report and DATA_MODEL.md):

| Change | Policy | Why it could not be represented otherwise |
|---|---|---|
| `RegistrationMode` = `OPEN, APPROVAL_REQUIRED, INVITATIONAL, QUALIFICATION_ONLY` | 1 | an enum cannot hold two of the four required modes |
| `EntryStatus` + `DECLINED` | 1 | admin-declined is distinct from player `WITHDRAWN`/`DISQUALIFIED` |
| `Seed.seedingMethod` (+ `SeedingMethod` enum) + `Seed.proposedSeedNo` | 2 | one `seedNo` can't record method **and** preserve an overridden original |
| `PlayerLinkStatus` + `REJECTED` | 9 | a declined claim is distinct from `REVOKED` (un-verifying a granted link) |
| `RecordType` + `HISTORICAL_CORRECTION` | 8 | lets **multiple** `SourceReference`s attach to one correction (plural sources) |
| `Match.slot{A,B}SourceMatchId` + `slot{A,B}Source` (+ `MatchSlotSource` enum, CHECK) | 11 | live progression (losers drops, resets, re-seeds) can't be reliably stored by position alone |
| Payload `Users.roles` + `senior_editor` | 8 | the role hierarchy needs a senior-editor tier |

Everything else (tiebreak lists, ranking versioning, championship recognition, forfeit stat
policy, confidence taxonomy, auto-accept, capacity/deadlines) is represented **without** schema
changes, via `Stage.config` / `RankingSystem.config` / `Competition.metadata`, derivation, and the
existing correction/source/issue structures — as documented above.

---

## Still intentionally undecided (must be set before/at archive import)

1. **Ranking formula(s)** — points weighting, Elo constants, decay, minimum participation,
   category definitions (§4). No formula is implemented.
2. **The precise recognized-competition list** for the main all-time championship leaderboard
   (§5) — which cups/tournaments count, how division and shared/vacated titles are treated.
3. **Auto-accept, capacity, deadline, and eligibility rules** per competition type (§1).
4. **Strength-of-schedule** definition and when a format "supports it" (§3).
5. **High-impact second-reviewer enforcement** — mandatory vs. best-effort when only one admin
   exists (§8).
6. **Evidence bar for account-link verification** (§9) and for Hall of Fame induction (§6).
7. **Whether `DOUBLE_FORFEIT` and admin-decided matches count** in specific competitions (§7).

These are policy choices, not schema blockers — the schema already stores the facts each governs.
