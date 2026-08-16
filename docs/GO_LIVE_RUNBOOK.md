# WCC → cueverse.net — Go-Live Runbook

Bring the WCC app live at **https://cueverse.net** on **Vercel + Neon Postgres**, owned entirely by
the new account **cueversewcc@gmail.com** (shared with none of the 8br.gg services).

> **Who does what:** Claude prepared the code, config, and this runbook. **You** create the accounts
> and click through the dashboards (Claude can't create accounts or enter your credentials). Every
> command below is copy-pasteable; run them from the project root, `C:\Claude\8BR`.

> **Historical note (2026-08-16):** this runbook was written when the project lived at
> `C:\Users\Cerebro\Documents\WCC`. That folder has been deleted; the canonical project is now
> `C:\Claude\8BR`. Paths below have been updated. The Vercel/GitHub targets described here refer to
> the temporary WCC deployment and are **not** the current 8br.gg configuration.

> **Stack reality:** WCC is a Next.js + Payload CMS + PostgreSQL app. It runs on Vercel (Node), **not**
> on WordPress. cueverse.net's DNS will be repointed from WordPress to Vercel — see Step 8's warning.

---

## What Claude already changed (committed in this copy)

- From-email default → `noreply@cueverse.net` (`src/payload.config.ts`).
- `.env.example` → `NEXT_PUBLIC_SITE_URL=https://cueverse.net`, `RESEND_FROM_EMAIL=noreply@cueverse.net`,
  `WCC_WWW_HOST=www.cueverse.net`, `WCC_APEX_ORIGIN=https://cueverse.net`.
- `next.config.ts` www→apex redirect comment points at cueverse.net (the redirect itself is env-gated).
- The deploy pipeline (`scripts/deploy-migrate.mjs`, run by `vercel-build`) already auto-applies all
  Prisma + Payload migrations to a fresh database on first deploy — no manual schema work needed.

Nothing here is wired to 8br: no git remote, no `.vercel`, no live `.env`, no Blob/Resend/DB creds.

---

## Prerequisites (on this PC)

- Git, Node 20+ (you have v24), npm — already installed.
- A card for Vercel/Neon if you exceed free tiers (both have free tiers that cover a launch).

---

## Step 1 — Create the owner Google account

1. Create **cueversewcc@gmail.com** at https://accounts.google.com/signup.
2. Turn on 2-Step Verification. **Use this same Google account to sign up for GitHub, Vercel, Neon,
   and Resend** (via "Continue with Google") so everything is owned by one identity.

## Step 2 — GitHub: new account + repo, then push this copy

1. Sign up at https://github.com/signup with **cueversewcc@gmail.com** (or "Continue with Google").
2. Create a **private** repo named `cueverse-wcc` (or `wcc`). **Do not** add a README/.gitignore
   (this project already has them).
3. Point this local copy at the new repo and push all history (89 commits):

   ```bash
   cd /c/Claude/8BR
   git remote add origin https://github.com/<your-user>/cueverse-wcc.git
   git branch -M main
   git push -u origin main
   ```

   When prompted, authenticate with your new GitHub account (browser or a Personal Access Token).

> The frozen DB dump in `backups/` and `node_modules/` are gitignored — they won't (and shouldn't) push.

## Step 3 — Vercel: import the repo

1. Sign up at https://vercel.com/signup with the **GitHub** account from Step 2.
2. **Add New → Project → Import** `cueverse-wcc`.
3. Framework preset: **Next.js** (auto-detected). Build command is already `npm run vercel-build`
   (set in `vercel.json`) — leave defaults.
4. **Do not deploy yet** — add env vars first (Step 6). If it auto-deploys and fails, that's expected;
   it will succeed once env vars + DB exist.

## Step 4 — Neon: create the Postgres database

1. Create a Neon project at https://neon.tech (sign in with Google/GitHub). Region: closest to your users.
2. In the Neon dashboard, open **Connection Details** and copy **two** connection strings:
   - **Pooled** (has `-pooler` in the host) → this is `DATABASE_URL`.
   - **Direct / unpooled** (no `-pooler`) → this is `DIRECT_URL` (migrations need it).
   Both must include `?sslmode=require`.

   > Tip: Vercel's Neon **Marketplace integration** can inject these automatically. If you use it,
   > you can skip manually setting `DATABASE_URL`/`DIRECT_URL` — the deploy script also reads
   > `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING` that the integration provides.

3. Start with an **empty** database (recommended for a clean public launch). The first deploy creates
   the entire schema automatically. See [Data: fresh vs. restore](#data-fresh-start-vs-restoring-the-snapshot).

## Step 5 — Generate secrets

```bash
# PAYLOAD_SECRET (token signing) — a fresh 64-char random value:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# SETUP_SECRET (one-time /setup gate) — any strong random string, e.g.:
node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"
```

Keep these somewhere safe (a password manager). Never commit them.

## Step 6 — Set Vercel environment variables

Project → **Settings → Environment Variables** (apply to **Production**, and Preview if you want
preview deploys to work). Add:

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (`...-pooler...?sslmode=require`) |
| `DIRECT_URL` | Neon **direct/unpooled** connection string (`?sslmode=require`) |
| `PAYLOAD_SECRET` | the 64-char value from Step 5 |
| `SETUP_SECRET` | the value from Step 5 (gates `/setup`) |
| `NEXT_PUBLIC_SITE_URL` | `https://cueverse.net` |
| `WCC_WWW_HOST` | `www.cueverse.net` |
| `WCC_APEX_ORIGIN` | `https://cueverse.net` |
| `RESEND_API_KEY` | *(add in Step 10, after Resend is set up — optional for first deploy)* |
| `RESEND_FROM_EMAIL` | `noreply@cueverse.net` *(add with the key in Step 10)* |
| `BLOB_READ_WRITE_TOKEN` | *(auto-set when you create a Blob store in Step 11)* |

The app builds and runs without `RESEND_*` and `BLOB_*` (email logs to console; media upload disabled),
so you can launch first and add those after.

## Step 7 — First deploy

1. Trigger a deploy (Vercel → Deployments → Redeploy, or `git push`).
2. Watch the build log. You should see the migration step run first:
   - `▶ Prisma: applying migrations (public schema)`
   - `▶ Payload: applying migrations (payload schema)`
   - `✓ All database migrations applied.`
   then the Next.js build. On a fresh Neon DB this creates every table cleanly.
3. When it finishes, open the temporary `*.vercel.app` URL. The site should load with **empty**
   Rankings/Tournaments (no data yet) — that's correct for a fresh launch.

> **If the migration step fails** (rare), it's almost always the DB URL: confirm `DIRECT_URL` is the
> **unpooled** Neon string. The migrate engine needs advisory locks a pooled endpoint can't provide.

## Step 8 — Point cueverse.net at Vercel

> ⚠️ **This takes cueverse.net away from WordPress.** Once DNS moves, the WordPress site at that domain
> stops serving. If you need any WordPress content, save/migrate it first. (If you'd rather keep
> WordPress on the root and run WCC on a subdomain instead, tell Claude — that's a small config change.)

1. Vercel → Project → **Settings → Domains** → add `cueverse.net` **and** `www.cueverse.net`.
2. Vercel shows the exact DNS records. At your **domain registrar / DNS host** (where cueverse.net's
   nameservers point today — likely your WordPress host), set:
   - **Apex `cueverse.net`** → `A` record to Vercel's IP (Vercel shows it, currently `76.76.21.21`),
     **or** an `ALIAS`/`ANAME` to `cname.vercel-dns.com` if your DNS supports it.
   - **`www`** → `CNAME` to `cname.vercel-dns.com`.
   - Remove the old WordPress A/CNAME records for these hosts.
3. Wait for DNS propagation (minutes–hours) and Vercel's automatic SSL to issue. `www.cueverse.net`
   will 301 → `cueverse.net` via the app's built-in redirect (from `WCC_WWW_HOST`/`WCC_APEX_ORIGIN`).

## Step 9 — Create the owner account (one-time)

1. Once `https://cueverse.net` is live, visit **https://cueverse.net/setup**.
2. Enter the **SETUP_SECRET** (Step 5), then choose the owner's **CueVerse ID**, optional Preferred
   Name, **email = cueversewcc@gmail.com**, and a strong password.
3. Submit → you're signed in as the Owner, and `/setup` permanently disables itself.
4. From then on, `/register` is open to the public and `/login` works normally. CueVerse ID is the
   login identity (username and CueVerse ID can never diverge — see `WCC_OFFLINE_SNAPSHOT.md`).

## Step 10 — Email (Resend) for password resets

1. Sign up at https://resend.com (Google). **Add Domain → cueverse.net**.
2. Add the **DKIM/SPF/DMARC** DNS records Resend shows you (at the same DNS host as Step 8). Wait for
   "Verified".
3. Create an **API key**. In Vercel, set `RESEND_API_KEY` = that key and `RESEND_FROM_EMAIL` =
   `noreply@cueverse.net`, then redeploy. Password-reset + forgot-password emails now send for real
   (until then, Payload logs them to the server console — dev-only).

## Step 11 — Media uploads (Vercel Blob)

1. Vercel → **Storage → Create → Blob** store, linked to this project.
2. It auto-adds `BLOB_READ_WRITE_TOKEN` to the project's env. Redeploy. Payload media uploads
   (news images, etc.) now persist to Blob. Without it, the app still runs; uploads are just disabled.

## Step 12 — Post-launch verification

- [ ] `https://cueverse.net` loads; `www.` and `http://` redirect to `https://cueverse.net`.
- [ ] `/setup` now shows "already complete" (owner exists).
- [ ] Sign in as owner; `/staff` (Admin Portal) loads.
- [ ] Create a test tournament → open registration → register a second account → run it → complete →
      Rankings update. Then delete the test if you want a clean public slate.
- [ ] Password reset email arrives (after Step 10).
- [ ] `npx tsx --tsconfig scripts/tsconfig.verify.json scripts/identity-integrity.mts` (run locally
      against the prod DB URL, read-only) reports invariants clean.

---

## Data: fresh start vs. restoring the snapshot

**Recommended — fresh start (clean public launch):** empty Neon DB + first deploy creates the schema +
`/setup` creates the real owner. No test/QA data. The frozen dump stays as an archived backup.

**Alternative — restore the snapshot's data** (keeps the 20 existing accounts + any seasons/tournaments,
which include 8br-derived **test** accounts):

```bash
# after the schema exists (post first deploy), into the SAME Neon DB — or a fresh one:
pg_restore --no-owner --no-privileges --data-only \
  -d "<DIRECT_URL>" backups/wcc-frozen-local-2026-08-15.dump
```

Only do this if you specifically want that data live. For a public launch under a new brand, prefer
fresh. (Restoring also brings over test accounts whose passwords you don't control — you'd reset them.)

---

## Ongoing: deploying changes

`git push` to `main` → Vercel auto-builds → migrations auto-apply → live. New DB changes go in as
Prisma/Payload migrations so `deploy-migrate.mjs` applies them on deploy.

## Accounts checklist (all under cueversewcc@gmail.com, none shared with 8br)

- [ ] Google (cueversewcc@gmail.com) • [ ] GitHub • [ ] Vercel • [ ] Neon Postgres • [ ] Resend
- [ ] Domain DNS for cueverse.net repointed to Vercel • [ ] Vercel Blob store
