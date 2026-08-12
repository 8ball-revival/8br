# World Cue Championships (WCC)

A standalone **tournament platform** for competitive cue sports. Create bracket or
group-stage tournaments, run them end-to-end (registration → bracket → results → champion),
and rank players from completed results.

Built with **Next.js 16** + **React 19**, **Payload CMS 3** (auth/CMS, Postgres `payload`
schema) and **Prisma** (competition domain, Postgres `public` schema). Single committed
black + crimson theme (design tokens in `src/app/(frontend)/globals.css`).

## Quick start

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, PAYLOAD_SECRET, NEXT_PUBLIC_SITE_URL, SETUP_SECRET…
npm run db:deploy         # apply Prisma migrations
npm run dev               # http://localhost:3000
```

Then visit **`/setup`** to create the first administrator (owner) account. See
**[HANDOVER.md](HANDOVER.md)** for full setup, backup/reset, and operations.

## Public site

**Home · Tournaments · Rankings · Predictions · Rules.** Tournament registration is on each
tournament's page; admin tools are under `/staff` and in the tournament workspace.

## Tournament formats

- **Bracket Tournament** (default) — single or double elimination.
- **Group Stage + Playoffs** (optional) — round-robin groups → top qualifiers → generated bracket.

## Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | Static checks |
| `npm run db:deploy` | Apply Prisma migrations |
| `npm run reset:organization` | Full data + account reset (guarded; see HANDOVER.md) |

## Docs

- **[HANDOVER.md](HANDOVER.md)** — owner setup, backup/reset, operations
- `ARCHITECTURE.md`, `DATA_MODEL.md`, `DEPLOYMENT.md`, `DEVELOPMENT.md`
