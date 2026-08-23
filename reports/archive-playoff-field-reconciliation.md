# Playoff field reconciliation

Three records of who was in each playoff — the manifest's qualifiers, the bracket page's
entry positions, and the current selection — compared by canonical Player, not by spelling.

Two spellings that resolve to one person after a merge are one member of the set. Counting
them separately made a player look both missing and new at once, and acting on that removed
them from a playoff they had won matches in.

| Season | DB id | Category | Page complete | Manifest | Bracket | Both | Manifest-only | Bracket-only | Same person | Selected | Proposed | +/− | Safe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2009 S1A | 5465 | full | yes | 27 | 27 | 27 | 0 | 0 | 1 | 27 | 27 | +0/−0 | **yes** |
| 2009 S2A | 5467 | full | yes | 27 | 27 | 27 | 0 | 0 | 0 | 27 | 27 | +0/−0 | **yes** |
| 2009 S3A | 5469 | full | yes | 26 | 26 | 26 | 0 | 0 | 1 | 26 | 26 | +0/−0 | **yes** |
| 2011 S3A | 5489 | full | yes | 25 | 25 | 24 | 1 | 1 | 0 | 25 | 25 | +0/−0 | **yes** |
| 2011 S4A | 5491 | full | yes | 25 | 25 | 24 | 1 | 1 | 1 | 25 | 25 | +0/−0 | **yes** |
| 2013 S4A | 5511 | full | yes | 24 | 24 | 9 | 15 | 15 | 0 | 24 | 24 | +0/−0 | **yes** |

## One person, two spellings

The manifest and the bracket name the same player differently. No selection changes for these:
the person is in both sources, and both spellings are kept — the non-canonical one as an alias.

- **2009 S1A**: manifest `bigblue2k` and bracket `sixohtwo` are one Player (`cmsyrx31g00006riggac6o23n`)
- **2009 S3A**: manifest `bigblue2k` and bracket `SixohTwo` are one Player (`cmsyrx31g00006riggac6o23n`)
- **2011 S4A**: manifest `bigblue2k` and bracket `sixohtwo` are one Player (`cmsyrx31g00006riggac6o23n`)

## Qualifiers absent from a complete bracket

Deselected from the playoff field only. Season entry and every group result are untouched, and
nothing records them as losing or forfeiting — the source says only that they are not in the draw.

_None._

## Seasons where the page may not decide the field


## Totals

- Seasons examined: **6**
- Pages proving a complete entry field: **6**
- Safe to reconcile: **6**
- Selections to add: **0**
- Selections to remove: **0**
- Same-person spelling pairs: **3**
