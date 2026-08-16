# 8BR — Deployment & Recovery

Production host: **Vercel** · Database: **managed PostgreSQL (Neon / Vercel Postgres)** · Media: **Vercel Blob**.

## Why this architecture
- **Next.js 16 + Payload CMS 3.86** are Next-native — Payload runs inside the same Next app, so Vercel hosts both the site and the admin with no separate service.
- **Media → Vercel Blob** (`@payloadcms/storage-vercel-blob`, already configured). Uploads must never live on Vercel's ephemeral filesystem; Blob is durable object storage.
- **PostgreSQL** is required by both Payload (its own `payload` schema) and Prisma (`public` schema) in one database. A managed, pooled Postgres (Neon) fits serverless connection limits; a **direct** URL is kept for migrations.
- No background workers, WebSockets, or long-running jobs — the cup lifecycle, provisioning, and result reporting are all request-scoped, so serverless is appropriate. This is the simplest reliable option for low traffic.
- **Build uses the stable webpack path** (`next build --webpack`); the Turbopack build worker crash is environmental, not code (webpack build is verified green).

## Environment variables (set in Vercel → Project → Settings → Environment Variables; never commit)
| Variable | Purpose | Scope |
|---|---|---|
| `DATABASE_URL` | **Pooled** Postgres connection (app runtime) | Production |
| `DIRECT_URL` | **Direct** Postgres connection (Prisma migrations) | Production |
| `PAYLOAD_SECRET` | Payload auth/crypto secret — strong random, **unique to prod** | Production |
| `NEXT_PUBLIC_SITE_URL` | `https://8BR` — drives canonical URLs, sitemap, Payload serverURL/CORS/CSRF, secure cookies | Production |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store token (auto-added when the Blob store is linked to the project) | Production |

Generate a production `PAYLOAD_SECRET` locally (do not reuse the dev one):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Build & migrate
- Build command: `npm run build` → `next build --webpack` (+ `scripts/postbuild-cjs.mjs`).
- `vercel-build` runs `scripts/deploy-migrate.mjs` (applies `prisma migrate deploy` using `DIRECT_URL`) then the build.
- Node: `>=20.9.0` (set the Vercel project Node version to 20.x or 22.x).

## Production data
The archive, rankings, and identity resolution are **code/fixture-derived** — they need no DB rows. The database only needs the **account/identity layer + Payload content**:
- 32 canonical players, 30 migrated accounts + claim records, `legacyPlayerId` ranking bridges, the Brian/fsm-brian merge, plus the Owner account and Payload News/Rules/Media.
- Seed production by restoring a **sanitized copy** of the verified local backup (`backups/8br-local-*.dump`) — real data kept, disposable test records dropped. Claim-code **hashes** stay (accounts must remain claimable); plaintext codes are only in the gitignored report.
- Never restore the raw dev DB wholesale without the sanitization pass.

## Backups & recovery
- **Local backup:** `backups/8br-local-<timestamp>.dump` (pg_custom format, both schemas, gitignored). Restore: `pg_restore --clean --if-exists -d "<DATABASE_URL>" <dump>`.
- **Production DB backups:** enable Neon's automatic Point-in-Time Restore (default 7-day history) — no extra config; restore via the Neon dashboard branch/restore.
- **Media backup:** Vercel Blob is durable; for an extra copy, `vercel blob list` + periodic download.
- **Env var recovery:** re-add from this manifest (values are held only in Vercel + your password manager).
- **Deployment rollback:** Vercel → Deployments → previous build → "Promote to Production" (instant, no rebuild).
- **Domain rollback:** Vercel → Domains → reassign `8BR` to a prior deployment, or repoint DNS at the registrar.

## Secrets hygiene
`.gitignore` excludes all `.env*` (except `.env.example`), `migration-reports/` (claim codes), and `backups/`. No secret, connection string, token, or claim code is tracked in git (verified across the working tree and history).
