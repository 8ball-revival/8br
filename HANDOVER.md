# 8 Ball Registry (8BR) — Owner Handover

This is a fresh **8 Ball Registry** tournament platform. It ships with **no accounts,
no tournaments, empty rankings, and no historical data**. This guide covers first-run setup,
the backup/reset commands, and the day-to-day tournament workflow.

## Stack

- **Next.js 16** (App Router) + **React 19**
- **Payload CMS 3** owns auth/CMS in the Postgres `payload` schema (Users, Media, News, Rules)
- **Prisma** owns the competition domain in the Postgres `public` schema (tournaments, brackets, rankings)
- Single committed **black + crimson** theme; design tokens live in `src/app/(frontend)/globals.css`

## 1. Environment variables

Copy `.env.example` → `.env` and fill in:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (pooled on Neon). Used by Prisma AND Payload. |
| `DIRECT_URL` | Unpooled connection, migrations only (falls back to `DATABASE_URL`). |
| `PAYLOAD_SECRET` | Long random secret for Payload tokens. |
| `NEXT_PUBLIC_SITE_URL` | Public origin (canonical/OG URLs, admin cookies/CORS). |
| `SETUP_SECRET` | **Recommended.** Gate for the one-time `/setup` owner-creation page (see §3). |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Optional — enables real password-reset email via Resend. |
| `SITE_WWW_HOST` / `SITE_APEX_ORIGIN` | Optional www→apex redirect for your domain. |
| `BLOB_READ_WRITE_TOKEN` | Optional — Vercel Blob for media uploads. |

## 2. First run

```bash
npm install
npm run db:deploy      # apply Prisma migrations
npm run dev            # Payload auto-syncs its schema in dev
```

## 3. Create the first administrator (secure setup)

There is **no default admin and no hardcoded password**. On a fresh database:

1. (Recommended) set `SETUP_SECRET` to a value only you know.
2. Visit **`/setup`**. Enter the setup secret (if set) + a username, email, and password.
3. This creates the **Owner** account, signs you in, and **permanently disables `/setup`**.

The setup page only works while no account exists. Public signup and Payload's `/admin`
first-user screen **cannot** create the owner (enforced by the Users bootstrap hook), so no one
can silently claim ownership before you do.

## 4. Backup and reset commands

**Always back up before a reset.** Local example (adjust host/db):

```bash
"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" --format=custom --no-owner \
  --file="backups/8br-backup-YYYYMMDD.dump" "postgresql://USER:PASS@HOST:5432/DB"
```

Restore:

```bash
pg_restore --clean --if-exists --no-owner -d "postgresql://USER:PASS@HOST:5432/DB" backups/8br-backup-YYYYMMDD.dump
```

**Full organization reset** (wipes ALL data + ALL accounts; leaves schema + migration history):

```bash
# PowerShell — TARGET DB = current DATABASE_URL. Back up first.
$env:CONFIRM_RESET="YES"; npm run reset:organization
```

After a reset, redeploy and visit `/setup` again to create the new owner.

## 5. Public navigation

Exactly: **Home · Tournaments · Rankings · Predictions · Rules**. Tournament registration is on
each tournament's page. Admin tools live in the staff area (`/staff`) and the tournament workspace.

## 6. Running a tournament (owner/admin)

From **Tournaments** (or `/staff`), click **Create tournament** and pick a **Tournament Format**:

- **Bracket Tournament** (default) — single or double elimination.
- **Group Stage + Playoffs** (optional) — round-robin groups, then top qualifiers advance into a
  generated playoff bracket. Group settings (number of groups, qualifiers per group, seeding,
  playoff elimination type) appear only when this format is selected.

Lifecycle (server-enforced + audited): **Draft → Registration Open → Registration Closed →
(Group Stage →) Bracket Generated → In Progress → Completed**. In the tournament workspace you
open/close registration, add players, generate the bracket, begin the tournament, record results
(players can self-report a loss), advance the bracket, and complete it. Completing a tournament
updates the **Rankings** ladder.

## 7. Rankings & Predictions

- **Rankings** — a Glicko-2 ladder (Current / Historical / All-Time). It starts **empty** and
  rebuilds automatically from **completed tournaments** using the existing rating formula
  (the historical archive was removed; the formula was preserved).
- **Predictions** — a feature page, tournament-oriented (no persistence engine yet).

## 8. Things to do before going live

- Provision your Postgres DB and set all env vars (§1).
- Set `NEXT_PUBLIC_SITE_URL` to your real domain; configure `SITE_WWW_HOST`/`SITE_APEX_ORIGIN` if desired.
- Set `SETUP_SECRET`, deploy, run `/setup`.
- (Optional) add `RESEND_API_KEY` + a verified `RESEND_FROM_EMAIL` for password-reset email.
- (Optional) replace the homepage hero banner at `public/8br-hero-banner.png`.
- Rotate any secrets in your `.env*` files.

## Notes

- The homepage hero banner is `public/8br-hero-banner.png` (referenced from `src/app/(frontend)/page.tsx`).
- Historical Prisma/Payload **migration files** retain old table/enum names (e.g. `comp_season`,
  and the previous `Provenance` enum values). These are immutable applied history and are never
  shown or executed by the live app — the active schema uses 8BR/tournament names.
