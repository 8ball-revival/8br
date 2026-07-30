# EGO — Competition Administration System

Internal, staff-only tooling to run an entire season from the website:
registration → group draw → round-robin matches → standings → playoffs, with an
append-only audit trail. The public site consumes the **published** results of
this system — one source of truth, no duplicated logic.

## Route

The staff console lives at **`/staff`** (not `/admin` — that path is reserved by
the embedded Payload CMS admin UI). It is under the `(internal)` route group,
`noindex`, and gated to **admin** and **senior_editor** roles. Signed-out users
see a sign-in prompt; signed-in non-staff see a **403 Forbidden** page. Each page
resolves access before reading any data (defense in depth), so nothing leaks.

Pages: `/staff` (dashboard), `/staff/season`, `/staff/registrations`,
`/staff/groups`, `/staff/matches`, `/staff/standings`, `/staff/playoffs`,
`/staff/audit`.

## Prisma schema (live competition domain)

New models in the Prisma-owned `public` schema, tables prefixed **`comp_`** so they
never collide with the historical archive models (which already use `Group`,
`Match`, etc.). Migration: `prisma/migrations/…_season2_competition_ops`.

| Model | Purpose |
|-------|---------|
| `Season` | Season state: season/registration/groups/playoffs status, dates, race length, qualifiers-per-group |
| `Registration` | A player's entry (PENDING/APPROVED/REJECTED/WITHDRAWN). `userId` + `username` snapshot reference the Payload user (no cross-ORM FK) |
| `SeasonGroup` | A group; `published` gates public visibility + edit locking; records the generation seed |
| `GroupPlayer` | A registration placed in a group with an in-group seed |
| `SeasonMatch` | A round-robin match: scores, winner/loser, status, verification |
| `PlayoffMatch` | A single-elimination match; `feedsMatchId`/`feedsSlot` wire winner advancement |
| `Standing` | Materialized group standings row (recomputed on every verified result) |
| `AuditLog` | Append-only who/when/action/old→new/reason |

Renames from the requested names (client model names must be globally unique):
`Group → SeasonGroup`, `Match → SeasonMatch`, `Standings → Standing`.

## Domain engine (pure, deterministic, `src/lib/competition/`)

All algorithms are pure and unit-testable; the service layer and public reads both
call them — no duplicated logic.

- `prng.ts` — seeded PRNG (xmur3 + mulberry32) + seeded shuffle. **No `Math.random`**.
- `groups.ts` — deterministic ordering + serpentine ("snake") distribution into
  balanced groups. Reproducible: same `(players, numGroups, seed)` → same draw; the
  seed is always recorded.
- `schedule.ts` — round-robin (circle method) match generation.
- `standings.ts` — standings with tiebreakers: wins → game differential → games
  won → head-to-head → username. Marks top-N qualified.
- `bracket.ts` — single-elimination seeding (`seedOrder`), qualifier ordering
  (group winners above runners-up), and bracket construction with bye handling +
  winner-advancement wiring.
- `scoring.ts` — race-to-N validation: winner must reach the race, loser < race,
  no ties, whole numbers.

Service (`service.ts`, server-only) wraps these with Prisma + `recordAudit`, in
transactions where multiple writes must be atomic. Server actions (`actions.ts`,
`'use server'`) authorize via `requireStaffActor()` and `revalidatePath` every
public + staff surface after each mutation.

## Workflows

- **Season** — edit registration open/closed + deadline, season/groups/playoffs
  status, race length, qualifiers-per-group. Saving updates the public site immediately.
- **Registrations** — list, search (User ID), filter by status, approve, reject,
  withdraw, restore. History is never deleted (status transitions only).
- **Groups** — choose the number of groups and draw. Generation is deterministic
  and seeded; generated groups are an **unpublished draft (a preview)**. Move players
  between groups freely pre-publish; after publishing, moves require confirmation.
  Publishing locks the groups and generates the round-robin schedule.
- **Matches** — record scores (validated), verify (only verified results count),
  mark forfeit / no-show (award to a player) or dispute. Standings recompute
  automatically on every change.
- **Standings** — recomputed from verified results; top-N per group shaded as
  qualified.
- **Playoffs** — generate a seeded single-elimination bracket from qualifiers,
  preview it, publish it, enter results, and verify to advance winners.
- **Audit log** — every mutation records who, when, old→new, and an optional reason.

## Public integration

The public `/`, `/groups`, `/playoffs`, `/seasons`, `/register`, `/account` read the
same Prisma data (`lib/competition/public.ts` + `queries.ts`). Published groups show
standings + fixtures; a published bracket renders on `/playoffs`. With no data yet,
they show honest pending/coming-soon states. Public registration now writes a Prisma
`Registration` (PENDING); the account page shows pending-vs-approved. The old
hardcoded `season2.ts` and the Payload `Registrations` collection were removed.

## Permissions & safety

- Single auth system (Payload session) — the console reuses it; no second system.
- `/staff` gated to admin/senior_editor; 403 for other signed-in users.
- Server actions re-authorize on the server (`requireStaffActor`) — never client-trust.
- Score validation and duplicate/lock guards run server-side.
- Group generation never randomizes without recording the seed.
- Historical archive Prisma tables are untouched and empty — **no import performed**.

## Validation performed

Typecheck ✅ · Lint ✅ · Production build ✅ (48 routes). End-to-end pipeline
(temporary in-runtime route, since removed): create season → open registration →
register 8 players → approve → **deterministic** draw (same seed → identical plan) →
publish (12 round-robin matches) → record + verify all → invalid score rejected →
standings with tiebreakers → 4 qualifiers → generate + publish bracket → play it
out to a decided champion → public reads reflect published data → 44 audit entries →
clean teardown. DB verified: archive empty, `comp_` tables live, Payload
`registrations` table dropped.

## Remaining work before Season 2 can be fully operated

- **403 status code**: the forbidden page renders “403 · Forbidden” but returns
  HTTP 200 (same rendering-vs-status caveat as `notFound` in this setup). A true 403
  needs Next's experimental `authInterrupts` + a `forbidden.tsx`.
- **Match scheduling UI**: `rescheduleMatch` exists in the service but has no admin
  form yet (kickoff dates aren't editable from the console).
- **Playoff seeding options**: seeding is fixed (group winners above runners-up);
  “configurable seeding” (manual reseed / third-place, etc.) is not yet exposed.
- **Group-stage completion → playoffs gating**: staff can generate the bracket any
  time standings exist; there is no hard “all group matches verified” guard.
- **Live E2E through the browser forms** (create account member → confirm 403;
  click each admin form) — the service layer is fully validated; a manual UI pass is
  recommended before go-live.
- **Notifications/emails** to players on approval or scheduling — out of scope here.
