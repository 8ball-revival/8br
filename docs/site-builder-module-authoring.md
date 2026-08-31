# Site Builder — Authoring a Module

How to add a module type. The whole job is one `registerModule` call.

---

## The shape

```tsx
// src/components/site-builder/modules/<category>.tsx
registerModule({
  type: 'competitions.registrationStatus',  // stable; renaming needs a migration
  name: 'Registration status',
  category: 'competitions',
  icon: 'ClipboardList',                    // any lucide-react export, by name
  description: 'Whether registration is open, and how to join.',

  configVersion: 1,
  fields: { /* see below */ },

  layoutDefaults: { span: 6 },
  dataDriven: true,                         // marks it LIVE in the palette
  a11y: { landmark: true, headingLevel: 2 },

  Render: async function RegistrationStatus({ config }) { /* … */ } as never,
})
```

Then add the file to `src/components/site-builder/modules/index.ts`. That is all — the module appears
in the palette, the inspector can edit it, the validator accepts it, and **Replace** offers it
against its category-mates.

---

## Fields

A field descriptor produces four things from one definition: the TypeScript type, the server-side
validator, the default value, **and** the inspector control. There is no second place to describe a
field, which is what stops the editor offering a value the server rejects.

| `kind` | Control drawn | Stored as |
| --- | --- | --- |
| `text` | Single line, or a box with `multiline: true` | `string`, angle brackets stripped |
| `richText` | Textarea | `string`, sanitised to an allowlist of tags |
| `number` | Slider plus a numeric box | `number`, clamped to `min`/`max` |
| `boolean` | Checkbox | `boolean` |
| `select` | Dropdown | one of `options` |
| `multiSelect` | Toggle chips | `string[]`, filtered to `options` |
| `color` | Token swatches plus a hex box | a token reference or a hex value |
| `media` | Library picker | media id, or `null` |
| `player` | Search box over the player roster | the canonical player id, or `''` |
| `url` | Text box | a validated URL; `internalOnly: true` restricts it to a path |
| `list` | Repeating group with add, remove and reorder | array of the sub-fieldset |

Every kind also takes `label`, `help`, `group` (an inspector heading) and `showWhen` (hide unless
another field holds one of the listed values).

## Referring to a player

Use `kind: 'player'` for any field that identifies a competitor. Never a `text` field holding an id:
the id is 25 characters of cuid that appears nowhere on the site, so a text box makes "put Derrick in
this record" a database question, and it accepts a typo, a season id or a sentence just as readily.

```ts
holderPlayerId: {
  kind: 'player', label: 'Player', group: 'Who holds it', default: '',
  help: 'Search by name, CueVerse ID or an old handle.',
},
```

The editor searches the current name, the current CueVerse ID, every recorded alias, and identities
that were merged into another account — because the person editing is usually working from an old
bracket or a video title, and the handle they remember is often one the player has since changed. A
merged-away identity resolves to the account that absorbed it and is never offered as itself.

What reaches the browser is public identity only: name, CueVerse ID, past handles, whether the player
is archived. The search is an Owner-gated server action, so it is no more reachable than any other
Site Builder action.

**Validation is in two places, deliberately.** The kernel checks the SHAPE — empty, or a cuid — and
nothing more, because it is pure and because a field that rejected an unknown id would blank the
reference on the next save. Whether the player EXISTS is checked when the draft is saved, and only
for references the save introduces: a page is stored as one document, so failing the whole save over
a player deleted last week would block every unrelated edit on that page, including the one that
would fix it. A reference that has gone stale is flagged in the picker instead.

Fields that store a **CueVerse handle** rather than an id — `rankings.playerSpotlight`,
`home.championHero` — are left as text on purpose. They look up by handle by design, so converting
them would change what is stored and what the render path resolves, which is a data migration rather
than a change of control.

To find an id by hand — for a script, or to identify one already stored:

```bash
npm run player:find -- derrick
```

```ts
fields: {
  platform: {
    kind: 'select', label: 'Platform', default: 'CUEVERSE',
    options: [{ value: 'CUEVERSE', label: 'CueVerse' }, { value: 'YAHOO', label: 'Yahoo archive' }],
  },
  limit: { kind: 'number', label: 'Rows shown', default: 10, min: 1, max: 50 },
  emptyText: {
    kind: 'text', label: 'When there is nothing to show', default: 'Nothing yet.',
    help: 'Shown instead of an empty panel.',
  },
}
```

### What a field may not be

No free-form CSS, no HTML beyond the allowlist, no SQL, no JavaScript, no arbitrary URL. If a module
needs something the kinds above cannot express, add a kind to `fields.ts` — deliberately, with its
validator — rather than widening a `text` field and hoping.

---

## Data modules

A data module stores **which figures to show** and never the figures themselves. Call the canonical
service; do not query, and do not compute.

```tsx
Render: async function LiveRankingsModule({ config }) {
  const board = await getHomeLeaderboard(config.limit)   // the service the hand-written page used
  if (!board.rows.length) {
    return <ModulePlaceholder label="Live Rankings" hint="No rated players yet." />
  }
  return <LiveRankings rows={board.rows.slice(0, config.limit)} platform={board.platform} />
}
```

This is the rule that makes the builder safe: there is no second calculation, so it cannot disagree
with the record. It is also why every data option is an enumerated `select` — configuration is a set
of arguments to an existing function, and there is nowhere for a query to be typed.

The services are individually cached and React dedupes within a render, so two modules asking for the
same leaderboard cost one read.

---

## Rendering

`Render` is used by the public page **and** by the editing canvas. There is no separate preview
implementation, so a preview cannot disagree with what publishes.

- It may be an `async` server component. Most data modules are.
- It receives `{ config, instance, editing, context }`.
- `editing` may be used to soften an interaction that fights the canvas — an auto-advancing carousel,
  say. It must **not** change how the module looks, or the preview stops being the published result.
- Return a placeholder rather than `null` when unconfigured. A silent gap is how a page ends up with
  a hole nobody notices.

Reuse the site's existing components and tokens. A module should look like the rest of 8 Ball
Registry, not like page-builder output.

---

## Changing a module later

Bump `configVersion` and add `upgrade`:

```ts
configVersion: 2,
upgrade(config, fromVersion) {
  if (fromVersion < 2) {
    // `limit` used to be a string.
    return { ...config, limit: Number(config.limit ?? 10) }
  }
  return config
},
```

`upgrade` runs on read, before validation, so an old revision opens as the current schema rather than
as an error. Without it, changing a field breaks every page already using the module — including the
published revisions somebody may need to roll back to.

Renaming a `type` is a data migration, not an edit. Existing documents keep the old string; the
validator preserves the instance rather than dropping it, and it renders as a fallback — recoverable,
and visible.

---

## Containers

A module that holds other modules sets `container: true` and renders a `Slot`:

```tsx
registerModule({
  type: 'layout.split',
  container: true,
  slotLabel: 'Panels',
  Render: function Split({ config, Slot }) {
    return (
      <div className="grid gap-6 md:grid-cols-[58fr_42fr]">
        <Slot />
      </div>
    )
  } as never,
})
```

`Slot` renders `instance.children` through the same safe renderer as everything else, so a child that
throws costs that child and nothing more.

Three things the editor handles for you, and one you must not undo:

- **Depth is capped at four** during validation. Do not add a container that assumes deeper nesting.
- **Duplicating gives every descendant a fresh id.** A document may never contain two modules
  answering to one id — selection, drag targets and the layer tree all resolve by id.
- **A container cannot be dropped into itself.** The drag target list excludes its own subtree.

---

## Essential modules

`essential: true` marks a module as the reason its page exists — the rankings table, an article
body, a tournament bracket. It changes exactly one thing: deleting it asks the administrator to type
its name first.

Use it for a module that carries a page's actual content. Do not use it for a module that is merely
important-looking; a confirmation that appears too often is a confirmation nobody reads.

---

## The client boundary

The registry is populated by importing these files, and they import `next/image`, Payload's media
service and the competition services — all server-only. The **client** therefore cannot import them.

The server serialises the registry (`serialiseRegistry()`) and hands it to the editor as a prop; the
editor calls `hydrateRegistry()` during render. Field descriptors are pure data by design, which is
what makes that possible.

**The consequence when authoring:** everything except `Render` and `upgrade` must be serialisable. Do
not put a function, a component reference or a class instance in a field descriptor or in
`layoutDefaults`. The icon is a *string* naming a lucide export rather than the component itself, for
exactly this reason.

---

## Verifying

```bash
npm run test:site-builder
```

537 checks, no database, no browser, no server — about a second. The suite walks every registered
module and asserts, among other things, that its **default config validates against its own
schema**. That check exists because it once did not: a marquee panel
defaulted `logoHeight` to `0` against a minimum of `48`, and the module rendered as a fallback on the
homepage until the suite was written and caught it.

Add module-specific assertions to the same file. It needs no database, no browser and no server, so
it runs in about a second.
