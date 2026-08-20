/**
 * The two new archive-assisted steps: Auto Add Entrants and Build Playoff Bracket.
 *
 * Both reuse the matching engine and the preview/apply shape that group assignment already proved,
 * so this checks what is genuinely NEW: that the playoff manifest distinguishes documented placement
 * from the archive viewer's own guess, that neither action creates a person, and that Build Playoff
 * Bracket stops at PLAYOFF_SETUP.
 *
 * Mutating checks run on a throwaway Season in a fixture Competition and clean up after themselves.
 * No real Season is touched.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-archive-entrants-playoffs.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { loadManifest } from '../src/lib/archive/manifest.ts'
import { matchHandles, type EntrantIdentity } from '../src/lib/archive/matching.ts'

assertLocalDatabase('verify-archive-entrants-playoffs')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

// ────────────────────────────────────────────────────────────────── the playoff manifest
section('The playoff manifest separates what is documented from what is guessed')
{
  const m = loadManifest()
  const withPlayoff = m.entries.filter((e) => e.playoff)
  check('every entry carries a playoff record', withPlayoff.length === 88, String(withPlayoff.length))

  const exact = m.entries.filter((e) => e.playoff.placement === 'exact')
  const partsOnly = m.entries.filter((e) => e.playoff.placement === 'participants-only')
  const none = m.entries.filter((e) => e.playoff.placement === 'none')
  console.log(`  (exact ${exact.length}, participants-only ${partsOnly.length}, none ${none.length})`)
  check('every Season is classified', exact.length + partsOnly.length + none.length === 88)
  check('some Seasons have exact placement', exact.length > 0)
  check('most do not', partsOnly.length > exact.length)

  /*
   * The distinction that protects the data.
   *
   * The archive gives 'seeds' for every Season, but for two thirds of them that is its own
   * occurrence-count heuristic rather than a recorded order. Carrying those through as placement
   * would put players in slots nobody wrote down.
   */
  check('an exact Season is exactly what the source called exact',
    exact.every((e) => e.playoff.sourceConfidence === 'exact'))
  check('a participants-only Season carries NO seeds',
    partsOnly.every((e) => e.playoff.participants.every((p) => p.seed === null)))
  check('...no slots', partsOnly.every((e) => e.playoff.participants.every((p) => p.matchNo === null && p.side === null)))
  check('...no byes', partsOnly.every((e) => e.playoff.participants.every((p) => !p.bye)))
  check('...and no bracket size', partsOnly.every((e) => e.playoff.bracketSize === null))
  check('...but it does list who played', partsOnly.every((e) => e.playoff.participants.length > 0))
  check('...and says so in its unresolved notes',
    partsOnly.every((e) => e.playoff.unresolved.some((u) => /no bracket placement/i.test(u))))

  check('an exact Season has a bracket size', exact.every((e) => (e.playoff.bracketSize ?? 0) > 0))
  check('...which is a power of two',
    exact.every((e) => Number.isInteger(Math.log2(e.playoff.bracketSize ?? 0))),
    exact.map((e) => e.playoff.bracketSize).join(','))
  check('...and at least as large as its field',
    exact.every((e) => (e.playoff.bracketSize ?? 0) >= e.playoff.participants.length))
  check('...with a slot for every first-round player',
    exact.every((e) => e.playoff.participants.filter((p) => p.firstRound === 1).every((p) => p.matchNo != null && p.side != null)))

  const later = exact.flatMap((e) => e.playoff.participants.filter((p) => p.firstRound > 1))
  const byes = exact.flatMap((e) => e.playoff.participants.filter((p) => p.bye))
  console.log(`  (${byes.length} bye(s) and ${later.length} later-round start(s) across the exact Seasons)`)
  check('every exact participant is either placed in round 1 or recorded as starting later',
    exact.every((e) => e.playoff.participants.every((p) =>
      (p.firstRound === 1 && p.matchNo != null && p.side != null) || p.firstRound > 1)))
  check('a bye is a round-1 player with nobody opposite', byes.every((p) => p.firstRound === 1 && p.side != null))
  check('byes never leak onto a participants-only Season',
    partsOnly.every((e) => e.playoff.participants.every((p) => !p.bye)))

  check('handles are kept raw as well as normalized',
    m.entries.every((e) => e.playoff.participants.every((p) => p.normalizedHandle === p.rawHandle.trim().toLowerCase())))

  /*
   * 21 of the 22, not all 22.
   *
   * The archive's 2013 Season 4 Division B bracket is exact in shape but its final was never
   * recorded — round 5 has both slots empty. That is a gap in the source, not in the manifest, so
   * the champion stays null rather than being inferred from who survived round 4. The count is
   * pinned so a rebuild that silently dropped a champion would still be caught.
   */
  const champions = exact.filter((e) => e.playoff.championSourceId != null)
  check('21 of the 22 exact Seasons name a champion', champions.length === 21, String(champions.length))
  check('...and the one that does not is the Season whose final was never played',
    exact.filter((e) => e.playoff.championSourceId == null).every((e) => e.templateKey === '8brcam-2013-s4-b'))
  check('a champion is always one of that Season’s own participants',
    champions.every((e) => e.playoff.participants.some((p) => p.sourceId === e.playoff.championSourceId)))
}

// ─────────────────────────────────────────────────────────── matching, as used by both actions
section('Matching for entrants behaves as the group step does')
{
  const player = (id: number, over: Partial<EntrantIdentity> = {}): EntrantIdentity => ({
    entrantId: id, playerId: `p${id}`, displayName: `Player ${id}`,
    cueverseId: `player_${id}`, aliases: [], archiveHandles: [], ...over,
  })
  const archived = (sourceId: string, handle: string) => ({
    sourceId, rawHandle: handle, normalizedHandle: handle.trim().toLowerCase(),
    rawName: '', groupName: '-', slot: 0,
  })

  check('an exact CueVerse ID matches',
    matchHandles([archived('S1', 'trojan_man')], [player(1, { cueverseId: 'trojan_man' })])
      .matched[0]?.reason === 'exact-cueverse-id')
  check('an exact alias matches',
    matchHandles([archived('S1', 'trojan_man')], [player(1, { cueverseId: 'x', aliases: ['trojan_man'] })])
      .matched[0]?.reason === 'exact-alias')
  check('an attached archive handle matches',
    matchHandles([archived('S1', 'trojan_man')], [player(1, { cueverseId: 'x', archiveHandles: ['trojan_man'] })])
      .matched[0]?.reason === 'exact-archive-handle')
  check('case and spacing are forgiven',
    matchHandles([archived('S1', 'Trojan Man')], [player(1, { cueverseId: 'trojanman' })]).matched.length === 1)
  check('punctuation is forgiven when only one account fits',
    matchHandles([archived('S1', 'Top_Dog___')], [player(1, { cueverseId: 'top.dog' })])
      .matched[0]?.reason === 'punctuation')

  const two = matchHandles([archived('S1', 'topdog')], [
    player(1, { cueverseId: 'top_dog' }), player(2, { cueverseId: 'top.dog' }),
  ])
  check('two candidates leaves it ambiguous, not guessed', two.matched.length === 0)
  check('...and both are offered', two.unresolved[0]?.suggestions.length === 2)

  const missing = matchHandles([archived('S1', 'nobody_here')], [player(1)])
  check('a handle with no account is unresolved', missing.unresolved.length === 1)
  check('...and the exact archived handle is preserved for the report',
    missing.unresolved[0]?.rawHandle === 'nobody_here')

  // Preferred Name alone must never create an entrant.
  const byName = matchHandles(
    [{ ...archived('S1', 'unknown_handle'), rawName: 'Player 1' }],
    [player(1)],
  )
  check('Preferred Name alone never matches', byName.matched.length === 0)
  check('...it is only a suggestion', byName.unresolved[0]?.suggestions.some((s) => /Preferred Name/i.test(s.why)))
}

// ────────────────────────────────────────────────────────── the services, against real Seasons
section('The services refuse what they cannot prove')
{
  const { previewAutoEntrants, autoEntrantsAvailability } = await import('../src/lib/archive/auto-entrants.ts')
  const { previewPlayoffBracket, playoffBracketAvailability } = await import('../src/lib/archive/auto-playoffs.ts')
  const { isBlocked } = await import('../src/lib/archive/auto-assign.ts')

  const noTemplate = await prisma.season.findFirst({ where: { archiveTemplateKey: null }, select: { id: true } })
  if (noTemplate) {
    const e = await previewAutoEntrants(noTemplate.id)
    check('a Season with no archive template is refused for entrants', isBlocked(e))
    const p = await previewPlayoffBracket(noTemplate.id)
    check('...and for the bracket', isBlocked(p))
    const av = await autoEntrantsAvailability(noTemplate.id)
    check('...and the button is not drawn', av.show === false)
  }

  check('an unknown Season is refused', isBlocked(await previewAutoEntrants(999_999_999)))
  check('...for the bracket too', isBlocked(await previewPlayoffBracket(999_999_999)))

  // A shell in registration: entrants may be added, the bracket may not.
  const open = await prisma.season.findFirst({
    where: { archiveTemplateKey: { not: null }, lifecycleState: 'REGISTRATION_OPEN' },
    select: { id: true },
  })
  if (open) {
    const e = await previewAutoEntrants(open.id)
    check('a Season taking entrants previews them', !isBlocked(e))
    if (!isBlocked(e)) {
      check('...against the whole archived field', e.sourceParticipants > 0, String(e.sourceParticipants))
      check('...reporting every handle with no account', Array.isArray(e.missing))
      check('...and never proposing to create anybody',
        e.toAdd.every((a) => typeof a.playerId === 'string' && a.playerId.length > 0))
    }
    const p = await previewPlayoffBracket(open.id)
    check('the bracket is refused before playoff setup', isBlocked(p))
    check('...saying why', isBlocked(p) && /playoff setup|group stage/i.test(p.reason), isBlocked(p) ? p.reason : '')
    const av = await playoffBracketAvailability(open.id)
    check('...and the bracket button is not drawn', av.show === false)
  }

  // A completed Season: neither action may touch it.
  const done = await prisma.season.findFirst({
    where: { archiveTemplateKey: { not: null }, lifecycleState: 'COMPLETED' },
    select: { id: true },
  })
  if (done) {
    check('a completed Season refuses new entrants', isBlocked(await previewAutoEntrants(done.id)))
    const p = await previewPlayoffBracket(done.id)
    check('...and refuses a rebuilt bracket', isBlocked(p))
    check('...because the playoffs already ran',
      isBlocked(p) && /already started|playoff setup/i.test(p.reason), isBlocked(p) ? p.reason : '')
  }
}

// ───────────────────────────────────────────────────────────────────── nothing was created
section('Neither action creates a person, and Season 3732 is untouched')
{
  const players = await prisma.player.count()
  const aliases = await prisma.playerAlias.count()
  console.log(`  (${players} players, ${aliases} aliases — previews only, nothing applied)`)
  check('players still exist', players > 0)
  check('aliases still exist', aliases > 0)

  const s = await prisma.season.findUnique({
    where: { id: 3732 },
    include: { _count: { select: { entrants: true, groups: true, matches: true, standings: true, playoffMatches: true } } },
  })
  check('Season 3732 still has 49 entrants', s?._count.entrants === 49, String(s?._count.entrants))
  check('...7 groups', s?._count.groups === 7)
  check('...147 matches', s?._count.matches === 147)
  check('...and 31 playoff matches', s?._count.playoffMatches === 31)

  // The 2006 blocking rules are untouched by this work.
  const shared = loadManifest().entries.filter((e) => e.sharedGroupStageSourceKey)
  check('four Seasons still carry the shared-stage marker', shared.length === 4, String(shared.length))
  check('...and still hold no group participants of their own',
    shared.every((e) => e.participants.length === 0))
  /*
   * Adding entrants is NOT blocked for those four.
   *
   * The shared-stage block exists so one set of group RESULTS is not applied to both divisions.
   * Entering people creates no result and duplicates nothing, and those Seasons need their entrants
   * more than any others.
   */
  const sharedShell = await prisma.season.findFirst({
    where: { archiveTemplateKey: { in: shared.map((e) => e.templateKey) }, lifecycleState: 'REGISTRATION_OPEN' },
    select: { id: true },
  })
  if (sharedShell) {
    const { autoEntrantsAvailability } = await import('../src/lib/archive/auto-entrants.ts')
    const av = await autoEntrantsAvailability(sharedShell.id)
    check('a shared-stage Season may still add entrants', av.show === true && av.disabledReason === null)
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
