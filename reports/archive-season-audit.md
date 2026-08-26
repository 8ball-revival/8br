# Per-Season audit of the completed Division A reconstruction

Every completed Division A Season put through `verify-archive-season.mts`, which compares the
database against the season manifest and the archived bracket page. **7 of 40 pass every check.**

This audit had never been run across all of them. The batch runner calls the script with no
argument, so it only ever sampled one Season — and the discrepancies below have been sitting there
unmeasured, not introduced by the playoff import.

The 2006–2007 Seasons make that plain. They were imported in an earlier pass under different rules,
are untouched by this work, and fail hardest: 2006 S1A holds 98 entrants against 31 recorded
handles and 14 groups against a manifest that records none. The manifest for those years does not
describe what the database contains, and the script is right to say so.

## Clean

- 2008 S3A (5459) — COMPLETED
- 2008 S4A (5461) — COMPLETED
- 2008 S5A (5463) — COMPLETED
- 2009 S1A (5465) — COMPLETED
- 2012 S1A (5495) — COMPLETED
- 2013 S5A (5513) — COMPLETED
- 2014 S1A (5515) — COMPLETED

## By era

| Year | Clean |
|---|---|
| 2006 | 0 / 7 |
| 2007 | 0 / 6 |
| 2008 | 3 / 5 |
| 2009 | 1 / 4 |
| 2010 | 0 / 3 |
| 2011 | 0 / 4 |
| 2012 | 1 / 5 |
| 2013 | 1 / 5 |
| 2014 | 1 / 1 |

## What fails, and how often

```
     26 ✗ every recorded handle resolves to exactly one entrant
     25 ✗ no entrant exists outside the archive record
     23 ✗ entrant count matches the archive (N)
     20 ✗ every archived standing row matches a recomputed one
     20 ✗ every archived score sits on the fixture between the right two players
     15 ✗ every grouped player is in the group the archive lists
     13 ✗ the standings disagreement is a recorded anomaly (N players)
     13 ✗ every decided match is one the page records (N)
      9 ✗ every archived result was imported (N)
      5 ✗ the recorded playoff field is selected (N)
      4 ✗ an unrecorded topology is only seated where the archived page records it
      2 ✗ the schedule is a full round robin (0 fixtures)
      2 ✗ group count matches the archive (N)
      1 ✗ the schedule is a full round robin (189 fixtures)
      1 ✗ no entrant is soft-withdrawn
      1 ✗ every recorded Round 1 position is seated (N)
      1 ✗ every forfeit is one the page records (N)
```

The three commonest are one problem seen three ways: an entrant whose account is not the one the
recorded handle resolves to. That is identity work — merges and aliases — not import work, and it
is the same long tail that produced the fifteen aliases and one merge settled during this pass.

## Full detail

```
2006 S1A (5428) — COMPLETED | RESULT: 18 passed, 8 failed
    ✗ entrant count matches the archive (31) — 98; 1 recorded handle(s) resolve to nobody: king_hustler2006
    ✗ every recorded handle resolves to exactly one entrant — 14 unmatched
    ✗ no entrant exists outside the archive record — 80 extra
    ✗ group count matches the archive (0) — 14
    ✗ every grouped player is in the group the archive lists — 98 misplaced
    ✗ the schedule is a full round robin (0 fixtures) — 294
    ✗ every archived result was imported (0) — 248
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2006 S2A (5431) — COMPLETED | RESULT: 17 passed, 9 failed
    ✗ entrant count matches the archive (30) — 100
    ✗ every recorded handle resolves to exactly one entrant — 11 unmatched
    ✗ no entrant exists outside the archive record — 81 extra
    ✗ group count matches the archive (0) — 14
    ✗ every grouped player is in the group the archive lists — 100 misplaced
    ✗ the schedule is a full round robin (0 fixtures) — 309
    ✗ every archived result was imported (0) — 256
    ✗ the recorded playoff field is selected (30) — 32
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2006 S3A (5433) — COMPLETED | RESULT: 16 passed, 10 failed
    ✗ entrant count matches the archive (99) — 98; 4 recorded handle(s) resolve to nobody: ace7887, goober.returns, xlx_latinkiing_xlx, mopadmot
    ✗ every recorded handle resolves to exactly one entrant — 33 unmatched
    ✗ no entrant exists outside the archive record — 28 extra
    ✗ no entrant is soft-withdrawn
    ✗ every grouped player is in the group the archive lists — 29 misplaced
    ✗ every archived result was imported (254) — 240
    ✗ every archived score sits on the fixture between the right two players — 139 missing
    ✗ every archived standing row matches a recomputed one — 29 unmatched
    ✗ the recorded playoff field is selected (30) — 31
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2006 S4A (5435) — COMPLETED | RESULT: 20 passed, 9 failed
    ✗ entrant count matches the archive (62) — 63; 5 recorded handle(s) resolve to nobody: al_d_o, goober.returns, silent_fox, chr_lst
    ✗ every recorded handle resolves to exactly one entrant — 22 unmatched
    ✗ no entrant exists outside the archive record — 18 extra
    ✗ every grouped player is in the group the archive lists — 18 misplaced
    ✗ every archived result was imported (179) — 174
    ✗ every archived score sits on the fixture between the right two players — 86 missing
    ✗ every archived standing row matches a recomputed one — 18 unmatched
    ✗ the standings disagreement is a recorded anomaly (1 player(s)) — 2006 S4A is not written up in reports/archive-source-anomalies.md
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2006 S5A (5437) — COMPLETED | RESULT: 19 passed, 10 failed
    ✗ entrant count matches the archive (76) — 77; 1 recorded handle(s) resolve to nobody: o.wn4age
    ✗ every recorded handle resolves to exactly one entrant — 36 unmatched
    ✗ no entrant exists outside the archive record — 35 extra
    ✗ every grouped player is in the group the archive lists — 35 misplaced
    ✗ every archived result was imported (212) — 215
    ✗ every archived score sits on the fixture between the right two players — 142 missing
    ✗ every archived standing row matches a recomputed one — 35 unmatched
    ✗ the standings disagreement is a recorded anomaly (3 player(s)) — 2006 S5A is not written up in reports/archive-source-anomalies.md
    ✗ the recorded playoff field is selected (38) — 39
    ✗ every decided match is one the page records (63) — 63 decided, 0 proven and 0 bye(s) on the page
2006 S6A (5439) — COMPLETED | RESULT: 21 passed, 8 failed
    ✗ every recorded handle resolves to exactly one entrant — 31 unmatched
    ✗ no entrant exists outside the archive record — 29 extra
    ✗ every grouped player is in the group the archive lists — 29 misplaced
    ✗ every archived result was imported (200) — 202
    ✗ every archived score sits on the fixture between the right two players — 129 missing
    ✗ every archived standing row matches a recomputed one — 29 unmatched
    ✗ the standings disagreement is a recorded anomaly (1 player(s)) — 2006 S6A is not written up in reports/archive-source-anomalies.md
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2006 S7A (5441) — COMPLETED | RESULT: 22 passed, 7 failed
    ✗ every recorded handle resolves to exactly one entrant — 24 unmatched
    ✗ no entrant exists outside the archive record — 23 extra
    ✗ every grouped player is in the group the archive lists — 23 misplaced
    ✗ every archived score sits on the fixture between the right two players — 117 missing
    ✗ every archived standing row matches a recomputed one — 23 unmatched
    ✗ the standings disagreement is a recorded anomaly (2 player(s)) — 2006 S7A is not written up in reports/archive-source-anomalies.md
    ✗ every decided match is one the page records (63) — 63 decided, 0 proven and 0 bye(s) on the page
2007 S1A (5443) — COMPLETED | RESULT: 21 passed, 8 failed
    ✗ entrant count matches the archive (62) — 63; 1 recorded handle(s) resolve to nobody: cubs_fan_21_07_04
    ✗ every recorded handle resolves to exactly one entrant — 23 unmatched
    ✗ no entrant exists outside the archive record — 23 extra
    ✗ every grouped player is in the group the archive lists — 23 misplaced
    ✗ every archived score sits on the fixture between the right two players — 107 missing
    ✗ every archived standing row matches a recomputed one — 23 unmatched
    ✗ the standings disagreement is a recorded anomaly (1 player(s)) — 2007 S1A is not written up in reports/archive-source-anomalies.md
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2007 S2A (5445) — COMPLETED | RESULT: 20 passed, 9 failed
    ✗ entrant count matches the archive (64) — 63
    ✗ every recorded handle resolves to exactly one entrant — 22 unmatched
    ✗ no entrant exists outside the archive record — 21 extra
    ✗ every grouped player is in the group the archive lists — 21 misplaced
    ✗ every archived result was imported (173) — 174
    ✗ every archived score sits on the fixture between the right two players — 97 missing
    ✗ every archived standing row matches a recomputed one — 21 unmatched
    ✗ the standings disagreement is a recorded anomaly (3 player(s)) — 2007 S2A is not written up in reports/archive-source-anomalies.md
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2007 S3A (5447) — COMPLETED | RESULT: 21 passed, 8 failed
    ✗ every recorded handle resolves to exactly one entrant — 21 unmatched
    ✗ no entrant exists outside the archive record — 19 extra
    ✗ every grouped player is in the group the archive lists — 19 misplaced
    ✗ every archived score sits on the fixture between the right two players — 90 missing
    ✗ every archived standing row matches a recomputed one — 19 unmatched
    ✗ the standings disagreement is a recorded anomaly (1 player(s)) — 2007 S3A is not written up in reports/archive-source-anomalies.md
    ✗ an unrecorded topology is only seated where the archived page records it — seated with no page to seat it from
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2007 S4A (5449) — COMPLETED | RESULT: 20 passed, 9 failed
    ✗ every recorded handle resolves to exactly one entrant — 18 unmatched
    ✗ no entrant exists outside the archive record — 18 extra
    ✗ every grouped player is in the group the archive lists — 18 misplaced
    ✗ every archived result was imported (148) — 140
    ✗ every archived score sits on the fixture between the right two players — 89 missing
    ✗ every archived standing row matches a recomputed one — 18 unmatched
    ✗ the standings disagreement is a recorded anomaly (6 player(s)) — 2007 S4A is not written up in reports/archive-source-anomalies.md
    ✗ an unrecorded topology is only seated where the archived page records it — seated with no page to seat it from
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2007 S5A (5451) — COMPLETED | RESULT: 19 passed, 7 failed
    ✗ every recorded handle resolves to exactly one entrant — 18 unmatched
    ✗ no entrant exists outside the archive record — 18 extra
    ✗ every grouped player is in the group the archive lists — 18 misplaced
    ✗ every archived score sits on the fixture between the right two players — 79 missing
    ✗ every archived standing row matches a recomputed one — 18 unmatched
    ✗ an unrecorded topology is only seated where the archived page records it — seated with no page to seat it from
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2007 S6A (5453) — COMPLETED | RESULT: 20 passed, 9 failed
    ✗ entrant count matches the archive (44) — 42
    ✗ every recorded handle resolves to exactly one entrant — 13 unmatched
    ✗ no entrant exists outside the archive record — 10 extra
    ✗ every grouped player is in the group the archive lists — 11 misplaced
    ✗ every archived score sits on the fixture between the right two players — 46 missing
    ✗ every archived standing row matches a recomputed one — 11 unmatched
    ✗ the standings disagreement is a recorded anomaly (10 player(s)) — 2007 S6A is not written up in reports/archive-source-anomalies.md
    ✗ an unrecorded topology is only seated where the archived page records it — seated with no page to seat it from
    ✗ every decided match is one the page records (31) — 31 decided, 0 proven and 0 bye(s) on the page
2008 S1A (5455) — COMPLETED | RESULT: 19 passed, 10 failed
    ✗ entrant count matches the archive (61) — 62; 1 recorded handle(s) resolve to nobody: xl_ketan_lx
    ✗ every recorded handle resolves to exactly one entrant — 18 unmatched
    ✗ no entrant exists outside the archive record — 18 extra
    ✗ every grouped player is in the group the archive lists — 18 misplaced
    ✗ the schedule is a full round robin (189 fixtures) — 183
    ✗ every archived result was imported (172) — 159
    ✗ every archived score sits on the fixture between the right two players — 89 missing
    ✗ every archived standing row matches a recomputed one — 18 unmatched
    ✗ the standings disagreement is a recorded anomaly (10 player(s)) — 2008 S1A is not written up in reports/archive-source-anomalies.md
    ✗ every forfeit is one the page records (1) — 1 recorded, 2 on the page
2008 S2A (5457) — COMPLETED | RESULT: 23 passed, 6 failed
    ✗ every recorded handle resolves to exactly one entrant — 8 unmatched
    ✗ no entrant exists outside the archive record — 8 extra
    ✗ every grouped player is in the group the archive lists — 8 misplaced
    ✗ every archived score sits on the fixture between the right two players — 40 missing
    ✗ every archived standing row matches a recomputed one — 8 unmatched
    ✗ the standings disagreement is a recorded anomaly (1 player(s)) — 2008 S2A is not written up in reports/archive-source-anomalies.md
2008 S3A (5459) — COMPLETED | RESULT: 26 passed, 0 failed
2008 S4A (5461) — COMPLETED | RESULT: 26 passed, 0 failed
2008 S5A (5463) — COMPLETED | RESULT: 26 passed, 0 failed
2009 S1A (5465) — COMPLETED | RESULT: 26 passed, 0 failed
2009 S2A (5467) — COMPLETED | RESULT: 25 passed, 1 failed
    ✗ entrant count matches the archive (56) — 58
2009 S3A (5469) — COMPLETED | RESULT: 25 passed, 1 failed
    ✗ entrant count matches the archive (56) — 57
2009 S5A (5473) — COMPLETED | RESULT: 23 passed, 3 failed
    ✗ every recorded handle resolves to exactly one entrant — 1 unmatched
    ✗ no entrant exists outside the archive record — 1 extra
    ✗ the recorded playoff field is selected (28) — 29
2010 S1A (5477) — COMPLETED | RESULT: 23 passed, 3 failed
    ✗ every recorded handle resolves to exactly one entrant — 2 unmatched
    ✗ every archived score sits on the fixture between the right two players — 11 missing
    ✗ every archived standing row matches a recomputed one — 2 unmatched
2010 S3A (5481) — COMPLETED | RESULT: 23 passed, 3 failed
    ✗ every recorded handle resolves to exactly one entrant — 1 unmatched
    ✗ every archived score sits on the fixture between the right two players — 6 missing
    ✗ every archived standing row matches a recomputed one — 1 unmatched
2010 S4A (5483) — COMPLETED | RESULT: 23 passed, 3 failed
    ✗ every recorded handle resolves to exactly one entrant — 2 unmatched
    ✗ every archived score sits on the fixture between the right two players — 9 missing
    ✗ every archived standing row matches a recomputed one — 2 unmatched
2011 S2A (5487) — COMPLETED | RESULT: 25 passed, 1 failed
    ✗ entrant count matches the archive (46) — 47
2011 S3A (5489) — COMPLETED | RESULT: 24 passed, 2 failed
    ✗ entrant count matches the archive (51) — 53
    ✗ no entrant exists outside the archive record — 1 extra
2011 S4A (5491) — COMPLETED | RESULT: 22 passed, 4 failed
    ✗ entrant count matches the archive (50) — 51
    ✗ every recorded handle resolves to exactly one entrant — 1 unmatched
    ✗ every archived score sits on the fixture between the right two players — 4 missing
    ✗ every archived standing row matches a recomputed one — 1 unmatched
2011 S5A (5493) — COMPLETED | RESULT: 25 passed, 1 failed
    ✗ entrant count matches the archive (43) — 46
2012 S1A (5495) — COMPLETED | RESULT: 30 passed, 0 failed
2012 S2A (5497) — COMPLETED | RESULT: 20 passed, 7 failed
    ✗ entrant count matches the archive (68) — 69
    ✗ every recorded handle resolves to exactly one entrant — 2 unmatched
    ✗ no entrant exists outside the archive record — 1 extra
    ✗ every archived score sits on the fixture between the right two players — 6 missing
    ✗ every archived standing row matches a recomputed one — 1 unmatched
    ✗ the recorded playoff field is selected (26) — 25
    ✗ every recorded Round 1 position is seated (26) — 25
2012 S3A (5499) — COMPLETED | RESULT: 24 passed, 6 failed
    ✗ entrant count matches the archive (68) — 69
    ✗ every recorded handle resolves to exactly one entrant — 1 unmatched
    ✗ no entrant exists outside the archive record — 1 extra
    ✗ every archived score sits on the fixture between the right two players — 6 missing
    ✗ every archived standing row matches a recomputed one — 1 unmatched
    ✗ the standings disagreement is a recorded anomaly (2 player(s)) — 2012 S3A is not written up in reports/archive-source-anomalies.md
2012 S4A (5501) — COMPLETED | RESULT: 22 passed, 5 failed
    ✗ entrant count matches the archive (68) — 69
    ✗ every recorded handle resolves to exactly one entrant — 1 unmatched
    ✗ no entrant exists outside the archive record — 1 extra
    ✗ every archived score sits on the fixture between the right two players — 6 missing
    ✗ every archived standing row matches a recomputed one — 1 unmatched
2012 S5A (5503) — COMPLETED | RESULT: 25 passed, 2 failed
    ✗ entrant count matches the archive (56) — 57
    ✗ no entrant exists outside the archive record — 1 extra
2013 S1A (5505) — COMPLETED | RESULT: 24 passed, 3 failed
    ✗ entrant count matches the archive (60) — 61
    ✗ every recorded handle resolves to exactly one entrant — 1 unmatched
    ✗ no entrant exists outside the archive record — 2 extra
2013 S2A (5507) — COMPLETED | RESULT: 25 passed, 2 failed
    ✗ entrant count matches the archive (59) — 60
    ✗ no entrant exists outside the archive record — 1 extra
2013 S3A (5509) — COMPLETED | RESULT: 27 passed, 3 failed
    ✗ entrant count matches the archive (74) — 75; 1 recorded handle(s) resolve to nobody: goober.returns
    ✗ every recorded handle resolves to exactly one entrant — 4 unmatched
    ✗ no entrant exists outside the archive record — 2 extra
2013 S4A (5511) — COMPLETED | RESULT: 26 passed, 4 failed
    ✗ entrant count matches the archive (65) — 66
    ✗ every recorded handle resolves to exactly one entrant — 1 unmatched
    ✗ no entrant exists outside the archive record — 2 extra
    ✗ the standings disagreement is a recorded anomaly (1 player(s)) — 2013 S4A is not written up in reports/archive-source-anomalies.md
2013 S5A (5513) — COMPLETED | RESULT: 27 passed, 0 failed
2014 S1A (5515) — COMPLETED | RESULT: 27 passed, 0 failed
```
