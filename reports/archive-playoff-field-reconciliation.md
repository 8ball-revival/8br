# Playoff field reconciliation

Three records of who was in each playoff — the manifest's qualifiers, the bracket page's
entry positions, and the current selection — compared by canonical Player, not by spelling.

Two spellings that resolve to one person after a merge are one member of the set. Counting
them separately made a player look both missing and new at once, and acting on that removed
them from a playoff they had won matches in.

| Season | DB id | Category | Page complete | Manifest | Bracket | Both | Manifest-only | Bracket-only | Same person | Selected | Proposed | +/− | Safe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2009 S1A | 5465 | partial | yes | 27 | 27 | 27 | 0 | 0 | 1 | 27 | 27 | +0/−0 | **yes** |
| 2009 S2A | 5467 | partial | yes | 27 | 27 | 27 | 0 | 0 | 0 | 27 | 27 | +0/−0 | **yes** |
| 2009 S3A | 5469 | partial | yes | 26 | 26 | 26 | 0 | 0 | 1 | 26 | 26 | +0/−0 | **yes** |
| 2009 S5A | 5473 | full | yes | 28 | 29 | 28 | 0 | 1 | 0 | 0 | 29 | +29/−0 | **yes** |
| 2011 S3A | 5489 | partial | yes | 25 | 25 | 24 | 1 | 1 | 0 | 25 | 25 | +2/−2 | **yes** |
| 2011 S4A | 5491 | partial | yes | 25 | 25 | 24 | 1 | 1 | 1 | 25 | 25 | +1/−1 | **yes** |
| 2013 S4A | 5511 | partial | yes | 24 | 24 | 9 | 15 | 15 | 0 | 24 | 24 | +16/−16 | **yes** |

## One person, two spellings

The manifest and the bracket name the same player differently. No selection changes for these:
the person is in both sources, and both spellings are kept — the non-canonical one as an alias.

- **2009 S1A**: manifest `bigblue2k` and bracket `sixohtwo` are one Player (`cmsyrx31g00006riggac6o23n`)
- **2009 S3A**: manifest `bigblue2k` and bracket `SixohTwo` are one Player (`cmsyrx31g00006riggac6o23n`)
- **2011 S4A**: manifest `bigblue2k` and bracket `sixohtwo` are one Player (`cmsyrx31g00006riggac6o23n`)

## Qualifiers absent from a complete bracket

Deselected from the playoff field only. Season entry and every group result are untouched, and
nothing records them as losing or forfeiting — the source says only that they are not in the draw.

- **2011 S3A** (Season 5489): `catsslover`, `lx_____tav0______lx@sbcglobal.net`
- **2011 S4A** (Season 5491): `jesse_j`
- **2013 S4A** (Season 5511): `p0olz`, `disaster`, `xlx_sid_xlx`, `sixohtwo`, `llvll925`, `shad0w_0f_decepti0n`, `jt.jester`, `catsslover`, `run_it_down`, `el_drunken`, `redrose_and_a_glassofwine`, `black_stallion009`, `l_hero_23_l`, `grey_gooose`, `pf_masta_pf`, `lx_____tav0______lx@sbcglobal.net`

## Seasons where the page may not decide the field


## Totals

- Seasons examined: **7**
- Pages proving a complete entry field: **7**
- Safe to reconcile: **7**
- Selections to add: **48**
- Selections to remove: **19**
- Same-person spelling pairs: **3**
