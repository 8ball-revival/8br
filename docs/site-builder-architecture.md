# Site Builder — Architecture

> Status: implemented on `feature/visual-site-builder`. Local development only — not deployed.
>
> **Running it.** `npm run dev:replica` (the dev server against the local live-data replica), then
> open <http://localhost:3000>. Use `localhost`, not `127.0.0.1`: Next refuses to serve its dev
> client bootstrap to an origin it does not recognise, and the page then renders but never hydrates
> — no editor, no controls, no error. `allowedDevOrigins` in `next.config.ts` lists the origins that
> are accepted; add one there rather than working around it.

## 1. What this is

An admin-only visual editing system for the public 8 Ball Registry site. An administrator with the
`manage_site_builder` capability turns on **Edit Mode** from the site header and edits the real page
they are looking at — selecting, moving, resizing, replacing, adding and removing modules — then
saves a draft and publishes it atomically.

It exists so that routine changes to the public site (announcements, layout, copy, which ranking a
panel shows, navigation, theme accents) stop requiring a code change and a deploy.

## 2. What it is deliberately *not*

- **Not a second CMS.** It extends the existing Prisma schema, Payload media, the `Capability`
  matrix in `src/lib/auth/roles.ts`, the `comp_audit_log` audit trail, the Tailwind token layer and
  the Display Lab. There is no parallel content store and no second auth system.
- **Not a code editor.** No React, JavaScript, SQL or unsanitised HTML can be entered. Data modules
  are configured through typed, enumerated controls that map onto existing canonical services.
- **Not a data editor.** The builder changes *how* information is presented. It cannot fabricate or
  override a match result, standing, rating, achievement, champion or player record. Every data
  module calls the same canonical service the hard-coded page called before it.

## 3. Discovery — what already existed, and what it means for the design

| Area | What is there | Consequence for the design |
| --- | --- | --- |
| Validation | **No `zod`.** Twenty runtime dependencies in total; the project is deliberately lean. | A small in-repo *field-descriptor kernel* rather than a new dependency. It earns its place by doing something a schema library would not: one descriptor yields the TypeScript type, the server-side validator, the default value **and** the inspector control. A schema library gives the first three, and the inspector then becomes a second, drift-prone description of the same fields. |
| Drag and drop | **No library.** Native HTML5 drag-and-drop is already used in `creator/playoff-workspace.tsx`, `tournaments/group-setup-board.tsx` and `editorial/body-editor.tsx`. | Reuse the pattern already in the codebase. No new dependency, and it already coexists with the site's pointer handling. Keyboard reordering is a parallel first-class path, not an afterthought. |
| Capabilities | `Capability` union and `CAPABILITY_RULES` in `lib/auth/roles.ts`; `requireCapability()` in `competition/staff-auth.ts`. | Add exactly one capability. Every builder server action calls `requireCapability('manage_site_builder')`. No new authorization concept. |
| Audit | `recordAudit(actor, entry, tx?)` writing `comp_audit_log`, transaction-aware. | Publish, rollback, schedule, delete, restore, theme and navigation changes all record through it, inside the same transaction as the mutation. |
| Theme | Display Lab: `DOM_SPEC` / `DISPLAY_DEFAULTS`, `data-dl-*` attributes and `--dl-*` variables applied by a pre-paint inline script from `localStorage`. **Per visitor.** | Site theme profiles are a *server-rendered* layer underneath it. The site publishes tokens; Display Lab remains the visitor's personal override on top. The two do not fight because they occupy different levels of the cascade. |
| Media | Payload `Media` collection plus `lib/media/{service,validate}.ts`. | Image and background pickers use the existing collection and validators. No new upload path. |
| Layout frame | `Wide` / `SITE_FRAME` in `components/primitives.tsx` (`max-w-[96rem]`, responsive gutters), marked with `data-site-container`. | The section engine emits `Wide` for contained sections rather than inventing a width, so alignment with the header and footer is preserved by construction. |
| Homepage | Five `Wide` rows; grids at `58/42`, full, `55/45`, full, full. | Maps one-to-one onto sections with column ratios. The bootstrap reproduces it exactly rather than approximating it. |
| Tests | No vitest, jest or playwright. Verification is `tsx` scripts under `scripts/`, run through npm scripts. | The builder suite follows the same convention: `scripts/verify-site-builder.mts`, runnable and greppable like its neighbours. |

## 4. Data model

New tables, all prefixed `site_`. No existing table is altered.

```
SitePage            one editable route, one dynamic template, or one GLOBAL
  ├── SitePageDraft      exactly one mutable working copy per page (autosaved)
  └── SitePageRevision   immutable published snapshots; the newest published one wins
SiteReusableModule  a module saved for reuse; instances stay synced or are detached
SiteTemplate        saved page and section layouts
SiteThemeProfile    published token sets (one active)
SiteTrashItem       soft-deleted modules, sections and pages
SiteBuilderPref     per-user editor preferences
```

**Why the layout is JSON.** A fully normalised module tree needs a row per module, a row per style
override, a row per breakpoint override, and a recursive query to render one page. The document is
read as a unit, written as a unit and versioned as a unit, so it is stored as a unit. The safety
normalisation would have bought is bought instead by **validating every document server-side against
the module registry before it is written** — on autosave, on manual save, and again at publish. An
invalid document cannot reach the database.

**Navigation, footer and theme are pages.** They are `SitePage` rows of kind `GLOBAL`, holding one
module each. That is the whole reason they get drafts, revision history, rollback and audit for
nothing — the alternative was a settings table with its own save endpoint, which would have meant a
second, weaker approval path for the one change that affects every page on the site.

Adding the kind was one additive migration (`ALTER TYPE "SitePageKind" ADD VALUE 'GLOBAL'`).

**Scheduling freezes at schedule time, not at publish time.** A scheduled revision is built and
validated when it is scheduled, so a later edit to the draft cannot silently change what was
scheduled, and activation is a pointer move rather than an unattended build-and-validate.

**Optimistic concurrency.** `SitePageDraft.version` increments on every write. A save carries the
version it was based on; a mismatch is rejected as a conflict the editor surfaces, so two tabs
cannot silently overwrite one another.

**Publishing is atomic.** One transaction: validate, freeze the draft into a new immutable
`SitePageRevision`, point the page at it, write the audit entry. Then revalidate the affected paths.
Any failure rolls the whole thing back and the live site is untouched.

## 5. The document

```ts
LayoutDocument {
  version: number                  // document schema version, for migrations
  sections: Section[]
}
Section {
  id, name, width: 'full' | 'wide' | 'narrow',
  columns: ColumnSpec,             // ratios per breakpoint
  style: StyleOverrides,
  visibility: VisibilityRule,
  modules: ModuleInstance[]
}
ModuleInstance {
  id,
  type: string,                    // registry key
  configVersion: number,           // the version this config was written for
  config: Record<string, unknown>, // validated against the module's field schema
  layout: ResponsiveLayout,        // span / order / visibility per breakpoint
  style: StyleOverrides,
  visibility: VisibilityRule,
  reusableId?: string              // set when synced to a SiteReusableModule
}
```

`ModuleInstance` also carries optional `children`, for **container** modules — a stack, a grid, a
split, a set of tabs. A container declares itself in the registry rather than being recognised by
name, and renders its children through a `Slot` render prop.

Nesting is capped at four during validation. Nothing this site needs goes deeper than a grid inside a
split inside a section, and an uncapped tree is a stack overflow waiting for an imported document to
find it. `findModule` returns a **path** (siblings, ancestors, parent) rather than an index, because
"the third module" stops being a location once a module can be inside another.

Breakpoints are `desktop` (12 columns), `tablet` (8) and `mobile` (4). Tablet and mobile **inherit**
from desktop until explicitly overridden, and an override can be cleared back to inherited.

## 6. Module registry

Every module is one `ModuleDefinition`:

```ts
{
  type, name, category, icon, description,
  configVersion,
  fields,                 // field descriptors: type + validation + default + inspector control
  layoutDefaults,
  dataSource?,            // enumerated, safe query options
  upgrade(oldConfig, fromVersion),
  Render,                 // the ONE renderer, used by public and editor alike
  a11y                    // required labelling contract
}
```

The editor and the public site call the same `Render`. There is no separate preview implementation,
so a preview cannot disagree with what publishes.

**System modules make the whole site editable.** Each page's real content — the rankings table, the
tournament list, an article body, a player profile — was extracted verbatim into a component under
`src/components/system/` and wrapped in a registered module marked `essential`. The page body is
therefore a module like any other: it can be moved, resized, placed in a column and surrounded by
other modules, and the code that renders it is the same code that rendered it before.

`essential` costs nothing except a typed confirmation before deletion. That guard exists because
deleting the rankings table from `/rankings` leaves a page with a heading and nothing else, and the
person doing it almost certainly meant to delete something adjacent.

**Unknown or invalid modules never break a page.** `renderModuleSafe` handles three failures:
an unknown `type` renders an admin-visible warning and nothing for the public; a config that fails
validation renders the module's own fallback; a throw during render is logged server-side and the
fallback is rendered. A page whose entire published document fails validation falls back to the last
valid revision, and failing that to the code-defined factory layout.

## 7. Security

- `manage_site_builder` is granted to **Owner only** by default. It can alter every public page and
  the navigation, a wider blast radius than `manage_competitions`. Widening it later is a one-line
  change in `CAPABILITY_RULES`; narrowing it after the fact is not.
- Every read and write server action calls `requireCapability`. The client Edit Mode toggle is a
  convenience, never an authorization.
- Public visitors receive the published document only — no editor code, no draft data, no builder
  JavaScript. The editor is a dynamic import behind a server-side capability check.
- URLs are validated (internal path, or an allowlisted scheme); embeds are restricted to an
  allowlist of providers; rich text is sanitised to a fixed tag and attribute set.
- The builder cannot disable authentication, remove capability checks, or hide
  `/staff/site-builder`, which is reachable independently of editable navigation. **Admin** and
  **Site Builder** are rendered into the account menu and the mobile menu after the published
  navigation, so no publish can remove them.
- Nothing a document contains is authority. A revision records the session actor, never a username
  the document claims; a visibility rule can only hide a module, never reveal one to somebody the
  server did not already consider entitled to it; and publishing a navigation that links into
  `/staff` grants nobody anything, because the route gate does not read the document.

### The suites

| Suite | Checks | Needs |
| --- | --- | --- |
| `npm run test:site-builder` | 537 | nothing |
| `npm run test:site-builder:db` | 113 | a disposable `8br_test_*` clone |
| `npm run test:site-builder:security` | 108 | a disposable `8br_test_*` clone |
| `npm run test:dev-hydration` | 36 | the dev server |
| `npm run capture:site-builder` | 29 | the dev server (also writes the proof screenshots) |
| `npm run test:responsive` | 99 | the dev server |

The two database suites assert the target database matches `8br_test_*` **before Prisma is
imported**, because importing it opens a connection. There is no override.

## 8. Performance

Public pages render server-first from a cached, validated published document. Publishing revalidates
only the affected paths. Data modules reuse the existing cached canonical services, so the builder
adds no new query load, and a page's modules resolve in one batched pass rather than a per-module
waterfall.
