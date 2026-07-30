# EGO — Elite Gamers Only

<sub>formerly known as 8BRCAM</sub>

The competitive organization and historical home for **CueVerse** online pool competition.

This repository is the **foundation only**. The public homepage, data model, historical import,
and admin features are not built yet — see [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) and
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Stack

TypeScript · Next.js (App Router) · PostgreSQL · Payload CMS 3 (embedded) · Tailwind CSS v4 · shadcn/ui

## Prerequisites

- **Node.js** ≥ 20 (developed on v24)
- **Python 3.12** with the `pgserver` pip package — provides the bundled PostgreSQL 16.2 used for
  local development (no Docker needed). Install with: `py -m pip install pgserver`

## Local setup (exact steps)

Run everything from the project root: `C:\Users\Cerebro\Documents\8BR`

1. **Create your env file** (copy the template and adjust if needed):

   ```bash
   copy .env.example .env
   ```

   The default `DATABASE_URL` already points at the local dev database below. Set a real
   `PAYLOAD_SECRET` for anything beyond local use.

2. **Start the local database** (initializes `./.pgdata` on first run, then starts PostgreSQL on
   port **54329** and creates the `ego` database):

   ```bash
   powershell -ExecutionPolicy Bypass -File scripts/db/start-db.ps1
   ```

3. **Install dependencies:**

   ```bash
   npm install
   ```

4. **Start the dev server:**

   ```bash
   npm run dev
   ```

5. Open the app:
   - Public site → **http://localhost:3000**
   - Payload admin → **http://localhost:3000/admin** (first visit prompts you to create the first admin user)

6. **Stop the database** when you're done:

   ```bash
   powershell -ExecutionPolicy Bypass -File scripts/db/stop-db.ps1
   ```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Next.js + Payload in development |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run generate:types` | Regenerate `src/payload-types.ts` from the Payload config |
| `npm run generate:importmap` | Regenerate the Payload admin import map |

## Project layout

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full structure and the reasoning behind each decision.

## Data & the legacy 8BRCAM archive

Historical source data lives **outside this repo** at `Documents\Cueverse Prime\archive_viewer` and is
**never modified** and **never** used as a live production source. It will be imported as validated
snapshots into PostgreSQL in a later phase. Imported historical records and native EGO records are
kept distinguishable. See `PROJECT_PLAN.md` §7.
