# 8br.gg — Development & Deployment Workflow

How to build, test, and ship changes safely without ever touching live production data.
(Infra/first-deploy details and recovery live in `DEPLOYMENT.md`; this doc is the day-to-day workflow.)

## TL;DR
- Code lives in Git; **data lives in Neon + Vercel Blob** and is untouched by code deploys.
- Work locally → push `development` (auto-deploys to **staging** on the Neon **staging** branch) → verify → merge to `main` (auto-deploys to **production**).
- **Never** deploy to Production or merge `development → main` without explicit approval.

## Branches
| Branch | Purpose | Vercel env | Auto-deploys to |
|---|---|---|---|
| `main` | Production (source of truth for the live site) | Production | `8br.gg` |
| `development` | Staging / testing | Preview | preview URL (`8br-git-development-…vercel.app`) |
| `feature/*` (optional) | Individual changes | Preview | per-branch preview URL |

Production Branch in Vercel is **`main`** — only commits to `main` create Production deployments; **every other branch → Preview**.

## Environments & what each uses (never share these)
| | Local dev | Staging (Preview) | Production |
|---|---|---|---|
| Runs on | `localhost:3000` | Vercel Preview | Vercel Production |
| Database | local Postgres (`.env`) | Neon **`staging`** branch | Neon **`main`** branch |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | staging preview URL | `https://8br.gg` |
| `PAYLOAD_SECRET` | dev value (`.env`) | distinct Preview value | distinct Production value |
| Media (Blob) | prod store (or local) | *(prod store today — separate `8br-media-staging` store is a planned follow-up)* | production Blob store |

## Databases (Neon branching)
- One Neon project (`8br-prod`) with two branches:
  - **`main`** = production data (endpoint `ep-spring-sun…`).
  - **`staging`** = copy-on-write branch of production (endpoint `ep-odd-frost…`), used only by Preview.
- **Runtime** uses the **pooled** URL; **migrations / restores** use the **direct/unpooled** URL (`DATABASE_URL_UNPOOLED`). `scripts/deploy-migrate.mjs` prefers the unpooled endpoint automatically.
- **Refresh staging from production** (get a fresh copy of prod data for testing) when needed:
  ```bash
  neonctl branches delete staging --project-id <neon-project-id>
  neonctl branches create --project-id <neon-project-id> --name staging
  ```
  Then re-point Preview's `DATABASE_URL` / `DATABASE_URL_UNPOOLED` to the new staging connection strings.

### Environment-variable scoping (names only — values are never committed)
Each DB variable is a **separate per-environment entry** so Preview can never reach the production database.
- **Preview (staging values):** `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`.
- **Production-only (prod values):** `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_*`, `PG*`, `NEON_PROJECT_ID`, `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL`.
- **Per-env, distinct values:** `PAYLOAD_SECRET` (Preview ≠ Production), `NEXT_PUBLIC_SITE_URL`.
- **All environments:** `BLOB_READ_WRITE_TOKEN`.
> Vercel deletes a *whole* variable if you `env rm NAME <env>` on a shared entry. To change one environment, **split first**: `vercel env rm NAME`, then `vercel env add NAME production` (prod value) and `vercel env add NAME preview` (staging value). Verify with `vercel env ls`. Env-var changes only affect **new** builds — the running deployment keeps its build-time values.

## Local development
```bash
npm install
npm run dev            # http://localhost:3000 (uses local Postgres from .env)
npm run typecheck
npm run lint
npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-*.mts   # service-level tests
```
- Local Postgres is fully separate from Neon — you cannot harm live data while building.
- Production build uses the **stable webpack** path: `npm run build` → `next build --webpack` (Turbopack *build* crashes are environmental; webpack is verified green).

## Deploying
- **Staging:** push `development` → Vercel auto-builds a Preview on the staging DB. (Or `vercel deploy` from the branch for a one-off preview.)
- **Production:** merge `development → main` and push → Vercel auto-builds Production on the prod DB. Requires **explicit approval** (see rules).
- Preview URLs are **SSO-protected** (only team members / a bypass token can view them).
- Every deploy runs `vercel-build` → `scripts/deploy-migrate.mjs` (Prisma + Payload migrations against that environment's DB) → `next build`.

## Merge process
1. Branch from `development` (or work on `development` directly for small changes).
2. Push → review the **Preview** deployment on the staging DB.
3. Open a PR into `development`; merge when the preview is healthy.
4. When ready to release: **request approval**, then merge `development → main`. Production deploys on push to `main`.
> Only fast-forward/merge **`main → development`** freely (to keep staging current with a prod hotfix). **Never** merge `development → main` without approval.

## Rollback
- **Production deploy:** Vercel → Deployments → previous build → **Promote to Production** (instant, no rebuild).
- **Code:** `git revert <sha>` on `main`, push.
- **Database:** Neon **Point-in-Time Restore** (7-day history) via the Neon dashboard — restore prod to a prior state or a new branch.
- **Domain:** Vercel → Domains → reassign `8br.gg`/`www` to a prior deployment, or repoint DNS at Porkbun.

## Development rules
1. **Never deploy to Production without explicit approval** — prepare + verify + explain impact, then wait.
2. **Never merge `development → main` without approval.**
3. **Never point Preview at the production database**, and never alter Production DB credentials.
4. **Migrations must be additive** (add tables/columns; no drop/rename) — existing data stays safe. Test every migration on staging first.
5. **Local is for testing code; production is the source of truth for live data.** Never push the local DB up to production. To debug with prod data, pull a copy *down* (or use a Neon staging branch).
6. **Secrets never enter Git.** `.gitignore` covers `.env*` (except `.env.example`), `migration-reports/`, `backups/`, `.vercel/`. Content-scan before pushing.
7. **Auth/user-specific pages must be `export const dynamic = 'force-dynamic'`** (they read `cookies()`/`headers()`; static rendering throws `DYNAMIC_SERVER_USAGE`).
8. **Identity is keyed by permanent IDs** (`Player.id`, `Player.legacyPlayerId`, account username) — never by display name. Display uses `formatIdentityLabel` (`Preferred Name (CueVerse ID)`).
9. **Admin/one-off scripts** guard their target DB (e.g. refuse `localhost`, require a staging/prod host) before writing.

## Key commands
```bash
# env vars (names/scopes only; never print values)
vercel env ls
vercel env add NAME production        # then: vercel env add NAME preview
vercel env pull .env.<env>.local --environment <env>   # gitignored

# deploys
vercel deploy            # Preview (current branch)
vercel --prod            # Production (approval required)
vercel ls 8br            # deployment history
vercel inspect <url>     # a deployment's details/aliases

# neon
neonctl branches list --project-id <neon-project-id>
```
