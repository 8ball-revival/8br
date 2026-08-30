# Site Builder — production rollout plan

**Not executed.** This is the plan for deploying the site builder onto the live 8br.gg database. Read
it through before starting; nothing here has been run.

---

## The one assumption that shapes everything

**Production may have legitimate activity that the local copy does not.** The local database is a copy
taken on 2026‑08‑29; since then somebody may have published an article, registered for a Season, or
had a rating recalculated. So this rollout **never overwrites production with a dump**. It applies
two additive migrations and runs an idempotent bootstrap, and both leave every existing row alone.

If at any point the plan seems to call for restoring the local database over production, stop — that
is not this plan.

---

## What is actually being deployed

| | |
| --- | --- |
| **Migrations** | 3 files, all additive: `20260830120000_site_page_kind_global`, `20260830140000_site_revision_state_failed`, `20260830140100_site_scheduler_and_template_revisions` |
| **New tables** | 9, all prefixed `site_` |
| **Altered existing tables** | None outside `site_*` |
| **Destructive statements** | None. No DROP, DELETE, TRUNCATE, RENAME, type change or NOT NULL added |
| **New environment variables** | `SITE_BUILDER_CRON_SECRET` (required for scheduling) |
| **New cron** | `/api/cron/site-builder-schedule`, once daily at 09:00 UTC, already in `vercel.json` |
| **Data written on first run** | The bootstrap: 14 `site_page` rows, one draft and one revision each |

Verify the additivity claim yourself before deploying:

```bash
git diff --name-only eb83f3e..HEAD -- prisma/migrations
grep -rniE "DROP |DELETE |TRUNCATE |RENAME |SET NOT NULL" prisma/migrations/2026083*/migration.sql
```

The second prints only `ON DELETE SET NULL` / `ON DELETE CASCADE` clauses inside `ADD CONSTRAINT`,
which are foreign-key behaviours on new tables, not statements.

---

## Before you start

1. **Back up production**, and verify the backup restores. Not a Neon branch alone — a dump you hold.
2. **Fingerprint production** so the deploy can be proved additive afterwards:
   ```bash
   scripts/db/fingerprint.sh "<production connection string>" > prod-before.txt
   ```
3. **Check the migration state matches**: `npx prisma migrate status` against production should show
   the 51 migrations that precede this work applied, and exactly the three above pending.
4. **Pick a quiet moment.** Nothing here takes the site down, but the bootstrap changes what renders
   the homepage, and you want to be looking at it when it does.

---

## The rollout

### 1. Set the secrets first, deploy second

In the Vercel project, add:

| Variable | Value |
| --- | --- |
| `SITE_BUILDER_CRON_SECRET` | `openssl rand -base64 48` |
| `CRON_SECRET` | The **same value**, if you want Vercel Cron to drive it — see `site-builder-scheduling.md` |

Do **not** set `SITE_BUILDER_E2E_SECRET` or `SITE_BUILDER_E2E_EMAIL`. They are development-only, and
the route they enable refuses to run when `NODE_ENV=production` regardless.

Setting these before the deploy means the cron works from the first minute rather than 404ing until
somebody notices.

### 2. Deploy

`npm run vercel-build` runs `scripts/deploy-migrate.mjs` and then the build, so the migrations apply
as part of the deploy. Nothing extra to run.

Watch for: the Payload migrate prompt stalling the build (known, 5–25 minutes, defaults to N, and
harmless — it is in `docs/8br-deploy-gotchas.md`).

### 3. Verify the migration, before touching anything

```sql
SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3;
SELECT count(*) FROM site_page;                    -- 0. Nothing is bootstrapped yet.
SELECT unnest(enum_range(NULL::"SitePageKind"));   -- includes GLOBAL
SELECT unnest(enum_range(NULL::"SiteRevisionState")); -- includes FAILED
```

**At this point the site is unchanged.** The tables exist and are empty; every page still renders
from the code-defined layout, because that is the last step of the fallback chain. If anything above
is wrong, stop here — nothing has to be undone.

Take a fingerprint now and diff it against `prod-before.txt`. The only differences should be
`_prisma_migrations` and the new empty `site_*` tables.

### 4. Bootstrap

Sign in as the Owner, open **Admin → Site Builder**, and press **Capture the current site**.

This reads the layouts defined in code and writes them as the first published revision of each page.
It is idempotent — it creates only pages that do not already exist — so it is safe to press twice.

Then check the site: the homepage should be **pixel-identical** to what it was five minutes earlier.
That is the whole point of bootstrapping from the code layout rather than from anything else. If it
is not identical, see *Rolling back* below.

### 4a. A note on the cron interval

This was written as `*/5 * * * *`, and the Vercel account is on the Hobby plan, which permits **one
cron invocation per day**. The deploy is rejected at validation with that expression -- before any
build runs, so nothing is at risk, but nothing ships either.

It is now `0 9 * * *`, and that is a smaller loss than it sounds. The cron was never the guarantee:
`getPublishedLayout` sweeps for overdue revisions on every public read, precisely because a platform
cron is a promise the platform can quietly stop keeping. The cron only makes a scheduled publication
appear promptly on a page nobody has visited. With a daily cron the worst case is that a scheduled
revision goes live when the next visitor arrives instead of within five minutes.

If the account moves to Pro, `*/5 * * * *` can go back and this paragraph can go with it.

### 5. Verify the scheduler

```bash
curl -fsS -X POST https://8br.gg/api/cron/site-builder-schedule \
  -H "x-site-builder-cron-secret: $SITE_BUILDER_CRON_SECRET"
```

Expect `{"ok":true,"considered":0,...}`. A **404 means the secret did not match** — that is the
designed response to an unauthorised caller and looks identical to a missing route.

Then confirm the platform cron: Vercel → the project → Cron Jobs → `/api/cron/site-builder-schedule`
should be listed and its next invocations should return 200.

### 6. Watch for a day

- **Admin → Site Builder → Health** re-validates every published layout on load. It should report
  nothing.
- The audit trail: `SELECT action, count(*) FROM comp_audit_log WHERE action LIKE 'site_builder%'
  GROUP BY 1;`
- Server logs for `[site-builder]` — a fallback to an earlier revision, or a failed schedule sweep,
  logs there.

---

## Rolling back

Three levels, smallest first. Reach for the smallest that solves the problem.

### A page looks wrong

**Admin → Site Builder → 🕘 → Restore.** Nothing is deleted; the restore publishes as a new revision.
This is the ordinary case and needs no deploy.

### The builder is the problem, the tables are fine

Revoke the capability — one line in `src/lib/auth/roles.ts`:

```ts
manage_site_builder: () => false,
```

Edit Mode disappears, `/staff/site-builder` returns 403, every builder action refuses. **Published
pages keep rendering**: they are ordinary server-rendered layouts and do not need the editor.

### Go back to code-defined layouts entirely

Change `BuilderPage` in `src/components/site-builder/edit-mode.tsx` to render `factoryDocument(pageKey)`
instead of the published layout, and deploy. Every page renders exactly as it did before any of this
existed. **No data is lost** — the `site_*` tables are simply not read.

### Remove the tables

Only if you are abandoning the feature. The tables are additive, so dropping them affects nothing
else — but there is no reason to hurry, and an empty unused table costs nothing.

```sql
-- Everything the builder owns. Competition data is untouched.
DROP TABLE IF EXISTS site_template_revision, site_page_revision, site_page_draft, site_trash_item,
  site_reusable_module, site_template, site_theme_profile, site_builder_pref, site_page CASCADE;
```

> The enum values `GLOBAL` and `FAILED` cannot be removed from a PostgreSQL enum. They are unused
> once the tables are gone and cost nothing. Do not attempt to recreate the type.

---

## What this rollout does not do

- It does not overwrite production with a local dump. Production may have activity the copy does not.
- It does not migrate, transform or backfill any existing row.
- It does not change any competition table, any account, any role, or any rating.
- It does not enable the development E2E session route, which refuses under `NODE_ENV=production`.

---

## Risks, and what carries them

| Risk | Likelihood | What limits it |
| --- | --- | --- |
| Bootstrap captures a layout that differs from what production renders | Low | Bootstrap reads the same code that renders today; the homepage is compared immediately after |
| A published layout fails validation later | Low | The fallback chain serves the last valid revision, then the code layout; Health reports it |
| The cron does not fire | Medium | The request-time fallback activates overdue schedules anyway; the Schedule tab shows *Overdue* |
| The cron secret leaks | Low | It only triggers a sweep; it cannot choose what publishes, and rotating it is one variable |
| Two deploys race the migration | Low | Prisma's advisory lock; `migrate deploy` is idempotent |
| Production has a migration the local copy does not | Medium | Checked in step 3 before anything is bootstrapped |

---

## Afterwards

- Remove `SITE_BUILDER_E2E_SECRET` / `SITE_BUILDER_E2E_EMAIL` from any environment that is not a
  developer's machine. They should never have been set in production, and this is the check for it.
- Keep the local copy's `.env.replica` as it is; it is gitignored and development-only.
- The first real use is the interesting one: publish something small — a banner, a heading — and
  confirm the revision history, the rollback, and the audit entry all say what you expect.
