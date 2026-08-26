/**
 * Decide whether an archived bracket page may be treated as the record of who entered a playoff.
 *
 * ── Why a page can outrank the manifest ──────────────────────────────────────────────────────────
 * The manifest's playoff list is a roster of who qualified. The bracket page is a drawing of who was
 * actually in the draw. Those are different facts, and they disagree: 2008 S5A's manifest names 24
 * qualifiers where the page seats 20. Someone who qualified and then did not appear anywhere in a
 * complete bracket did not enter it.
 *
 * ── But only when the page proves the whole field ────────────────────────────────────────────────
 * That reasoning only holds if the page shows the entire entry field. On a truncated page an absent
 * handle means the capture is short, not that the player was absent, and deselecting them would
 * erase a real qualification on the strength of a gap in a screenshot. So the precedence rule is
 * gated on a page being structurally whole: a valid size, every entry slot accounted for, an
 * untruncated round 1, a winner chain that fits the topology, and a Final that produces the champion
 * the page names.
 *
 * A carried-forward name is never counted as an entrant. It is the bracket showing where somebody
 * went, not a twenty-first person appearing in a twenty-place draw.
 */
import type { WaybackBracket } from './wayback'

export interface CompletenessResult {
  complete: boolean
  /** Every condition, so a refusal can say exactly which one failed. */
  conditions: { name: string; ok: boolean; detail?: string }[]
  failed: string[]
  /** The handles occupying a real entry position — the field the page proves. */
  entryHandles: string[]
  byeSlots: number
  emptySlots: number
}

/**
 * Is this page a complete record of the entry field?
 *
 * Deliberately strict. Every condition below has to hold before the page is allowed to overrule the
 * manifest about who entered, because the consequence of being wrong is removing somebody from a
 * playoff they were really in.
 */
export function assessFieldCompleteness(
  bracket: WaybackBracket,
  expected: { competitionYear: number; seasonNumber: number; division: string | null },
): CompletenessResult {
  const conditions: { name: string; ok: boolean; detail?: string }[] = []
  const add = (name: string, ok: boolean, detail?: string) => conditions.push({ name, ok, detail })

  const round1 = bracket.matches.filter((m) => m.round === 1)
  const slots = round1.flatMap((m) => [m.home, m.away])
  const named = slots.filter((s) => s && !s.bye)
  const byes = slots.filter((s) => s?.bye).length
  const empty = slots.filter((s) => !s).length

  const size = bracket.bracketSize
  add('the bracket size is a valid power of two of at least four',
    size >= 4 && Number.isInteger(Math.log2(size)), String(size))
  add('round 1 holds exactly one slot per bracket place',
    slots.length === size, `${slots.length} of ${size}`)
  add('every entry slot is a player, a bye or a structural gap',
    named.length + byes + empty === size, `${named.length} named, ${byes} byes, ${empty} empty`)
  add('round 1 is not truncated', round1.length === size / 2, `${round1.length} of ${size / 2}`)

  const handles = named.map((s) => s!.normalizedHandle.toLowerCase())
  add('every entry handle resolves to one name', new Set(handles).size === handles.length,
    `${handles.length} slots, ${new Set(handles).size} distinct`)
  add('no entry handle is blank', named.every((s) => s!.normalizedHandle.trim().length > 0))

  /*
   * A carried-forward name must already be an entrant.
   *
   * If a later round shows somebody who never occupied an entry position, the page is either
   * truncated or the columns have been misread — either way it is not a whole field.
   */
  const laterNames = bracket.matches
    .filter((m) => m.round > 1)
    .flatMap((m) => [m.home, m.away])
    .filter((s): s is NonNullable<typeof s> => Boolean(s) && !s!.bye)
    .map((s) => s.normalizedHandle.toLowerCase())
  const strangers = [...new Set(laterNames)].filter((h) => !handles.includes(h))
  add('no later-round name is absent from the entry field', strangers.length === 0, strangers.slice(0, 5).join(', '))

  add('the winner chain fits the bracket', bracket.validation.category !== 'contradictory',
    bracket.validation.problems.slice(0, 2).join('; '))
  /*
   * The results must be trustworthy, not complete.
   *
   * This asked for `full` — every match proven all the way to the Final — which is a question about
   * scores, and the thing being decided here is who was in the draw. A page that names all thirty-two
   * players and happens not to print one round-one score is no less certain about its field, and six
   * Seasons were refused on that alone.
   *
   * `partial` is therefore allowed and `contradictory` is not. The distinction is whether the page
   * disagrees with itself: a page whose winners do not follow from its own scores may have the wrong
   * people in it, and its field cannot be trusted to overrule anything.
   */
  add('the results do not contradict the page',
    bracket.validation.category === 'full' || bracket.validation.category === 'partial',
    bracket.validation.category)
  add('the Final produces the champion the page names', Boolean(bracket.champion))
  add('the page is the right Season',
    bracket.competitionYear === expected.competitionYear &&
    bracket.seasonNumber === expected.seasonNumber &&
    (expected.division ?? 'A') === 'A' && bracket.division === 'A',
    `${bracket.competitionYear} S${bracket.seasonNumber}${bracket.division} vs ${expected.competitionYear} S${expected.seasonNumber}${expected.division ?? ''}`)

  const failed = conditions.filter((c) => !c.ok).map((c) => c.name)
  return {
    complete: failed.length === 0,
    conditions,
    failed,
    entryHandles: named.map((s) => s!.normalizedHandle),
    byeSlots: byes,
    emptySlots: empty,
  }
}
