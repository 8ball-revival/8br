# Site Builder — Scheduled Publication

How a page publishes itself at a time nobody is awake for, what runs it, and what to do when it
does not.

---

## The short version

| | |
| --- | --- |
| **What runs it** | `GET/POST /api/cron/site-builder-schedule`, every 5 minutes, declared in `vercel.json` |
| **Secret** | `SITE_BUILDER_CRON_SECRET` — required; with it unset the endpoint returns 404 to everybody |
| **If the cron stops** | Any page render activates anything overdue before serving. Late, never lost. |
| **By hand** | **Admin → Site Builder → Schedule → Run the schedule now** |
| **Where to look** | The same Schedule tab: scheduled, overdue, published, failed, cancelled |

---

## How it works

There is **one** service, `runDueSchedules` in `src/lib/site-builder/scheduler.ts`. The cron endpoint
calls it, the request-time fallback calls it, the Run-now button calls it, and the verification suite
calls it. Nothing else publishes a scheduled revision. A scheduler with two implementations is a
scheduler where one of them is subtly wrong and nobody finds out until the wrong one runs at three in
the morning.

### A schedule is frozen when it is set, not when it fires

Scheduling a page copies the **current draft** into a new `SCHEDULED` revision immediately. Editing
the draft afterwards does not change what is going to publish — that is deliberate, and it is what
lets somebody schedule Tuesday's announcement on Monday and carry on working on the page.

Rescheduling moves the time and leaves the frozen document alone. Cancelling archives it.

### What the sweep does

1. Ask the database which revisions are `SCHEDULED` with a `scheduledFor` at or before now. **The
   caller never says which revision** — an endpoint that publishes what it is told to would have to
   be trusted rather than merely authenticated.
2. For each one, in its **own transaction**:
   - claim the row with `SELECT … FOR UPDATE SKIP LOCKED`;
   - re-read its state under that lock, and re-check the time;
   - **validate the document again** — it may have been frozen a week ago, and the module registry
     travels with the code, so a deploy between then and now can invalidate it;
   - point the page at it, stamp `activatedAt`, and write the audit entry — all inside the same
     transaction.
3. Then, separately, revert any page whose published revision has an `expiresAt` in the past.
4. Only once every transaction has committed, invalidate the caches.

### The guarantees, and what provides them

| Guarantee | How |
| --- | --- |
| Two overlapping runs never double-publish | `FOR UPDATE SKIP LOCKED` plus a state re-read inside the lock |
| …and never write two audit entries | The audit write is in the same transaction as the state change |
| One bad revision does not block the others | One transaction per revision, errors caught per revision |
| A failed activation does not disturb the live page | The pointer move is inside the transaction that threw |
| Running it twice changes nothing the second time | Activation clears `scheduledFor` and moves the state off `SCHEDULED` |
| Future schedules are untouched | `scheduledFor <= now`, and the time is re-checked under the lock |

### A trap worth knowing about

`scheduledFor` is `timestamp(3)` — **naive**, no zone, which is what Prisma writes for a `DateTime`.
A JavaScript `Date` bound into a **raw** query arrives as `timestamptz`. Comparing the two makes
Postgres read the stored value in the *session* zone, so on a server set to `America/Phoenix` a
revision stored as 12:10 was compared as 19:10 UTC and was never due.

The scheduler therefore does the time comparison in TypeScript, on values Prisma parsed, and uses raw
SQL only to take the row lock. If you extend this, keep timestamps out of raw predicates.

---

## Production configuration

### 1. The secret

Generate a long random value and set it in the deployment environment:

```bash
openssl rand -base64 48
```

| Variable | Where | Why |
| --- | --- | --- |
| `SITE_BUILDER_CRON_SECRET` | Server environment only | Required. Unset ⇒ the endpoint 404s for everybody. |

It is read inside the route handler from `process.env`. There is no `NEXT_PUBLIC_` prefix, nothing
imports the route from a client component, and the value never appears in a response, a log line or
an error — so it cannot reach a client bundle.

### 2. The schedule

Already declared in `vercel.json`:

```json
{ "path": "/api/cron/site-builder-schedule", "schedule": "*/5 * * * *" }
```

Five minutes is a deliberate choice. Scheduled changes here are announcements and layout switches,
not market data; five minutes of lateness is invisible, and a tighter cadence would multiply the
invocations without making anything meaningfully more punctual. The Schedule tab shows both the due
time and the actual publication time, so lateness is always visible rather than assumed.

### 3. Vercel Cron and the bearer token

Vercel Cron authenticates with the **project-level `CRON_SECRET`**, sent as `Authorization: Bearer`.
It cannot send a custom header. So:

- **Using Vercel Cron:** set `CRON_SECRET` and `SITE_BUILDER_CRON_SECRET` to the same value.
- **Using anything else** (a GitHub Action, a machine with `cron(8)`, an uptime monitor): send the
  dedicated header instead, and the two values can differ:

  ```bash
  curl -fsS -X POST https://8br.gg/api/cron/site-builder-schedule \
    -H "x-site-builder-cron-secret: $SITE_BUILDER_CRON_SECRET"
  ```

Keeping a **separate variable name** is worth the small awkwardness: this job can be rotated or
switched off on its own — unset it and the endpoint closes — without touching the CueVerse refresh
that shares the platform's cron.

### 4. Nothing else is required

No queue, no worker, no extra service. If the cron is never configured at all, scheduled publication
still works through the fallback below; it is simply less punctual.

---

## The request-time fallback

Before serving a published layout, the site activates anything overdue.

It is cheap by construction. After each sweep the service records **when the next revision is
actually due** and does no database work at all until that moment arrives — a site with nothing
scheduled pays one query per server process, ever. Concurrent requests on a cold process coalesce
into a single sweep. It never throws: a scheduler fault degrades to "the schedule is late", never to
a page that will not render.

It is a **safety net, not the mechanism**. Without a cron, a page that nobody visits does not
publish, and the first visitor after the due time pays for the sweep. Configure the cron.

---

## Manual recovery

### Something is overdue and has not published

1. **Admin → Site Builder → Schedule**.
2. Check the state. `Overdue` means the sweep has not reached it; `Failed` means it tried and could
   not, and the reason is on the row.
3. Press **Run the schedule now**. It runs the same service the cron runs, and reports what it did.

If Run-now publishes it, the cron is not reaching the endpoint. Check, in this order: the
`SITE_BUILDER_CRON_SECRET` variable exists in the deployed environment; `CRON_SECRET` matches it if
you are using Vercel Cron; the cron appears in the project's Cron Jobs list; its recent invocations
returned 200 rather than 404. **A 404 means the secret did not match** — that is the designed
response to an unauthorised caller, and it looks identical to a missing route.

### Something says Failed

The row carries the validator's reason. The page kept whatever it was already publishing, so the
public site is not affected and there is no hurry.

Open the page in Edit Mode, fix the setting the message names, and publish — either now, or on a new
schedule. A `FAILED` revision is history: it is never retried, because the thing that made it invalid
will still be true five minutes later.

### Running it from a shell

```bash
curl -fsS -X POST https://8br.gg/api/cron/site-builder-schedule \
  -H "x-site-builder-cron-secret: $SITE_BUILDER_CRON_SECRET" | jq
```

The response names pages and revision numbers and nothing else — no configuration, no connection
details — because a cron response goes into a platform log with a wider audience than the audit
trail.

### Turning scheduled publication off

Unset `SITE_BUILDER_CRON_SECRET`. The endpoint closes. Pending schedules will still activate through
the request-time fallback; to stop those too, cancel them in the Schedule tab. Nothing else in the
builder is affected — ordinary publishing does not go through the scheduler.

---

## What is written down

Every activation, failure, cancellation, reschedule and manual sweep writes to `comp_audit_log`:

| Action | Written when |
| --- | --- |
| `site_builder.schedule` | A publication is scheduled |
| `site_builder.reschedule` | Its time is moved |
| `site_builder.cancel_schedule` | It is called off |
| `site_builder.schedule_activated` | It publishes — actor `scheduler` |
| `site_builder.schedule_failed` | It could not, with the reason |
| `site_builder.schedule_expired` | A revision reverted at its expiry |
| `site_builder.run_schedules` | Somebody pressed Run now, with what it did |

---

## Verifying

```bash
scripts/db/make-test-clone.sh 8br_test_sched
DATABASE_URL=<clone> npm run test:site-builder:scheduler
```

64 checks against a disposable clone, covering the exact activation instant and the millisecond
before it, several revisions due at once, a future revision left alone, a global page, a cancelled
schedule, an invalid revision failing without disturbing the valid one beside it in the same sweep,
repeated invocation, six concurrent sweeps racing for one revision, expiry and reversion, and the
fallback's guard including an eight-caller burst.

The endpoint's authorisation and the cache invalidation are covered by the integration suite, which
needs the running server:

```bash
npm run dev:replica
npm run test:site-builder:integration
```
