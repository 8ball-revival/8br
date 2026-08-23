# Playoff field reconciliation

Three records of who was in each playoff — the manifest's qualifiers, the bracket page's
entry positions, and the current selection — compared by canonical Player, not by spelling.

Two spellings that resolve to one person after a merge are one member of the set. Counting
them separately made a player look both missing and new at once, and acting on that removed
them from a playoff they had won matches in.

| Season | DB id | Category | Page complete | Manifest | Bracket | Both | Manifest-only | Bracket-only | Same person | Selected | Proposed | +/− | Safe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2008 S3A | 5459 | partial | no | 26 | 26 | 26 | 0 | 0 | 0 | 26 | 26 | +0/−0 | no |
| 2008 S4A | 5461 | partial | no | 24 | 24 | 24 | 0 | 0 | 0 | 24 | 24 | +0/−0 | no |
| 2008 S5A | 5463 | full | yes | 24 | 24 | 24 | 0 | 0 | 1 | 24 | 24 | +0/−0 | **yes** |
| 2009 S1A | 5465 | partial | no | 27 | 27 | 27 | 0 | 0 | 1 | 27 | 27 | +0/−0 | no |
| 2009 S2A | 5467 | partial | no | 27 | 27 | 27 | 0 | 0 | 0 | 27 | 27 | +0/−0 | no |
| 2009 S3A | 5469 | partial | no | 26 | 26 | 26 | 0 | 0 | 1 | 26 | 26 | +0/−0 | no |
| 2009 S5A | 5473 | partial | no | 28 | 29 | 28 | 0 | 1 | 0 | 0 | 0 | +0/−0 | no |
| 2010 S1A | 5477 | full | yes | 30 | 29 | 29 | 1 | 0 | 0 | 30 | 30 | +0/−0 | no |
| 2010 S3A | 5481 | full | yes | 28 | 28 | 28 | 0 | 0 | 1 | 28 | 28 | +0/−0 | **yes** |
| 2010 S4A | 5483 | full | yes | 28 | 28 | 28 | 0 | 0 | 1 | 28 | 28 | +0/−0 | **yes** |
| 2011 S2A | 5487 | partial | no | 25 | 24 | 24 | 1 | 0 | 0 | 25 | 25 | +0/−0 | no |
| 2011 S3A | 5489 | partial | no | 25 | 24 | 24 | 1 | 0 | 0 | 25 | 25 | +0/−0 | no |
| 2011 S4A | 5491 | partial | no | 25 | 25 | 24 | 1 | 1 | 1 | 25 | 25 | +0/−0 | no |
| 2011 S5A | 5493 | partial | no | 23 | 23 | 23 | 0 | 0 | 0 | 23 | 23 | +0/−0 | no |

## One person, two spellings

The manifest and the bracket name the same player differently. No selection changes for these:
the person is in both sources, and both spellings are kept — the non-canonical one as an alias.

- **2008 S5A**: manifest `bigblue2k` and bracket `sixohtwo` are one Player (`cmsyrx31g00006riggac6o23n`)
- **2009 S1A**: manifest `bigblue2k` and bracket `sixohtwo` are one Player (`cmsyrx31g00006riggac6o23n`)
- **2009 S3A**: manifest `bigblue2k` and bracket `SixohTwo` are one Player (`cmsyrx31g00006riggac6o23n`)
- **2010 S3A**: manifest `bigblue2k` and bracket `sixohtwo` are one Player (`cmsyrx31g00006riggac6o23n`)
- **2010 S4A**: manifest `bigblue2k` and bracket `sixohtwo` are one Player (`cmsyrx31g00006riggac6o23n`)
- **2011 S4A**: manifest `bigblue2k` and bracket `sixohtwo` are one Player (`cmsyrx31g00006riggac6o23n`)

## Qualifiers absent from a complete bracket

Deselected from the playoff field only. Season entry and every group result are untouched, and
nothing records them as losing or forfeiting — the source says only that they are not in the draw.

_None._

## Seasons where the page may not decide the field

- **2008 S3A** (Season 5459) — the page is not a complete entry field: the results run unbroken to the Final
- **2008 S4A** (Season 5461) — the page is not a complete entry field: the results run unbroken to the Final
- **2009 S1A** (Season 5465) — the page is not a complete entry field: the results run unbroken to the Final
- **2009 S2A** (Season 5467) — the page is not a complete entry field: the results run unbroken to the Final
- **2009 S3A** (Season 5469) — the page is not a complete entry field: the results run unbroken to the Final
- **2009 S5A** (Season 5473) — the page is not a complete entry field: the results run unbroken to the Final
- **2010 S1A** (Season 5477) — 1 bracket entrant(s) do not resolve: TrueBoston
- **2011 S2A** (Season 5487) — the page is not a complete entry field: the results run unbroken to the Final
- **2011 S3A** (Season 5489) — the page is not a complete entry field: the results run unbroken to the Final
- **2011 S4A** (Season 5491) — the page is not a complete entry field: the results run unbroken to the Final
- **2011 S5A** (Season 5493) — the page is not a complete entry field: the results run unbroken to the Final

## Totals

- Seasons examined: **14**
- Pages proving a complete entry field: **4**
- Safe to reconcile: **3**
- Selections to add: **0**
- Selections to remove: **0**
- Same-person spelling pairs: **6**
