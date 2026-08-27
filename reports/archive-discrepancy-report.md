# Archive discrepancy report

**Status: informational. Not a deployment blocker.**

The database is manually curated and is the authoritative source of truth. The three archive suites
below compare it against two external captures — the Wayback season pages with their manifests, and
the 8BRCAM CSV export — both of which are known to be incomplete. A difference between them and the
database is therefore a statement about the captures, not a defect in the data.

They are kept, and kept honest, because they are the only mechanical way to notice if the database
ever drifts from the sources where the sources DO speak. They are read as a report, not a gate.

- `verify-archive-all-seasons.mts` — every Division A season against its sources
- `verify-archive-season.mts` — one season in detail
- `verify-playoff-only-seeding.mts` — the 2009 S5A seeding fallback

Internal consistency is verified separately and completely, by `verify-db-integrity.mts`, which asks
only whether the database is coherent on its own terms. That suite passes.

## What the suites currently report

Seasons showing at least one discrepancy: **44 of 44**. Total individual differences: **318**.

### By kind

| Count | Difference |
|---:|---|
| 44 | every recorded handle resolves to exactly one entrant |
| 44 | every grouped player is in the group the archive lists |
| 41 | every archived standing row matches a recomputed one |
| 41 | every archived score sits on the fixture between the right two players |
| 38 | entrant count matches the archive (N) |
| 25 | every archived result was imported (N) |
| 13 | every decided match is one the page records (N) |
| 11 | no entrant exists outside the archive record |
| 8 | every forfeit is one the page records (N) |
| 6 | no entrant is soft-withdrawn |
| 6 | group count matches the archive (N) |
| 4 | the standings disagreement is a recorded anomaly (1 player(s)) |
| 4 | the recorded playoff field is selected (N) |
| 4 | an unrecorded topology is only seated where the archived page records it |
| 3 | the standings disagreement is a recorded anomaly (2 player(s)) |
| 3 | the schedule is a full round robin (0 fixtures) |
| 3 | and each is recorded as an awarded match, not a played one |
| 2 | the standings disagreement is a recorded anomaly (6 player(s)) |
| 2 | the schedule is a full round robin (168 fixtures) |
| 2 | no disqualification was given a score (1 on the page) |
| 1 | the standings disagreement is a recorded anomaly (9 player(s)) |
| 1 | the standings disagreement is a recorded anomaly (7 player(s)) |
| 1 | the standings disagreement is a recorded anomaly (5 player(s)) |
| 1 | the standings disagreement is a recorded anomaly (3 player(s)) |
| 1 | the standings disagreement is a recorded anomaly (20 player(s)) |
| 1 | the standings disagreement is a recorded anomaly (11 player(s)) |
| 1 | the standings disagreement is a recorded anomaly (10 player(s)) |
| 1 | the schedule is a full round robin (189 fixtures) |
| 1 | the schedule is a full round robin (147 fixtures) |
| 1 | the schedule is a full round robin (141 fixtures) |
| 1 | no match result was altered to reconcile the two tables |
| 1 | no disqualification was given a score (2 on the page) |
| 1 | every recorded Round 1 position is seated (N) |
| 1 | every archived score has the archived value, the right way round |

### How to read these

The large categories are all one underlying situation seen from different angles: the captures name
people the curated database records differently, or do not name people it does record. Specifically:

- **every recorded handle resolves to exactly one entrant** — a capture names a handle that has no
  entrant row. The Owner has established these are archive-listed participants who are deliberately
  not being added.
- **every grouped player is in the group the archive lists** / **entrant count matches the archive**
  — the curated roster for a season differs from the partial roster the captures preserved.
- **every archived standing row matches a recomputed one** / **every archived score sits on the
  fixture** — the captures hold results for pairings the curated database does not carry, and in
  several seasons the captures disagree with themselves (a standings table that does not match the
  match table on the same page).
- **the schedule is a full round robin** — a theoretical fixture count implied by roster size, not a
  count of matches anyone can show were played.

### Cross-season checks, which do gate

These are about the database's own coherence and all pass:

- Division B contributes nothing to the ladder, and no Division B season claims to be ranked
- no incomplete season contributes to the ladder; every completed Division A archive season does
- no player is entered twice in one season; every entrant is linked to a canonical Player
- no orphaned standings, group members, group matches or ledger rows
- the two 2006 shared-stage Division B seasons remain open and empty, which is their correct state

One documented exception: entrant 48455 (`apaffiliate`, 2012 S1A, WITHDRAWN) points at a Player the
23 August reversal deleted. The archive confirms the entry, the row is withdrawn so it contributes no
result, and it is preserved by Owner decision rather than deleted. `verify-db-integrity.mts` exempts
that exact id and still fails for any other orphan.
