# WCC — Architecture

Companion to [`PROJECT_PLAN.md`](./PROJECT_PLAN.md). This document records the **as-initialized**
structure and the major technical decisions. It describes what exists now (the foundation), and the
guardrails future phases must respect.

---

## 1. High-level shape

A single **Next.js (App Router)** application with **Payload CMS 3 embedded inside it**. One process
serves both the public site and the admin panel; both share one **PostgreSQL** database.

```
Browser ──► Next.js app ─┬─ (frontend) route group  → public site (Tailwind + shadcn/ui)
                         └─ (payload)  route group  → /admin panel + /api (Payload)
                                   │
                                   └──► PostgreSQL (single database "ego")
```

- **Public UI** and **Payload admin** are isolated as separate App Router **route groups**, each with
  its own root layout and `<html>`/`<body>`. This keeps Tailwind's global styles out of the Payload
  admin (which ships its own styling) and vice-versa.
- The global stylesheet (`src/app/(frontend)/globals.css`) is imported **only** by the frontend
  layout, never by the admin group.

## 2. Directory structure (as initialized)

```
WCC/
├─ PROJECT_PLAN.md            # product plan, phases, open decisions
├─ ARCHITECTURE.md            # this file
├─ DATA_MODEL.md              # competition schema: ER diagram + per-table docs
├─ WORKFLOW_VALIDATION.md     # schema proven against 10 operational workflows
├─ POLICY_FRAMEWORK.md        # competition/historical policies + fact-vs-policy boundary
├─ README.md                  # exact local setup
├─ .env.example               # documented placeholder env vars (no secrets)
├─ .env                       # real local values (gitignored)
├─ .gitignore
├─ package.json
├─ tsconfig.json
├─ next.config.ts             # wraps Next config with withPayload()
├─ postcss.config.mjs         # Tailwind v4 PostCSS plugin
├─ eslint.config.mjs
├─ components.json            # shadcn/ui configuration
├─ .prettierrc.json
├─ .npmrc                     # legacy-peer-deps=true
├─ prisma/
│  ├─ schema.prisma           # competition/records/identity schema (public schema)
│  └─ migrations/             # committed SQL migrations (init · constraints · workflow_hardening · policy_framework)
├─ scripts/
│  └─ db/
│     ├─ start-db.ps1         # init + start local pgserver PostgreSQL (port 54329)
│     └─ stop-db.ps1          # stop it
├─ src/
│  ├─ payload.config.ts       # Payload config (schemaName 'payload', collections)
│  ├─ payload-types.ts        # GENERATED — do not edit by hand
│  ├─ collections/
│  │  ├─ Users.ts             # auth-enabled; RBAC roles (admin/senior_editor/editor/member)
│  │  ├─ Media.ts             # uploads
│  │  ├─ News.ts              # editorial (drafts/versions)
│  │  └─ Rules.ts             # rules & formats (drafts/versions)
│  ├─ components/
│  │  ├─ site-header.tsx      # placeholder public header + primary nav (IA only)
│  │  ├─ site-footer.tsx      # placeholder public footer + legacy line
│  │  └─ ui/
│  │     └─ button.tsx        # shadcn/ui primitive (foundation example)
│  ├─ lib/
│  │  ├─ utils.ts             # cn() class-merge helper
│  │  └─ prisma.ts            # Prisma client singleton (public-schema queries)
│  └─ app/
│     ├─ (frontend)/
│     │  ├─ layout.tsx        # public root layout (header/main/footer)
│     │  ├─ page.tsx          # EMPTY placeholder homepage (dashboard NOT built)
│     │  └─ globals.css       # Tailwind v4 + shadcn token layer
│     └─ (payload)/           # Payload-provided admin + API routes
│        ├─ admin/[[...segments]]/
│        ├─ api/[...slug]/ · api/graphql/ · api/graphql-playground/
│        ├─ layout.tsx
│        └─ custom.scss
└─ .pgdata/                   # local DB data dir (gitignored, created on first db start)
```

## 3. Key decisions

### 3.1 Payload embedded (not a separate service)
Payload 3 runs inside the Next.js app, so one deploy covers the public site, the admin UI, auth,
RBAC, and record versioning. This minimizes moving parts for a maintainer with limited web
experience. Chosen over a separate admin service (e.g. Directus) and over a hand-rolled admin.

### 3.2 Payload ↔ PostgreSQL division of responsibility (finalized)
Two ORMs, one database, **separate schemas, single owner per table** — no cross-ORM foreign keys:
- **Prisma owns the `public` schema** — the entire competition / records / identity relational core
  (players, competitions, stages, matches, results, standings, rankings, corrections, sources, issue
  reports). This is the FK-dense graph where real relational integrity, indexing, and analytical
  queries matter. Defined in `prisma/schema.prisma`; see **[DATA_MODEL.md](./DATA_MODEL.md)**.
- **Payload owns the `payload` schema** (`schemaName: 'payload'`) — auth + RBAC (Users), Media, and
  editorial content (News, Rules) with drafts/versioning for audit.
- The layers connect only by **application-level IDs** (e.g. `MatchResult.enteredByUserId` → a Payload
  user; `News.relatedPlayerLegacyId` → a Player). Derived reporting tables (standings, head-to-head,
  per-player stats) are recomputed from primary match data so corrections propagate.

**Admin surface (decided):** the Prisma-owned domain (players, competitions, matches, corrections)
will be managed by a **custom authenticated admin section backed directly by Prisma** — **no** Payload
mirror collections. The custom admin authenticates against Payload users and enforces their roles.
See DATA_MODEL.md §1. (Built in a later phase.)

### 3.3 Database adapter & connection
`@payloadcms/db-postgres` with `connectionString: process.env.DATABASE_URL`. Local dev uses the
pgserver-bundled PostgreSQL 16.2 on fixed port **54329** (no Docker on this machine). Production
Postgres provider is undecided (see PROJECT_PLAN §11–12).

### 3.4 Styling: Tailwind v4 + shadcn/ui
Tailwind v4 via `@tailwindcss/postcss`; shadcn/ui configured through `components.json` with a neutral
placeholder token set in `globals.css`. **Colors are placeholders** — final WCC branding
(black/gold or otherwise) is deliberately not locked in. New primitives are added with
`npx shadcn@latest add <component>`.

### 3.5 Route-group isolation
Frontend and Payload admin are separate route groups to prevent CSS/layout bleed and to let each own
its `<html>` shell.

### 3.6 Facts vs. policy
The database stores **facts, sources, and confidence**; the **application applies competition
policy** (qualification cuts, tiebreak order, ranking formulas, which titles count all-time, whether
a forfeit counts toward W-L). Policies are configured per competition / stage / ranking system / match
via `Competition.metadata`, `Stage.config`, `RankingSystem.config`, and enum/override fields — never
hardcoded globally, and historical records are never silently rewritten to modern rules. The approved
policies and the fact/policy boundary live in **[POLICY_FRAMEWORK.md](./POLICY_FRAMEWORK.md)**.

## 4. Conventions

- **Path alias:** `@/*` → `src/*`; `@payload-config` → `src/payload.config.ts`.
- **Generated files** (`src/payload-types.ts`, admin `importMap.js`) are never edited by hand — run
  `npm run generate:types` / `npm run generate:importmap`.
- **No historical records embedded in components** — all record data will be read from PostgreSQL.
- **Provenance:** future records carry an imported-historical (WCC legacy) vs native-WCC flag so
  the two are always distinguishable.
- The retired term **"Prime"** must not appear in code, routes, DB terminology, UI labels, or sample
  content (only inside untouched historical source records, and the legacy on-disk source path).

## 5. Not yet built (future phases)
Data model & import, competition entities (Seasons/Cups/Tournaments and shared stage→group/bracket→
match→result→standing model), public archive pages, corrections/audit workflow, accounts &
registration, and the visual design pass. See PROJECT_PLAN §10.
