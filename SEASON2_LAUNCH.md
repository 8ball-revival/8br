# EGO — Season 2 Launch (Public Site + Accounts)

This phase turns the public site into the home of **EGO Season 2**: registration,
an upcoming group stage, a future playoff bracket, and the completed Season 1
archive. It adds public **accounts** and **Season 2 competition registration** on
top of the existing Payload auth — **no second auth system**.

## Navigation

Primary nav (`src/lib/nav.ts` → `PRIMARY_NAV`): **Home · Groups · Playoffs · Seasons · Rules**,
plus a **Sign In / Account** control in the header (`src/components/site-header.tsx`,
resolved server-side from the session). Historical archive surfaces (Competitions,
Rankings, Players, Hall of Fame, News) moved to `SECONDARY_NAV` and appear only in
the footer under "Archive & Records". Mobile nav mirrors this and appends the
Account/Sign In link.

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Season 2 launch homepage (hero, how-it-works, group/playoff status, Season 1 spotlight, rules) |
| `/groups` | Season 2 group stage — honest "not formed yet" state |
| `/playoffs` | Season 2 playoffs — honest "bracket not set" state |
| `/seasons` | Current (Season 2) vs Completed (Season 1 only) |
| `/seasons/ego-season-1` | Season 1 archive detail (real data, pending states preserved) |
| `/register` | Season 2 competition registration (signed-out → create account/sign in) |
| `/login` | Sign in (User ID or email) |
| `/account` | Private dashboard (User ID, private email, registration status, sign out) |
| `/rules` | Rules & format |

The former sample seasons 2–5 are **not** emitted by `generateStaticParams` in
`seasons/[slug]`, so their fabricated detail pages now return a real 404.

## Accounts (Payload native, no second auth system)

`src/collections/Users.ts` enables Payload's native username login:

```ts
auth: { loginWithUsername: { allowEmailLogin: true, requireEmail: true } }
```

- **User ID** = Payload `username`. Unique, required, used to sign in. Rules
  (`src/lib/account/validation.ts`): 3–24 chars, `[a-z0-9_-]`, trimmed +
  lowercased (safe normalization only). Duplicates rejected by the unique index.
- **Email**: required for recovery/admin, **kept private** (never rendered on
  public pages; collection `read` access is self-or-staff). **Email verification is
  intentionally DISABLED** — no `verify: true`, so accounts are usable immediately.
- **Password**: existing Payload auth (hashed, salted). Min 8 chars validated
  server-side. Never logged or stored in plaintext.
- **Access control** (`src/collections/access.ts`): only staff (admin /
  senior_editor / editor) can list/create/delete users or see the collection in
  admin; members can read/update only their own record. The `roles` field is
  admin-writable only, so a self-service update can't escalate privileges.

Account creation is done via a server action with `overrideAccess: true` (public
REST `create` is staff-only), so the public never hits an over-permissive endpoint.

## Season 2 competition registration (separate from account creation)

Storage: a Payload **`Registrations`** collection (`src/collections/Registrations.ts`)
in the Payload-owned schema — **not** the Prisma archive tables. Fields: `season`
(text slug), `user` (relationship), `status` (`registered`/`withdrawn`),
`registeredAt`.

- **Duplicate entries prevented** by a `beforeChange` hook that rejects a second
  `(season, user)` row.
- Members can read only their own registrations; create requires being signed in;
  update/delete are staff-only.

Flow (`src/lib/account/actions.ts`, all server-validated):
1. Create account (User ID + email + password) → auto sign-in → `/account`.
2. Sign in with User ID **or** email + password.
3. Visit `/register` (or `/account`) → acknowledge rules → confirm entry.
4. Server checks: signed in, registration open, rules acknowledged, not already
   registered → creates the Registrations row.
5. `/account` shows the confirmed status.

Not every account is auto-entered into Season 2 — registration is an explicit,
separate action.

## Season 2 state model (single source of truth)

`src/lib/season2.ts` — `SEASON2` typed state until Prisma is connected:
`registrationStatus` (`not_open`/`open`/`closed`), `registrationOpensAt`,
`registrationClosesAt` (**null — no fabricated deadline**), `groupsStatus`,
`playoffsStatus`, `seasonStatus`, format/eligibility summaries. Helpers:
`isRegistrationOpen()`, `registrationDeadlineLabel()` ("Registration deadline to be
announced" when null), `REGISTRATION_STATUS_LABEL`.

The registered-player **count** is fetched live from the Registrations collection
(`getSeason2RegisteredCount`) — honest zero when none, never fabricated.

## Honesty / no fabricated data

- No invented dates, counts, champions, or announcements anywhere on the launch pages.
- Groups/playoffs show real "pending" empty states.
- Season 1 keeps its pending/unknown/reconstructed states.
- The "sample data" banner (`src/components/preview-notice.tsx`) is now scoped to
  the archive routes only, so it never mislabels a real Season 2 page.

## SEO

Per-page metadata: Home "EGO Season 2 | Elite Gamers Only", Groups "EGO Season 2
Groups", Playoffs "EGO Season 2 Playoffs", Seasons "EGO Seasons", Register
"Register for EGO Season 2". `/account` and `/login` set `robots: { index: false }`.

## Database

Payload owns the `payload` Postgres schema; Prisma owns `public`. This phase added
the `users.username` column and the `registrations` table to the **payload** schema
only (via Payload dev push). **No historical archive import was performed** — the
Prisma archive tables remain empty.

## Validation performed

- `typecheck`, `lint`, `build` all pass.
- Backend E2E (via a temporary in-runtime route, since removed): create account,
  duplicate User ID rejected, User-ID login, wrong-password rejected, register,
  duplicate registration rejected by hook, live count, cleanup — all pass.
- All launch routes return 200; `/seasons/ego-season-2` returns 404; `/account`
  signed-out redirects to `/login`.
- Prisma `public` archive tables verified unchanged and empty (no import).

## Remaining launch blockers / manual content

- Real registration open/close dates (set `registrationOpensAt`/`ClosesAt` in
  `src/lib/season2.ts` when known).
- Final Season 2 rules content and eligibility copy; Discord/community link.
- Official Season 1 results where currently unavailable (still pending verification).
- When Prisma is connected: move `SEASON2` state + group/playoff data to the DB and
  reuse the existing `season/` group/standings/bracket components on `/groups` and
  `/playoffs`.
- Live auth E2E through the actual browser forms should be spot-checked on a running
  instance (the automated backend test above covers the local-API layer).
