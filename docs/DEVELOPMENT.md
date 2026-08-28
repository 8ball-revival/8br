# Development and staging

## The rule that outranks everything else

**The database serving 8br.gg is the sole authority for all real data.**

It is never replaced, restored over, merged into, synchronised, seeded, rebuilt, or imported into.
Not to fix something, not to try something, not "just this once". That covers accounts and Players,
aliases and identity links, Seasons and everything under them, Tournaments, The Break, achievements,
ratings, audit logs and site settings.

**Local and staging data is never promoted into production.** Development data is invented. It looks
like the real thing on purpose, which is exactly why moving it upward would be so hard to notice and
so impossible to undo. Data flows one way only: production is written by the live application, and
by nothing else.

The archive and reconstruction tooling is retired. It is kept in the repository because it records
how the archive was built, but every entry point refuses to run.

---

## Getting started

```bash
cp .env.example .env      # then set the local database password
npm install
npm run dev:reset         # build the development database from fixtures
npm run dev               # http://localhost:3000
```

`npm run dev:reset` drops the schemas, reapplies them, and writes the fixture world. It is safe to
run whenever, and running it twice produces exactly what running it once did.

| Command | What it does |
| --- | --- |
| `npm run dev:reset` | Rebuild the development database from scratch |
| `npm run dev:seed` | Reseed only, leaving the schema alone |
| `npm run verify` | The development suite — clones, runs, drops the clone |
| `npm run audit:production` | Read-only audit of the live record (manual, refuses by default) |
| `npm run db:migrate:production` | The **only** sanctioned way to change production's schema |

## Tests come in three kinds

Mixing them was the mistake this separates: a suite that asserted both behaviour and history could
not run without a copy of production, which is how "verify the app works" came to require the live
database.

| Kind | Where | Runs against | In `npm run verify`? |
| --- | --- | --- | --- |
| **Behaviour** — does the application work? | `scripts/verify-*.mts` | A disposable clone of the fixtures | Yes. All must pass. |
| **Record** — is the history intact? | `scripts/audit/` | Production, read-only | No. Run deliberately. |
| **Legacy archive** — the retired import pipeline | `scripts/legacy-archive-audits/` | The archive, wherever it exists | No. See its README. |

### `npm run verify` owns its database

It clones `8br_dev_fixtures`, runs everything against the clone, starts and stops its own server,
and drops the clone. It refuses any target that is not the local fixtures.

This is not convenience. Most of these suites write, and running one straight at `.env` during this
work emptied the fixture rating ledger — after which the failures looked like broken code rather
than a damaged database. Use `--keep` to leave the clone in place when investigating a failure.

### Production audits

```bash
PRODUCTION_AUDIT_URL="postgresql://..." npm run audit:production -- --confirm
```

It refuses without both the connection and `--confirm`, refuses anything that is not production, and
opens a session PostgreSQL marks READ ONLY — a write is rejected by the database, not by the audit
remembering to only read. The connection is never stored: not in `.env`, not in `.env.example`, not
in the repository.

### Development accounts

All five use the password `DevPassw0rd!`. Every address is on `example.test`, a reserved TLD that
cannot resolve or receive mail.

| Account | Role | For testing |
| --- | --- | --- |
| `owner@example.test` | Owner | Everything, including owner-only controls |
| `admin@example.test` | Admin | Staff pages, competition management |
| `author@example.test` | Trusted author | Publishing on The Break |
| `member@example.test` | Member | Registration, profile, commenting |
| `member2@example.test` | Member | A second member, for interactions between two people |
| `ops@example.test` | Admin, management-only | Excluded from Member Management by design |

Signed out is the sixth case and needs no account — it is the one people forget to check.

### What the fixtures cover

Deliberately including the states that are easy to skip: a season with nothing in it, a season
mid-group with fixtures still unplayed, a private season that must 404 when signed out, forfeits,
draws, no-contests, a bye in a bracket, a post with no comments, a category with no posts, names long
enough to wrap, punctuation, and emoji.

Everything is deterministic. There is no `Math.random` and no `new Date()` in the fixtures, so two
resets produce identical databases and yesterday's screenshot still matches today's page.

---

## Branches and environments

| | Branch | Database | Data |
| --- | --- | --- | --- |
| Production | `main` | `eightballregistry_local_20260827` (Neon, `ep-spring-sun`) | Real. Authoritative. |
| Preview | any other branch | `8br_staging_fixtures` (Neon, `ep-odd-frost`) | Dummy only |
| Local | `development` | `8br_dev_fixtures` (localhost) | Dummy only |

Production and staging are on **different Neon compute endpoints**, not merely different databases.

Refresh staging from the local fixtures with:

```bash
STAGING_DATABASE_URL=... node scripts/db/sync-staging.mjs
```

It copies the local fixture database. It refuses any source that is not the local fixtures, and any
target that is production by name or by endpoint.

### Preview deployments cannot affect anything real

* **Database** — Preview's `DATABASE_URL` points at staging. If it were ever changed to production,
  `assertPreviewIsolation` throws on the first query rather than quietly serving live data on a
  shareable URL.
* **Blob** — Preview has no `BLOB_READ_WRITE_TOKEN`, so uploads fall back to local disk instead of
  reaching the live media store.
* **Email** — Preview has no `RESEND_API_KEY`, so the adapter stays dormant and messages go to the
  console. The fixture addresses are undeliverable anyway.
* **Sessions** — Preview signs with a different `PAYLOAD_SECRET`, so a session minted on a preview
  cannot be presented to production.
* **Cron** — Vercel runs scheduled jobs on production only, and the route is closed without
  `CRON_SECRET`, which Preview does not have.

---

## Deployments do not touch the database

`vercel-build` runs `npm run build`. That is all it does.

It used to run `prisma db push --accept-data-loss` against production on every deploy. `db push`
reconciles the database to `schema.prisma`, so anything the file failed to mention was drift, and
drift got dropped — meaning a copy change carried the authority to delete columns. It came within one
deployment of dropping nine objects, including a generated column and the constraint keeping poll
votes attached to their poll.

### Changing production's schema

Building code and changing a schema are different acts with different risks, so they are different
commands.

```bash
PRODUCTION_DATABASE_URL=... npm run db:migrate:production            # plan only
PRODUCTION_DATABASE_URL=... npm run db:migrate:production -- --apply # back up, then apply
```

It reads `PRODUCTION_DATABASE_URL`, deliberately **not** `DATABASE_URL`, so the variable your app and
your scripts use is never the one pointing at production. In order, it:

1. Prints every statement it would run, and stops there unless `--apply` is given.
2. Refuses anything destructive unless `--allow-destructive` is also given.
3. Backs up production, checks the backup is a plausible size, and records its SHA-256.
4. Applies the migration.
5. Re-compares, and reports whether production now matches the schema.

Rehearse on a disposable clone of production before applying anything that drops or alters a column.

---

## The guards

None of these have an override flag. An escape hatch on a safety check becomes the thing everyone
types.

| Guard | Refuses |
| --- | --- |
| `assertFixtureDatabase` | Writing fixtures anywhere but `8br_dev_fixtures` / `8br_test` on localhost — including inside any deployment |
| `assertLocalDatabase` | Destructive local commands against a non-approved database |
| `assertPreviewIsolation` | A preview deployment configured to reach production |
| `scripts/_retired.mjs` | 33 archive, import, seed, repair, merge and reset scripts |
| `scripts/db/sync-staging.mjs` | A non-fixture source, or a production target by name or endpoint |
| `scripts/db/migrate-production.mjs` | Destructive migrations, and applying without a verified backup |

Run `npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-environment-safety.mts`
to exercise every one of them against the thing it is meant to stop.

---

## Preserved recovery data

The former local authority is kept, and is not part of the working environment:

* Database `PRESERVED_recovery_8br_dev_redesign_20260827`, labelled as such in Postgres and named in
  `FORBIDDEN_DATABASES` so a stale `.env` fails loudly.
* Backup `C:/Claude/8BR-backups/PRESERVED-local-authority-8br_dev_redesign-20260827.dump`,
  restore-tested, `sha256 ea8cb390…f5b49`.

It is a read-only reference for recovery. It is not used for development, and never for deployment.
