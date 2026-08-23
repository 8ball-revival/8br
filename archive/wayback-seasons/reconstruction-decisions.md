# Reconstruction decisions

Every judgement made while reading the archived brackets and importing them, with the reasoning.
Written so each one can be argued with later, and reversed if it is wrong.

Division A stood at 20 of 44 Seasons complete before this pass and 33 after.

## Reading a transcribed bracket

**A winner is whoever the next round contains; the score is then oriented onto their side.**
A rendered page read out as text loses which side of a match each player sat on, so the printed
score cannot be attributed by position — the 2014 final reads `MJ_The_King 9-3 havok` and havok is
the champion. But a bracket states each result twice, and the second statement survives: one of the
two names reappears in the next round. That names the winner, and a race is won by the higher
number, so the score follows. Players stay in their transcribed slots, because that order turned out
to be the bracket's own structure and moving them severs the round-to-round check.

Confirmed independently: 2012 S4 and S5 already had champions read from their HTML captures by a
different route, and the transcriptions agree.

**Seed numbers in the transcribed files are the standard 32-draw layout, not transcribed.** The
owner's pastes carry seeds only for 2013 S2. The layout is identical on every capture that prints
seeds, so it is structural rather than a claim about any particular player.

**One spelling per person per page.** A page can spell somebody two ways — `nichilicious` in round
one, `nishilicious` in round two — which makes it look like the page advances a player who was never
in the match. Near-identical spellings are folded onto whichever the page uses most, the earliest if
it uses them equally. Five Seasons were stalled on this alone.

## Recording a match nobody finished

**A disqualification is recorded the way a forfeit is: the winner advances, no games either side.**
Owner decision. `0-FF` names the side that gave up; a bare `DQ` does not, but the bracket does, by
carrying one player forward. A disqualification the bracket cannot resolve stays unproven.

**Walkovers and the spelled-out `Forfeit` take the same route**, since they are awarded the same
way. This extends the owner's instruction by analogy rather than by instruction. The three outcomes
stay distinct in the data, so a report can still say which happened.

**A match with no result printed at all is left unrecorded.** Five Seasons print `RT7 Win By 2` — the
match format — where a score belongs, and one prints nothing. The winner is known from advancement,
but the match was played and the score is simply lost. Recording it as a forfeit would assert a
forfeit that did not happen; inventing a score would assert frames nobody played. Both are worse
than an incomplete Season, so these stay incomplete.

## Who was in the draw

**A page whose results are `partial` may still settle its own field; a `contradictory` one may not.**
The completeness test required every match proven to the Final, which is a question about scores
being asked of a decision about people. A page that names all thirty-two players and happens not to
print one round-one score is no less certain about who entered. What matters is whether the page
disagrees with itself: contradictory winners mean the field cannot be trusted either. Six Seasons
were refused on the old rule.

**234 players were entered into 18 Seasons because the bracket seats them and the group table does
not.** The owner's account is that players changed their CueVerse ID mid-Season and the admins
updated the bracket without going back to the groups. Each Season was walked back to registration
once, the whole field added, and the group stage rebuilt from the manifest — the added players sit
outside the groups, which is what the source says.

## Identities

Of 494 names across the twenty draws, 62 needed an account. The rest resolved, or were somebody the
database already had under a different spelling. Three rules decided that, each requiring a unique
answer, because attaching a record to the wrong person is much harder to undo than merging two:

1. A Player already entered in **this Season** spelled within one or two characters.
2. Any existing account spelled within **exactly one** character.
3. Two bracket-only handles within one character of **each other**, folded onto the commoner one.

Notable saves: `Xx_APOCALIPSYS_xX` would have become a second account for the 2012 S4 champion, and
`au.stralian` for the 2013 S1 champion. `_Sugarhigh__` and `_Sugarhigh_` would have been two people.

**The resolver now matches a handle written with or without its separators** — `adam_buddy` against
`adambuddy`. The alias table already normalised that way and refused these as "already their CueVerse
ID", so the resolver was the only place still demanding the punctuation match, and four bracket
positions were unfillable with no alias able to fix them.

See [owner-identity-notes.md](owner-identity-notes.md) for the handles the owner identified by hand.

## Defects found and fixed on the way

- The annotated-forfeit pattern had lost every backslash — `/^s*(d{1,3})s*-s*(d{1,3})…/` — so a
  score written `0-3 (FF)` matched nothing and read as no result.
- The stray sweep asked the manifest whether an entrant's alias was recorded, when it should have
  asked the same set the direct test asks. That quietly undid the bracket exemption and would have
  deleted most of the 234 on the next run.
- The playoff importer read its bracket rows before reconciling the field, which drops the draft
  bracket. The stale non-empty list then skipped regeneration, and the seating check reported that
  the bracket disagreed with the page when the bracket was simply gone. Eleven Seasons stopped there.
- The coverage scan assumed every entry beside the year folders was a year folder, and crashed on a
  documentation file.
