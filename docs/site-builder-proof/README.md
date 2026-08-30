# Site Builder — proof

Screenshots of the site builder doing each thing it claims to do, captured by driving the real
editor against the real dev server.

**Regenerate them:**

```bash
npm run dev:replica
npm run capture:site-builder
```

The script ([`scripts/capture-site-builder-proof.mjs`](../../scripts/capture-site-builder-proof.mjs))
does not just photograph — it **asserts** at every step, 29 checks in total, and fails if the thing
it is about to photograph is not there. A screenshot of a panel that failed to open still looks like
a screenshot of a panel, which is why the assertions matter more than the images.

It also **starts by resetting the homepage to the layout defined in code** and publishing it, so a
second run photographs the same site as the first rather than the leftovers of it.

| | What it shows |
| --- | --- |
| `01-published-{desktop,tablet,mobile}` | The public homepage at 1600×1000, 768×1024 and 390×844 — no editor, no builder JavaScript |
| `02-edit-mode-{desktop,tablet,mobile}` | Edit Mode at the same three widths. On a phone the toolbar wraps and the panels stack; Publish stays on screen |
| `03-guided-tour` | The dismissible first-run tour |
| `04-module-library` | The module library, searched |
| `05-module-inserted` | The inserted module on the canvas, selected, with its settings open and the breadcrumb showing where it sits |
| `06-module-moved` | The same module after being moved **by button** — nothing here requires a drag |
| `07-layer-tree` | The page as a tree, for reaching what you cannot click |
| `08-command-palette` | `Ctrl+K`: every action by name, and every module in the registry |
| `09-publish-dialog` | The pre-publish review: what blocks, what is only worth a look, each one a button that takes you to the module |
| `10-published-result` | The public homepage carrying the published change |
| `11-control-centre` | Every editable page — static, template and global — with its state, its history and its actions |
| `12-revision-history` | The append-only chain, with Restore on each entry |
| `13-navigation-editing` | The header edited as a page, with the same draft, publish and history |
| `14-theme-contrast` | Every pairing the site renders, with its WCAG ratio and verdict, live as colours are chosen |
| `15-dynamic-template` | The Season template, edited while standing on a real Season so the live data is visible |
| `16-template-applied` | Season 16426 as a visitor sees it, rendered through that template |
