# Site Builder — Recovery

What to do when a published layout is wrong, and why the public site cannot be taken down by one.

---

## The short version

| Symptom | Fix | Where |
| --- | --- | --- |
| A page looks wrong after publishing | Restore the previous revision | Admin → Site Builder → 🕘 |
| A module was deleted by mistake | Trash | Admin → Site Builder → Trash |
| A page needs to go back to its original design | Reset | Admin → Site Builder → ↺ on that page |
| The navigation is broken | `/staff/site-builder` still works — edit it there | Direct URL, or the account menu |
| The theme is unreadable | The admin area does not use it — edit it back | Admin → Site Builder → Theme |
| Something is wrong and you cannot tell what | Health | Admin → Site Builder → Health |
| The builder itself is the problem | Disable it — see below | Code, one line |

**Nothing recovers by deleting.** Restoring publishes the old version as a *new* revision, so the
version you restored from is still there and the restore itself can be undone.

---

## The automatic fallback chain

Every public page render tries, in order:

1. **The current published revision** — if it validates against the module registry.
2. **The most recent earlier revision that validates** — one at a time, back through history.
3. **The factory layout defined in code** (`src/lib/site-builder/factory.ts`).

Step 2 matters more than it looks. A page whose newest revision is broken has almost certainly been
fine for its whole history; dropping straight to the factory layout would discard every edit ever
made rather than the one that broke it.

Each fallback is written to the server log with the page key and the reason, and appears on the
Health page. A site quietly serving a layout from three revisions ago otherwise looks exactly like a
site working correctly.

**A single bad module never costs more than that module.** An unknown type, a config that fails
validation, or a component that throws is caught individually: the rest of the page renders, an
editing administrator sees a warning, and a visitor sees the module with the failing settings at
their defaults.

---

## Restoring a revision

1. **Admin → Site Builder**
2. Find the page, press the **🕘** history button.
3. Every revision is listed with its number, when it was published, by whom, and the note written at
   the time. The live one is marked.
4. **Restore** on any of them.

It loads that revision as the draft and publishes it immediately as a new revision. History stays
append-only, so it is always unambiguous which layout was live when.

---

## The trash

Deleted modules and sections go to the trash and stay for 30 days.

Deletion writes to the trash *before* removing anything, so a failed trash write cancels the
deletion rather than losing the module. **Delete for good** in the Trash tab is the only permanent
removal, and it asks first.

---

## Reset to the original layout

**Reset** (the ↺ button on a page) replaces the draft with the layout defined in code — for the
homepage, exactly the five rows the site shipped with.

It creates a **draft**. Nothing changes for visitors until you publish it, so you can look at the
result first.

---

## Getting back in when the navigation is broken

`/staff/site-builder` is a code-defined route. It does not appear in the editable navigation and
cannot be removed by publishing anything, precisely so that the way back never depends on the thing
being recovered.

Two more routes back, for the same reason:

- **Admin** and **Site Builder** are appended to your **account menu** and to the **mobile menu**
  after whatever the published navigation says. Publishing a navigation with neither link in it
  hides them from everybody else and never from you.
- The **admin interface does not use the published theme.** A theme that makes the public site
  unreadable leaves the editor, the control centre and the admin area exactly as they were, so it
  can always be edited back.

The builder also cannot disable authentication, remove a capability check, or grant itself
permissions. Those live in `src/lib/auth/roles.ts` and `src/lib/competition/staff-auth.ts` and are
only changeable in code.

---

## Turning the builder off entirely

If the builder itself needs to be taken out of the picture, revoke the capability:

```ts
// src/lib/auth/roles.ts
manage_site_builder: () => false,
```

Edit Mode disappears, `/staff/site-builder` returns 403, and every builder server action refuses.
**Published pages keep rendering** — they are ordinary server-rendered layouts and do not need the
editor.

To also stop pages rendering from the database and go back to code-defined layouts, change
`BuilderPage` in `src/components/site-builder/edit-mode.tsx` to render `factoryDocument(pageKey)`
instead of the published layout. No data is lost either way.

---

## Restoring the database

Site-builder data lives entirely in tables prefixed `site_`. Nothing else is touched, so these can be
cleared without affecting competitions, ratings, accounts or articles:

```sql
-- Wipes every layout, revision, template and trashed item. Competition data is untouched.
TRUNCATE site_page_revision, site_page_draft, site_trash_item,
         site_reusable_module, site_template, site_theme_profile, site_builder_pref,
         site_page RESTART IDENTITY CASCADE;
```

Then re-run the bootstrap to capture the site as it stands in code:

```bash
npm run site-builder:bootstrap
```

The bootstrap is idempotent and only creates pages that do not already exist, so it is safe to run at
any time.

---

## Health checks

**Admin → Site Builder → Health** re-validates every published layout against the current module
registry *on every load*, rather than trusting a stored flag. That matters because a page can become
invalid without anybody editing it — a module renamed, a field's range tightened, a module removed.

It reports:

- pages that do not validate and are therefore falling back,
- pages referencing module types this build does not have,
- pages with unpublished drafts,
- the module registry inventory.

---

## Verifying after a recovery

```bash
npm run test:site-builder                            # 537 checks, no database, no server
```

```bash
scripts/db/make-test-clone.sh 8br_test_sched
DATABASE_URL=<clone> npm run test:site-builder:scheduler # 64 checks, disposable clone only
```

```bash
scripts/db/make-test-clone.sh 8br_test_sb
DATABASE_URL=<clone> npm run test:site-builder:db       # 113 checks, disposable clone only
```

```bash
scripts/db/make-test-clone.sh 8br_test_sec
DATABASE_URL=<clone> npm run test:site-builder:security  # 108 checks, disposable clone only
```

Both database suites refuse to run against anything but a database named `8br_test_*`, checked
before Prisma is even imported. There is no override.

With the dev server running (`npm run dev:replica`):

```bash
npm run test:dev-hydration     # 36 checks: the editor actually mounts and responds
npm run test:responsive    # 99 checks: nine widths, published and in Edit Mode
npm run capture:site-builder -- --i-accept-local-writes   # 39 checks + the proof screenshots
```

And the integration suite, which needs nothing running because it starts its own server against
its own disposable clone:

```bash
npm run test:site-builder:integration   # 53 checks: the real navigation read path, cache
                                        # invalidation, rollback, and the cron endpoint's auth
```

Both drive a headless Chrome on a **clean profile**. That matters: an everyday browser running a
theming extension will report layout and colour problems the site does not have.
