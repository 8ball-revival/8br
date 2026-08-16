# WCC — Offline Snapshot

A **frozen, self-contained, offline copy** of the World Cue Championships project, split off from
the working 8 Ball / 8br.gg project so it can be resumed later as a **completely independent
product** with brand-new accounts, database, and services.

> ⚠️ **This snapshot must never be reconnected to 8br.gg or any account, database, deployment,
> storage, email, domain, DNS, analytics, or repository used by 8br.gg.** It intentionally ships
> with **no live credentials** and **no remotes** so it fails safe rather than touching the original
> project's services. When you resume WCC, create entirely new, separate accounts (see
> [Future WCC ownership](#future-wcc-ownership)).

---

## Snapshot facts

| | |
|---|---|
| **Snapshot date** | 2026-08-15 |
| **Original project path** | *(historical)* `C:\Users\Cerebro\Documents\8BR` — **deleted 2026-08-16** |
| **WCC snapshot path** | *(historical)* `C:\Users\Cerebro\Documents\WCC` — **deleted 2026-08-16** |
| **Current project path** | `C:\Claude\8BR` — the canonical project, consolidated from the WCC snapshot |
| **Git branch @ copy** | `wcc-rebrand-reset` |
| **Git commit @ copy** | `2f433f5` — "CueVerse ID = canonical identity/login; fix format badge; merge Profile into member Overview" |
| **Working tree at copy** | **Clean** (all work committed before copying) |
| **Local Git history copied** | **Yes** — full `.git`, 89 commits, branches `development`, `main`, `wcc-rebrand-reset` |
| **Original remote** | `origin → https://github.com/8ball-revival/8br.git` **— removed from this copy only** |
| **Remote in this copy** | **None** (verified: `git remote -v` is empty) |
| **Node** | v24.18.1 (engines: `^18.20.2 || >=20.9.0`) |
| **Package manager** | npm 11.16.0 |

## Toolchain / commands (run from `C:\Claude\8BR`)

| Task | Command |
|---|---|
| Install deps | `npm install` (runs `prisma generate` via postinstall) |
| Dev server | `npm run dev` (http://localhost:3000) |
| Production build | `npm run build` |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Lint | `npm run lint` (`eslint .`) |
| Payload types | `npm run generate:types` |
| Verify scripts | `npx tsx --tsconfig scripts/tsconfig.verify.json scripts/<name>.mts` (e.g. `verify-identity`, `verify-swiss`, `identity-integrity`, `verify-team-register`) |
| DB migrate (new DB) | `npm run db:deploy` (or apply `prisma/migrations/**/migration.sql` manually — this project has historically applied additive SQL via `prisma db execute`) |

## Environment variables (names only — **no values are stored in this snapshot**)

Copy `.env.example` to `.env` and fill in your **new** WCC values. Required/used vars:

- `DATABASE_URL` — Postgres connection (Prisma **and** Payload). Point at a **new** WCC database.
- `DIRECT_URL` — unpooled connection for migrations (optional locally).
- `PAYLOAD_SECRET` — Payload token signing secret (generate a fresh long random value).
- `SETUP_SECRET` — optional gate for the one-time `/setup` first-owner page.
- `NEXT_PUBLIC_SITE_URL` — canonical/OpenGraph/cookie host.
- `WCC_WWW_HOST`, `WCC_APEX_ORIGIN` — optional www→apex redirect (both unset = redirect off).
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — transactional email (password reset). Unset = emails log to console.
- `BLOB_READ_WRITE_TOKEN` — Payload media storage on Vercel Blob. Unset = media uploads unavailable; app still builds/runs.

With no `.env`, the app **fails safe** (no DB/service connection) rather than reaching the original project.

## Database snapshot (preservation data)

- **Dump:** `backups/wcc-frozen-local-2026-08-15.dump` (PostgreSQL custom format, all schemas).
- **Contents:** both schemas — `payload.*` (users/auth/media metadata/news/rules) and `public.*`
  (competition domain: tournaments, seasons, groups, matches, brackets, teams, registrations,
  rating ledger/rankings, audit log, config). Verified with `pg_restore --list` → 76 table-data
  entries (14 `payload`, 62 `public`).
- **Sanitized row counts:** `backups/wcc-frozen-rowcounts-2026-08-15.txt` (table names + row estimates
  only; no data, no secrets).
- This dump is **preservation data only.** A future WCC session restores it into a **new, dedicated**
  local or hosted WCC database that has no connection to 8br.gg.

### Restore into a NEW local database (example)

```bash
# 1) create an empty target DB (do NOT reuse any 8br database)
createdb wcc            # or: CREATE DATABASE wcc;
# 2) restore
pg_restore --no-owner --no-privileges -d "postgresql://USER:PASS@HOST:PORT/wcc" \
  "backups/wcc-frozen-local-2026-08-15.dump"
# 3) point .env DATABASE_URL at that new DB, then: npm run dev
```

> The dump has **no migration-history table** (`_prisma_migrations` was never created in the source
> dev DB). Schema changes here were applied as additive SQL under `prisma/migrations/**`. After
> restoring the dump you already have the current schema; only apply new migration SQL going forward.

## Media

- The original stores Payload media on **Vercel Blob** (online), gated by `BLOB_READ_WRITE_TOKEN`
  in `src/payload.config.ts`. No local `media/`/`uploads/` folder exists, and the database's
  `payload.media` table has **0 rows** — so there were **no media files to download**, and nothing
  was pulled from Vercel Blob (which would have required the live token).
- `public/media/` is created **empty** for future local uploads.
- **Former provider (historical only):** Vercel Blob. No credentials are stored. With
  `BLOB_READ_WRITE_TOKEN` unset in this copy, Payload does not connect to it.

## External local files copied in (made self-contained)

These lived outside the project on this machine and are now **inside the snapshot**; the scripts that
use them were repointed to these internal locations (see [absolute-path audit](#absolute-path-audit)).

> The "From" column records where each file **originally** came from. Those source folders under
> `Documents\` were deleted on 2026-08-16 — the copies inside this project are now the only ones.

| Now at | From (original, historical) | Used by |
|---|---|---|
| `public/assets/branding/` — `wccbanner.png`, `wcclogo.png`, `wcclogo2.png`, `wccbackground.png` | `Downloads\wcc*.png` | Branding **design references** — preserved, **not** wired into the app (wiring would be a design change). |
| `archive/migration-inputs/fixed accounts.txt` | `Downloads\fixed accounts.txt` | `scripts/migrate-ranked-accounts-dryrun.mts` |
| `archive/wayback-seasons/` | `Downloads\Seasons` | `scripts/parse-wayback-brackets.py` |
| `archive/cueverse-prime/data/csv/` | `Documents\Cueverse Prime\archive_viewer\data\csv` | `scripts/build-archive-seasons.py`, `scripts/archive/lib/io.mjs` |
| `archive/cueverse-prime/corrections/` | `Documents\Cueverse Prime\archive_viewer\corrections` | same archive scripts |

## Folders excluded (regenerable — not required to preserve)

| Excluded | Why | How to restore |
|---|---|---|
| `node_modules/` | large, machine-specific, safely regenerable | `npm install` |
| `.next/` | build cache | regenerated by `npm run dev` / `npm run build` |
| `.pgdata/` | local Postgres cluster internals (not portable) | not needed — restore `backups/*.dump` into a fresh DB |
| `.vercel/` | Vercel deployment link | intentionally omitted (disconnect) |
| secret `.env` files (`.env`, `.env.local`, `.env.production.local`, `.env.staging.local`, `.env.8br-backup`, `.env.prod.local.txt`) | contained live credentials for 8br services | recreate `.env` from `.env.example` with **new** WCC values |

`package-lock.json` **is** included, so `npm install` reproduces the exact dependency tree. `node_modules`
is the only regenerable dependency folder excluded.

## Services deliberately disconnected

This copy retains **no active connection** to any of these:

- **GitHub** — `origin` remote (`github.com/8ball-revival/8br.git`) removed from the copy's `.git`.
- **Vercel** — `.vercel/` deployment link excluded.
- **Vercel Blob** (media storage) — no token; not connected.
- **Shared Postgres / Neon** — real `DATABASE_URL`/`DIRECT_URL` excluded; template points at a local placeholder.
- **Resend** (email) — API key excluded.
- **Domain / DNS / analytics / monitoring** — none configured in this copy.

## Absolute-path audit

Every executable script that referenced an external absolute path was repointed to a project-relative,
WCC-internal path (edits made **only** in this copy):

- `scripts/migrate-ranked-accounts-dryrun.mts` → `archive/migration-inputs/…` + `migration-reports/` (via `import.meta.url`).
- `scripts/regen-claim-codes.mts` → `migration-reports/` (via `import.meta.url`).
- `scripts/archive/lib/io.mjs` → `archive/cueverse-prime/{data/csv,corrections}` (via `REPO_ROOT`).
- `scripts/build-archive-seasons.py`, `scripts/parse-wayback-brackets.py` → `archive/…` (via `__file__`).

Remaining mentions of the old `Documents\Cueverse Prime\...` path are **historical documentation only**
(`PROJECT_PLAN.md`, `FRONTEND.md`, and a parenthetical in `scripts/archive/README.md`) and are not a
runtime/script/test dependency. That folder was deleted on 2026-08-16; the read-only viewer now lives
at `C:\Claude\Archive Viewer`. Legitimate public URLs (CueVerse links, third-party docs) were left
untouched.

## Future WCC ownership

When WCC resumes it must use **entirely new, separate** accounts — **none shared with 8br.gg,
including the ownership email**. You will need to create (do **not** create these now):

- A new WCC ownership email • a new GitHub account/org + repository • a new Vercel account/project •
  a new PostgreSQL database • new media storage • a new transactional-email provider • a new domain +
  DNS • new analytics/monitoring (optional) • new environment secrets • new Admin accounts.

## Opening this snapshot in a future Claude session

1. Open the folder `C:\Claude\8BR` as the project root.
2. `npm install` (regenerates `node_modules` + Prisma client).
3. The project now carries its **own** contained PostgreSQL cluster — run `.\dev.ps1`, which starts it
   and then the site. (Historically this step meant creating a new database by hand and restoring
   `backups/wcc-frozen-local-2026-08-15.dump` into it.)
4. Copy `.env.example` → `.env` and fill in **new** WCC values (new DB, new `PAYLOAD_SECRET`, etc.).
5. `npm run dev`. Visit `/setup` to create the first owner (only works while no account exists) — or
   sign in with a restored account.
6. **Never** point `.env` at an 8br database or reconnect any 8br service/account.

## Identity model note (as of this snapshot)

CueVerse ID is the single canonical account identity, username, and login name. The Payload `username`
is a controlled lowercase projection kept in sync only by the central identity service
(`src/lib/players/service.ts`); `Player.cueverseIdNormalized` (UNIQUE) enforces case-insensitive
uniqueness. Run `npx tsx --tsconfig scripts/tsconfig.verify.json scripts/identity-integrity.mts` to
audit identity integrity after any restore.
