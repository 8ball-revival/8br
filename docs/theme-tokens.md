# The theme token system

What Display Lab controls, why it controls that and not more, and which colours are deliberately
beyond its reach.

---

## The problem this solves

Display Lab used to move exactly one colour — `--acid`, the structural accent. That is why the bar
above the Rankings was the only thing on the site that visibly responded to it, and why a reader
changing the accent could reasonably conclude the panel was broken.

The stylesheet was never the problem. It already declared 183 colour variables in a proper cascade:

```css
--card: var(--graphite-raised);
--foreground: var(--clean-white);
--nav-active: var(--signal);
```

Nothing exposed them. The fix is not to add 183 colour pickers — that is a wall of controls nobody
can hold in their head, and it puts an unusable site one click away. It is to expose the ~48 roles
the other 135 derive from.

---

## How to read a control

Each control in **Display Lab → Palette** moves one custom property. Because the stylesheet derives
from it, "Panel surface" is not the colour of one panel — it is every panel, popover, news column
and Break card at once.

| Group | What moving something here reaches |
| --- | --- |
| Foundations | Page ground, panels, cards, plaques, inset wells, hover surfaces |
| Typography | Every text colour, from body copy down to the quietest metadata |
| Borders & depth | Rules, panel edges, hairlines, the focus ring |
| Brand accents | The accent in both of its jobs, gold, and the four state colours |
| Navigation | The header bar, the current page, and everything else in it |
| Buttons & forms | Filled actions, quiet controls, input edges |
| Tables & rankings | Table headers and rows, and the filter-bar surface |
| Seasons, tournaments & brackets | Bracket nodes, connectors and the advancing side |
| Articles & achievements | Plaque headings and their supporting lines |
| Homepage modules | Hero text over photography, rail dividers |
| Footer & status | The totals bar and the footer surface |
| Image treatments | The colour photography is darkened *with* |

A token that is not set reads **inherited** and takes the built-in value. Resetting one is a delete,
not a re-guess, which is what lets a token added next year arrive with its default already correct
in every theme somebody has already saved.

---

## Deliberate exceptions

These are **not** offered as controls, and that is a decision rather than an omission.

| Colours | Why they are fixed |
| --- | --- |
| Rating tiers (`--tier-gold` … `--tier-grey`) | They encode a number. A reader who learns that gold is 1600+ on the Rankings page has to find it true on a profile. The legend is a promise about a colour. |
| Streaks (`--streak-hot`, `--streak-cold`) | Green is a run of wins and red is a run of losses. Making those configurable makes a winning streak and a losing streak indistinguishable. |
| WCC and 8BRCAM panel palettes | Brand artwork. They belong to competitions this site reports on, not to this site. |
| The YouTube play control | It is YouTube's mark. Recolouring it would be claiming their affordance for something else. |
| Photographs, logos and article thumbnails | Image treatments may darken or tint the *presentation*; no control alters a source file or what a picture contains. |

---

## Contrast is a guard, not a report

`lib/theme/contrast.ts` declares every foreground/background pairing the site can render — 57 of
them, including hover, focus and disabled states.

**Why a declared list rather than a browser crawl.** A crawl finds the page it is looking at in the
state it is in. It does not find the disabled control three clicks away, the hovered row nobody
hovered, or the empty state that needs no data to exist. Those are exactly where text goes invisible,
because they are exactly what nobody checks. The crawl still runs — `npm run test:theme` sweeps real
pages and catches pairings nobody declared — but the list is what blocks.

| Verdict | Meaning |
| --- | --- |
| **block** | An essential pairing under its threshold, or *anything* under 1.25:1. A palette cannot be published. |
| **warn** | A decorative pairing under threshold. The design is worse; nothing is lost. |
| **pass** | At or above threshold. |

Anything under 1.25:1 blocks whatever its weight, because that is text the same colour as its
background — white-on-white and black-on-black both land there.

**Disabled controls are held to 2:1, not 4.5:1.** WCAG exempts them, and forcing them to full
contrast makes them look enabled, which is a worse failure than the one being prevented.

**Borders are decorative.** 1.4.11 asks for 3:1 on a boundary *required* to identify a control. Every
input here also carries a label and a placeholder; every panel also differs from the page in fill.
Forcing 3:1 on all of them means borders roughly as bright as body text — a different design. The one
thing this system must not do is fix contrast by wrecking what it is protecting.

### Two things the engine gets right that a naive one would not

**It follows the cascade.** `--bracket-winner` is `var(--gold)`, so overriding gold moves the
advancing side of a bracket with it. An engine resolving `bracketWinner` straight to its built-in
reports the *old* gold against a *new* background and blocks a preset that is perfectly readable.

**It measures pairs that actually touch.** Every filled action draws its focus ring with
`ring-offset-2 ring-offset-[var(--void)]`, so the ring sits in a gap of page colour *outside* the
button. Measuring ring-against-button measured two colours that never meet, and blocked four presets
for a problem that does not exist on screen.

---

## Values cannot become CSS

Overrides are written into a `style` attribute as custom properties, so a value like
`red;background:url(//x)` would close the declaration and open another.

The validator is therefore an **allow-list**: three, six or eight hex digits, and nothing else. No
`rgb()`, no `var()`, no `color-mix()` — none of them are needed here and each is a parser to trick.
`normaliseTokens` applies it on read as well as on write, so a value stored by an older version, or
by hand, cannot reach the page.

The pre-paint script restates the same rule as a literal regular expression. It has to: it runs
before any module loads and reads `localStorage`, which the reader controls.

---

## Presets

Five, in `lib/theme/presets.ts`. Each is a set of values for the *same* tokens — there is no second
code path and nothing a preset can reach that an Owner cannot then edit.

A preset sets only what it means to change; everything else inherits. That is what stops a token
added later silently breaking every preset written before it.

> **A light preset is not a dark preset with the colours swapped.** `#ff2a2a` measures 5.3:1 on
> near-black and 3.35:1 on paper — the mark that was the most legible thing on the page becomes the
> least. Warm White therefore re-picks red and gold for the ground they land on, and keeps a bright
> red in the navigation because that bar stays dark. The contrast guard caught this; it was not
> noticed by eye.

---

## Adding a token

1. Declare it in `globals.css` with a literal fallback.
2. Add it to `THEME_TOKEN_REGISTRY` with its group, its plain-language `effect`, and `cascadesTo` if
   other properties derive from it.
3. Add at least one pairing in `contrast.ts`. `npm run test:theme` fails on an unpaired token — an
   unchecked colour is how something becomes invisible in a theme nobody rendered.
4. Run `npm run test:theme`. It renders all five presets across six routes at three widths.

## Scope

Display Lab is a preference held by **one browser**. It changes what a reader sees; it never changes
what the site records. A Season's standings and a player's rating are identical whatever is set here,
and a second visitor sees the published site — checked by `test:theme`.
