# Site Builder — User Guide

This is the plain-language guide to editing 8 Ball Registry without touching code. The same material
is available inside the app, under **Admin → Site Builder → Guide**.

---

## Getting in

Sign in as the Owner and open any page on the site. Press **Edit** in the header.

The page becomes an editing canvas. It is the real page, not a preview — the rankings on it are the
real rankings, the marquee is the real marquee. That is deliberate: what you see while editing is
what visitors will see when you publish.

To leave, press the **✕** at the right of the toolbar, or remove `?edit=1` from the address bar.

> **Only the Owner sees the Edit button.** The site builder can change every public page and the
> navigation, so it is restricted to one person by default. Everything you do is recorded in the
> Activity Log.

---

## The toolbar

Along the top, from left to right:

| Control | What it does |
| --- | --- |
| **Edit mode** badge | Confirms you are editing rather than browsing |
| Page name | Which page you are working on |
| Status | *Up to date*, *Unsaved changes*, *Saving*, *Saved*, or a warning |
| **↶ ↷** | Undo and redo (also `Ctrl+Z` / `Ctrl+Shift+Z`) |
| 🖥 📱 | Desktop, tablet and phone — narrows the page and switches which layout you are editing |
| 👁 | Preview: hides every editing outline so you can see the page as a visitor would |
| ▦ ⚙ | Show or hide the Modules and Settings panels |
| 🕘 | Revision history |
| **Save draft** | Saves now (it also saves by itself as you work) |
| **Publish** | Makes the draft live for everyone |
| **✕** | Leave Edit Mode |

---

## Editing text

Click a module to select it. Its settings appear in the panel on the right, and any text it contains
is a field there — a heading, body copy, a button label, an announcement.

Type into the field and the page updates. Nothing is public until you press Publish.

For a block of formatted copy, use the **Rich text** module. It accepts bold, italic, lists, links
and small headings. Anything else you paste is removed when it saves — that is a safety measure, not
a bug.

---

## Replacing an image

Select the module and use its **Image** field. Choosing **Choose an image…** opens the site's media
library; pick one and it appears immediately.

- **Alt text** describes the picture for anyone who cannot see it. Leave it blank only if the image
  is purely decorative.
- **Aspect ratio** reserves the space before the picture loads, so the page does not jump.
- **Focal point** decides which part of the picture survives when it is cropped.

To upload something new, add it to the media library in the admin area first; it then appears in
every picker.

---

## Moving things

Four ways, all equivalent — use whichever suits you:

1. **Drag** the handle (⠿) at the top-right of the selected module.
2. **Arrow buttons** in the same toolbar move it one place up or down.
3. **Keyboard**: `Alt` + `↑` / `↓`.
4. Moving past the end of a row moves it into the next row.

Nothing in the builder requires a precise drag. On a phone or tablet the arrow buttons are the
primary way, and they work everywhere.

Sections themselves move the same way — click a section's name label to select it.

---

## Resizing and column proportions

**A single module**: select it, open **Size & placement**, and set how many columns it spans.

**A whole row**: click the row's name label, open **Columns**, and pick a proportion — 50/50, 58/42,
55/45, thirds, quarters. These are the same proportions the site already uses, which is why a row you
build looks like the rows that were there before.

---

## Replacing one module with another

Select a module and press the **⇄** button, or use **Replace** in its toolbar.

You are offered the modules that do the same job — a ranking panel can become a different ranking
panel, an announcement a different announcement. Choose one and you are told exactly which settings
carry across before you confirm.

The replacement keeps the original's position, size, responsive settings and appearance. The original
is not removed until you confirm, and **Undo** brings it back.

---

## Adding and removing

**Add**: open the **Modules** panel on the left, search or browse by category, and click one. It is
inserted after whatever you had selected. **Add a section** creates a new row.

Modules marked **LIVE** read real competition data. You choose *what* they show; the figures always
come from the registry itself.

**Remove**: select the module and press the **🗑** button. It goes to the **Trash**, where it stays
for 30 days — deleting is never immediate and never final.

**Duplicate**: the **⧉** button, or `Ctrl+D`.

**Hide temporarily**: the **👁** button. The module stays exactly where it is and stops being shown
to visitors. Press it again to bring it back.

---

## Desktop, tablet and phone

Press one of the three device buttons. The page narrows to that width and the Settings panel switches
to editing *that* layout.

Tablet and phone **follow desktop** until you deliberately change them. Once you do, the panel says
*Set for tablet only* and offers **Reset to inherited** to hand control back to desktop.

That means you can lay the page out once and it works everywhere, and still override a single value
on phones when you need to.

---

## Draft and Publish

Everything you do is a **draft**. Only you can see it; visitors keep seeing the published page. The
draft saves by itself about a second after you stop making changes, and the toolbar tells you when.

**Publish** makes the draft live for everyone. You are shown a summary first, and you can add a note
describing what changed — that note appears in the revision history and is worth writing.

Publishing is all-or-nothing: it either happens completely or not at all.

---

## Scheduling

In a module's **Visibility** section, **Show between** takes a start and an end. Leave either side
empty for an open-ended window.

Use it to prepare an announcement now and have it appear by itself when a season opens, or to have
one stop showing when registration closes. The panel writes the rule back to you in plain English so
you can check it, and warns you if a combination could never be true.

---

## Undo, history and getting back

| If you want to… | Do this |
| --- | --- |
| Take back the last change | **Undo** (`Ctrl+Z`) |
| Throw away everything since the last publish | **Revision history → Restore** the live revision |
| Go back to how the page looked last week | **Revision history → Restore** that revision |
| Recover a module you deleted | **Admin → Site Builder → Trash** |
| Start again from the original design | **Admin → Site Builder → Reset** on that page |

Restoring never overwrites anything. It publishes the old version as a *new* revision, so the version
you restored *from* is still there and the restore itself can be undone.

---

## Reusable modules and templates

**Save as reusable** (the 💾 button) keeps a module's settings so the same thing can be dropped onto
other pages — an announcement you want on three pages, a call to action you reuse each season.

**Save as template** keeps a whole row or page layout to start from later.

Both live in **Admin → Site Builder**.

---

## Navigation, header and footer

These are edited from **Admin → Site Builder** rather than on the page, because they appear on every
page.

You can rename links, reorder them, add and remove them, and choose whether one opens in a new tab.

> **You cannot lock yourself out.** `/staff/site-builder` works regardless of what the published
> navigation says, so even a completely broken menu leaves the way back open.

---

## If something looks wrong

The site is built so that a mistake in the builder cannot take the public site down.

- A module with a bad setting shows you a warning while editing, and visitors see the module with
  that one setting at its default.
- A layout that cannot be read at all is skipped, and the site serves the last version that worked.
- If no saved version works, the site falls back to the layout built into the code.

**Admin → Site Builder → Health** tells you if any of that is happening, and which page.

Full recovery steps are in [`site-builder-recovery.md`](./site-builder-recovery.md).

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+D` | Duplicate the selected module |
| `Alt+↑` / `Alt+↓` | Move the selected module |
| `Esc` | Deselect |
| `Enter` / `Space` | Select the focused module |
