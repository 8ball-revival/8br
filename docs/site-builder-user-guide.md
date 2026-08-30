# Site Builder — User Guide

This is the plain-language guide to editing 8 Ball Registry without touching code. The same material
is available inside the app, under **Admin → Site Builder → Guide**.

---

## Getting in

Sign in as the Owner and open any page on the site. Press **Edit** in the header.

**Admin** and **Site Builder** are in your account menu** — the one behind your name at the right of
the header — and in the mobile menu. They are deliberately not in the main navigation: the main
navigation is editable, and a link you can publish away is not a way back in.

The page becomes an editing canvas. It is the real page, not a preview — the rankings on it are the
real rankings, the marquee is the real marquee. That is deliberate: what you see while editing is
what visitors will see when you publish.

The first time you enter Edit Mode you are offered a short **guided tour**. Skip it or take it; it
does not come back once dismissed, and the **?** button in the bottom-right corner reopens it.

To leave, press the **✕** at the right of the toolbar, or remove `?edit=1` from the address bar.

> **Only the Owner sees the Edit button.** The site builder can change every public page and the
> navigation, so it is restricted to one person by default. Everything you do is recorded in the
> Activity Log.

### Every page, not just the edges

All of it is editable — the rankings table, the tournament list, an article body, a player profile.
The real page content sits inside the layout as a module like any other, so you can put things above
it, below it, beside it, or move it into a column.

Those content modules are marked **essential**. You can move, resize and hide them, but removing one
takes a typed confirmation, because deleting the rankings table from the rankings page is a thing
somebody would want to be sure about.

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
| ▦ ⚙ | Show or hide the left and right panels |
| ⌘K | The command palette — every action, by name |
| 🕘 | Revision history |
| **Save draft** | Saves now (it also saves by itself as you work) |
| **Publish** | Makes the draft live for everyone |
| **✕** | Leave Edit Mode |

---

## The command palette

`Ctrl+K` (`⌘K` on a Mac) opens a search box over the page. Type a few letters and press Enter.

Everything is in there: publish, save, undo, redo, preview, the three device widths, the layer tree,
the control centre, replace, duplicate and delete the selected module — and **every module in the
library**, so "add a heading" is three keystrokes rather than a hunt through a panel.

It is worth learning because it is the fastest path to anything, and because it is the one control
that does not depend on finding a small button.

---

## Layers

The left panel has two tabs: **Add** and **Layers**.

**Layers** is the page as a tree — sections, the modules inside them, and anything nested inside a
container. Click a row to select it; the page scrolls to it and the Settings panel follows.

This is how you reach something you cannot easily click: a module hidden by a visibility rule, one
inside a collapsed accordion, or a container whose children cover it completely. The breadcrumb
above the Settings panel does the same job from the other direction — it shows where the selected
module sits, and each step of it is clickable.

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
primary way, and they work everywhere. Dragging shows an insertion line where the module will land,
including inside a container.

Sections themselves move the same way — click a section's name label to select it.

**Copy and paste** works too: `Ctrl+C` on a selected module, `Ctrl+V` to paste it after whatever is
selected. The copy travels as text, so it survives a reload and can cross to another page or another
browser tab. Pasting anything that is not a copied module does nothing at all.

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

**Add**: open the **Add** panel on the left, search or browse by category, and click one. It is
inserted after whatever you had selected — or *inside* it, if what you had selected was a container.
**Add a section** creates a new row.

The same panel has two more tabs. **Saved** holds reusable modules; **Templates** holds saved
layouts. See below.

Modules marked **LIVE** read real competition data. You choose *what* they show; the figures always
come from the registry itself.

**Remove**: select the module and press the **🗑** button. It goes to the **Trash**, where it stays
for 30 days — deleting is never immediate and never final.

Deleting an **essential** module — the rankings table, an article body, a tournament bracket — asks
you to type its name first. That is not a formality: those modules are the reason the page exists,
and a stray click should not be able to empty a page that thousands of results depend on.

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

### What Publish checks first

Before it offers to publish, the dialog re-checks the whole page. Two lists, and they behave
differently.

**Settings that need attention** stop the publish. These are settings that could not be stored as
typed — a destination that is not a valid address, a number outside its range. Publishing anyway
would put the module on the public page with that setting at its default, which is not what anybody
meant.

**Things worth a look** do not stop anything:

- a visibility rule that can never be true, so the module would never appear at all,
- an image with no alt text, which makes it invisible to a screen reader,
- an empty section, which publishes as blank space,
- an **essential** module you have hidden.

These are legitimate states — an empty section halfway through a redesign is normal — and a warning
that blocked you would only teach you to ignore warnings.

Every entry in both lists is a **button**. Press it and the page selects that module and scrolls to
it, so "the third module in row two" never means hunting for the third module in row two.

---

## Scheduling

Two different things, and they are worth keeping apart.

**A module appearing and disappearing.** In a module's **Visibility** section, **Show between** takes
a start and an end. Leave either side empty for an open-ended window. Use it to prepare an
announcement now and have it appear by itself when a season opens. The panel writes the rule back to
you in plain English so you can check it, and warns you if a combination could never be true.

**A whole page publishing itself.** **Publish → Schedule** freezes the page as it stands and
publishes it at a time you choose. It happens on its own — you do not have to be there.

- What is scheduled is the page **as it was when you scheduled it**. Carry on editing afterwards;
  the draft and the scheduled version go their separate ways.
- **Admin → Site Builder → Schedule** shows everything: waiting, overdue, published, failed and
  cancelled, with every time in **your** time zone and the zone named.
- You can **Move** a pending publication to a different time, or **Cancel** it.
- If something says **Overdue** and you would rather not wait, **Run the schedule now**.
- If something says **Failed**, the reason is on the row and the page kept what it was already
  showing — nothing is broken, and there is no hurry.

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

## Reusable modules

**Save as reusable** (the 💾 button) keeps a module's settings so the same thing can be dropped onto
other pages — an announcement you want on three pages, a call to action you reuse each season.

Saved modules appear under **Add → Saved**. Inserting one creates a **linked** instance: the
inspector says so, and shows which other pages carry one.

**Editing the saved module does not republish the pages that use it.** They pick the change up when
you next publish each of them. That is deliberate — a linked module can sit on a dozen pages, each
with its own draft, and quietly publishing all of them because you changed a phone number would be
the single most surprising thing this system could do.

**Detach** turns a linked instance into an ordinary copy. It keeps exactly the settings it had and
stops following the original.

---

## Templates

A template is a saved **layout** — a starting point, never a link.

### Making one

Two ways:

- **Admin → Site Builder → Templates → New template.** It opens **empty** and you build it there,
  the same way you build a page. You do not need an existing layout to copy first.
- **Save as template** in Edit Mode, which offers two scopes when a section is selected:
  **This whole page**, or **Just this section** — the row you have selected. The second is the one
  you will use most: a standings block with its heading and spacing, a sponsor row, a call to action.

### Using one

Templates appear under **Add → Templates** in the editor. Inserting a **section** template drops its
sections in after whatever you have selected. Inserting a **page** template replaces the page's
layout, and asks first.

Either way it goes into the **draft**, so it is undoable and visitors see nothing until you publish.

### Managing them

**Admin → Site Builder → Templates** lists every template, including ones with nothing in them and
ones nothing has been built from. For each you can:

| | |
| --- | --- |
| **Edit** | Opens the template in the full editor — canvas, inspector, palette, undo, the lot |
| **Where it is used** | Linked modules it plants, and pages that look like they started from it |
| **Rename** | Its name, its description, and whether it is a page or a section template |
| **Pin** | Keeps it at the top of the list |
| **Duplicate** | A separate copy with its own history |
| **Archive / Restore** | Out of the way without losing it. This is the ordinary way to retire one |
| **Delete** | Permanent, and refused while a linked module it plants is live on a page |
| **History** | Every save, with a Restore on each — inside the template editor |

Editing a template **saves as you work**. There is no publish step, because there is nothing to
publish: a template is not on the site.

> **Editing a template never changes a page.** Inserting one copies its sections with fresh
> identifiers and no link back, so renaming or restructuring a template later has no effect on
> anything already built from it. That is the opposite of a **reusable module**, which stays linked
> on purpose — and it is the single most important thing to keep straight about the two.
>
> The one exception is a template that contains a *linked reusable module*. Inserting it plants a
> module that does stay synced, and **Where it is used** tells you which pages are carrying one
> before you change anything. Even then, each of those pages still needs publishing before a
> visitor sees the change.

### Dynamic page templates are different

**Season**, **Tournament**, **Article** and **Player profile** under **Pages → Dynamic templates**
are not saved layouts — they govern every page of that kind, live. Editing one is a publish like any
other. They open on a real example so the live data is visible; if nothing of that kind exists yet,
they open on their own and are marked **No example**.

---

## Navigation, header, footer and theme

These appear on every page, so they are edited from **Admin → Site Builder** rather than on one page
— under **Navigation & header**, **Footer** and **Theme**.

They are edited exactly like a page: a draft that autosaves, a Publish button, a revision history and
a Restore. Changing the site navigation is a publish, recorded in the Activity Log like any other.

### Navigation

Each link has:

| Setting | What it does |
| --- | --- |
| **Label** | What the link says |
| **Phone label** | A shorter label used only in the mobile menu. Blank means "use the label" |
| **Where it goes** | Pick a page from the list, or type an address |
| **New tab** | For links that leave the site |
| **Icon** and **Badge** | Optional; a badge is a short word like *New* |
| **Who sees it** | Everyone, signed in, signed out, staff, or the Owner |
| **Where it shows** | Both, desktop only, or phone only |
| **Sub-links** | One level of drop-down menu |

Internal links are chosen from a list of the site's real pages, so they cannot point at a route that
does not exist. Typed addresses are checked: anything that is not an ordinary web address is refused
at the point of typing, not discovered later by a visitor.

The **logo** (text or an image), its link, and the header density are on the same page. So is the
site-wide **banner** — a strip above the header with its own message, link and date window, for
"registration closes Sunday".

### Footer

Columns of links, the legal line, and the social icons. Columns are added, reordered and removed the
same way modules are, and each link is validated the same way a navigation link is.

### Theme

Colours, type and spacing for every public page. Each colour shows its **contrast ratio** against the
surface it sits on, with a plain pass/fail against WCAG AA — so a palette that looks striking and
reads as grey mush is caught before it publishes rather than after.

The theme is published *underneath* each visitor's own Display Lab settings. Somebody who has chosen
larger text or a different contrast mode keeps it; the site theme moves everything else.

The admin interface does not use the site theme. Whatever you publish, the editor, the control centre
and the admin area keep their own colours — so a theme that turns out to be unreadable can always be
edited back.

> **You cannot lock yourself out.** **Admin** and **Site Builder** are in your account menu and the
> mobile menu, not in the editable navigation, and `/staff/site-builder` works regardless of what is
> published. A completely broken menu still leaves the way back open.

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
| `Ctrl+K` | The command palette |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+D` | Duplicate the selected module |
| `Ctrl+C` / `Ctrl+V` | Copy and paste a module, across pages and tabs |
| `Alt+↑` / `Alt+↓` | Move the selected module |
| `Esc` | Deselect |
| `Enter` / `Space` | Select the focused module |
