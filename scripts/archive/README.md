# Archive staging & validation pipeline

Prepares the local **8BRCAM archive** for a future Prisma import. **Read-only** on the
archive; **no database writes** in this phase. Output is deterministic (safe to rerun).

## Commands

```bash
npm run archive:stage                       # read archive → normalized staging JSON (data/staging/)
npm run archive:validate                    # validate staging → reports/archive/{validation-summary,review-queue}.json
npm run archive:report                       # render validation Markdown reports (reports/archive/*.md)
npm run archive:context                       # precompute per-issue context + evidence signals → review-context.json
npm run archive:apply-policies                # record approved default policy decisions (idempotent)
npm run archive:review-packet -- --category shared-alias   # export a review packet (read-only)
npm run archive:apply-reviews                # apply APPROVED decisions → data/reviewed-staging/ + review reports + title-count preview
npm run archive:review-test                  # test the decision store (save + history preservation), isolated
npm run archive:import -- --dry-run          # DRY RUN from data/staging — prints the plan, writes nothing
npm run archive:import -- --dry-run --reviewed  # DRY RUN from data/reviewed-staging
```

Order: stage → validate → report → (review in the dashboard) → apply-reviews → import (dry-run).

## Review dashboard

`/archive-review` is an authenticated internal dashboard (Payload auth; `admin` /
`senior_editor` only; noindex; unlinked). It reads `data/staging/`,
`reports/archive/review-queue.json`, and `validation-summary.json`, lets reviewers
record decisions (never auto-resolving), and writes them to `data/review-decisions/`.
It is served at `/archive-review` (not `/admin/archive-review`) because Payload owns
the `/admin/*` catch-all route.

Decision store (`data/review-decisions/`): `decisions.json` (current decision per
stable issue id) + `history.json` (append-only audit). Every write preserves the prior
decision on `previous` and appends to history — nothing is overwritten. The dashboard
(TS) and scripts (mjs) use the same format.

## Layout

| Path | Purpose |
|---|---|
| `scripts/archive/` | pipeline (stage / validate / report / import) + `lib/` |
| `data/staging/` | normalized, DB-shaped staging JSON (raw input → normalized output) |
| `data/review-decisions/` | reviewer decisions (`decisions.json` + append-only `history.json`) |
| `data/reviewed-staging/` | derived layer: staging + approved decisions (staging never modified) |
| `reports/archive/` | validation + review reports (Markdown) + machine-readable JSON |
| `src/app/(internal)/archive-review/` | the authenticated review dashboard (route `/archive-review`) |
| source (read-only) | `archive/cueverse-prime/data/csv` (+ `corrections/`) — self-contained in this repo (formerly copied from `Documents/Cueverse Prime/archive_viewer/...`, which was deleted 2026-08-16) |

Override the source with `ARCHIVE_SOURCE_DIR` / `ARCHIVE_CORRECTIONS_DIR`.

## Staging entities (data/staging/)

`players, competitors, aliases, competitions, divisions, stages, groups, standings,
entries, seeds, matches, championships, achievements, identity-relationships,
source-references, historical-notes` (+ `sources`, `manifest`). Stable staging ids are
derived from archive legacy ids (e.g. `pl:P0969`, `cp:2005-s1`, `ch:2005-s1-single`) —
never from display names. Every record keeps `source {file,row}`, `provenance`,
`confidence`, and (where transformed) raw values.

## Safety

- Never modifies the archive, the preview JSON (`src/lib/preview-data/`), or the database.
- Never auto-merges uncertain identities or invents missing scores/champions.
- `archive:import` is **dry-run only**; it refuses to run without `--dry-run` and never
  opens a PostgreSQL connection.

## Manual review decisions

`reports/archive/review-queue.json` is the queue of everything below confirmed
confidence (shared aliases, merge candidates, non-explicit champions, impossible/
forfeit-unclear matches, incomplete competitions). Manual decisions are recorded in the
archive's existing `corrections/` CSVs (player_merges / player_splits) — the precedent
this pipeline preserves — and re-flow on the next `archive:stage`.

## Future real import (not enabled this phase)

The importer is designed to be idempotent (upsert by staging→legacy natural key),
transactional (per-entity batches), resumable (applied-ids log), logged, scoped
(`--entity` / `--competition`), and gated (`--max-review`, `--stop-on-blockers`).
