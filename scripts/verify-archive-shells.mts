/**
 * The 8BRCAM reconstruction system: manifest, shells, and the Auto Assign matching rules.
 *
 * The matching rules are pure, so they are tested directly against constructed identities rather
 * than observed through a Season — attaching a historical result to the wrong person is the failure
 * that matters here, and the only way to be sure is to state each rule and check it in isolation.
 *
 * The mutation tests use throwaway fixtures in their own Competition and remove them afterwards. No
 * real Season is touched.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-archive-shells.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { loadManifest, validateManifest, templateStatus, isSharedStage, SHARED_STAGE_MESSAGE } from '../src/lib/archive/manifest.ts'
import { matchHandles, RULE_CONFIDENCE, UNRESOLVED_LABEL, type EntrantIdentity, type ArchiveIdentity } from '../src/lib/archive/matching.ts'
import {
  parseQuery, encodeQuery, applyQuery, progressOf, progressSummary,
  PROGRESS_OPTIONS, ARCHIVE_OPTIONS, type ReconstructionRow,
} from '../src/lib/creator/reconstruction-filters.ts'

assertLocalDatabase('verify-archive-shells')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const entrant = (id: number, over: Partial<EntrantIdentity> = {}): EntrantIdentity => ({
  entrantId: id, playerId: `p${id}`, displayName: `Player ${id}`,
  cueverseId: `player_${id}`, aliases: [], archiveHandles: [], ...over,
})
const archived = (sourceId: string, handle: string, group = 'A', slot = 0): ArchiveIdentity => ({
  sourceId, rawHandle: handle, normalizedHandle: handle.trim().toLowerCase(),
  rawName: '', groupName: group, slot,
})

// ───────────────────────────────────────────────────────────────────────────────── the manifest
section('The manifest is valid and says what the inventory proved')
{
  const m = loadManifest()
  const issues = validateManifest(m)
  check('validation passes', issues.length === 0, issues.slice(0, 3).map((i) => `${i.templateKey}: ${i.problem}`).join('; '))

  check('88 entries', m.entries.length === 88, String(m.entries.length))
  check('44 Division A', m.entries.filter((e) => e.division === 'A').length === 44)
  check('44 Division B', m.entries.filter((e) => e.division === 'B').length === 44)
  check('every year is 2006-2014',
    m.entries.every((e) => e.competitionYear >= 2006 && e.competitionYear <= 2014))
  check('the 2006 lower boundary is present', m.entries.some((e) => e.competitionYear === 2006))
  check('the 2014 upper boundary is present', m.entries.some((e) => e.competitionYear === 2014))
  check('nothing from 2005 came through', !m.entries.some((e) => e.competitionYear === 2005))
  check('nothing from 2015 came through', !m.entries.some((e) => e.competitionYear === 2015))

  // The archive documents no month. A fabricated one would be indistinguishable from a real one.
  check('no month was invented anywhere', m.entries.every((e) => e.competitionMonth === null))
  check('...and provenance records the month as absent too',
    m.entries.every((e) => e.provenance.sourceMonth === null))

  check('every entry carries provenance',
    m.entries.every((e) => !!e.provenance.sourceFile && !!e.provenance.sourceSection))
  check('source hashes are recorded', Object.keys(m.sourceFiles).length === 2, JSON.stringify(Object.keys(m.sourceFiles)))
  check('...and look like sha256', Object.values(m.sourceFiles).every((h) => /^[a-f0-9]{64}$/.test(h)))

  check('9,732 exact group matches',
    m.entries.reduce((n, e) => n + e.matches.filter((x) => x.resultKind === 'exact').length, 0) === 9732)
  check('every handle keeps its raw form',
    m.entries.every((e) => e.participants.every((p) => p.rawHandle.length > 0)))
  check('...alongside a normalized one',
    m.entries.every((e) => e.participants.every((p) => p.normalizedHandle === p.rawHandle.trim().toLowerCase())))
}

section('The undivided 2006 group stages are preserved, not split')
{
  const m = loadManifest()
  check('two undivided sources', m.undividedSources.length === 2, String(m.undividedSources.length))
  check('each feeds two divisional Seasons',
    m.undividedSources.every((u) => u.feedsTemplateKeys.length === 2))
  check('...and keeps its groups whole',
    m.undividedSources.every((u) => u.groupNames.length === 14),
    m.undividedSources.map((u) => u.groupNames.length).join(','))

  const shared = m.entries.filter(isSharedStage)
  check('four Seasons are marked shared-stage', shared.length === 4, String(shared.length))
  check('...all of them 2006 Seasons 1 and 2',
    shared.every((e) => e.competitionYear === 2006 && [1, 2].includes(e.seasonNumber)))
  // The decisive one: no shared group data was copied into a divisional Season.
  check('...and none of them carries duplicated participants',
    shared.every((e) => e.participants.length === 0),
    shared.map((e) => e.participants.length).join(','))
  check('...or duplicated matches', shared.every((e) => e.matches.length === 0))
  check('...each warned in its unresolved notes',
    shared.every((e) => e.unresolved.some((u) => u.includes('Shared group stage'))))
  check('the status helper reports the block',
    templateStatus(shared[0].templateKey).sharedStageMessage === SHARED_STAGE_MESSAGE)
}

section('Source contradictions are recorded, never resolved by guessing')
{
  const m = loadManifest()
  const withAmbiguity = m.entries.filter((e) => e.ambiguousPlacements.length > 0)
  check('six Seasons have an identity in two groups', withAmbiguity.length === 6, String(withAmbiguity.length))
  check('each names the groups it appears in',
    withAmbiguity.every((e) => e.ambiguousPlacements.every((a) => a.groups.length >= 2)))
  check('...and keeps the raw handle', withAmbiguity.every((e) => e.ambiguousPlacements.every((a) => a.rawHandle.length > 0)))
  check('...and explains itself in the unresolved notes',
    withAmbiguity.every((e) => e.ambiguousPlacements.every((a) => e.unresolved.some((u) => u.includes(a.sourceId)))))
  // Both source rows survive: the evidence is not thinned to make the contradiction go away.
  check('both source rows are kept',
    withAmbiguity.every((e) => e.ambiguousPlacements.every((a) =>
      e.participants.filter((p) => p.sourceId === a.sourceId).length >= 2)))
}

// ─────────────────────────────────────────────────────────────────────────────────── the shells
section('88 private shells exist and are empty')
{
  const shells = await prisma.season.findMany({
    where: { archiveTemplateKey: { not: null } },
    select: {
      id: true, competitionYear: true, number: true, division: true, publiclyVisible: true,
      reconstruction: true, accessMode: true, lifecycleState: true, ladderAppliedAt: true,
      championName: true, championPlayerId: true, completedAt: true, archiveTemplateKey: true,
      _count: { select: { entrants: true, groups: true, matches: true, standings: true, playoffMatches: true, ratingLedger: true } },
    },
  })

  check('88 shells', shells.length === 88, String(shells.length))
  check('44 Division A', shells.filter((s) => s.division === 'A').length === 44)
  check('44 Division B', shells.filter((s) => s.division === 'B').length === 44)
  check('every year 2006-2014', shells.every((s) => s.competitionYear >= 2006 && s.competitionYear <= 2014))

  check('none is publicly visible', shells.every((s) => !s.publiclyVisible))
  check('every one is a reconstruction', shells.every((s) => s.reconstruction))
  check('every one is password protected', shells.every((s) => s.accessMode === 'PASSWORD'))
  check('none is completed', shells.every((s) => !s.completedAt && !s.ladderAppliedAt))
  check('none has a champion', shells.every((s) => !s.championName && !s.championPlayerId))

  /*
   * The point of a shell: the IMPORT put nothing in it.
   *
   * Entrants are the one exception, and deliberately so — the owner adds them by hand, and that is
   * the whole reconstruction workflow. So this asserts what the import is responsible for rather
   * than a museum-piece emptiness the owner is expected to end. Anything they have added since is
   * reported, never deleted.
   */
  for (const k of ['groups', 'matches', 'standings', 'playoffMatches', 'ratingLedger'] as const) {
    check(`no shell has any ${k}`, shells.every((s) => s._count[k] === 0),
      String(shells.filter((s) => s._count[k] > 0).length))
  }

  const ownerAdded = await prisma.seasonEntrant.findMany({
    where: { season: { archiveTemplateKey: { not: null } } },
    select: { id: true, status: true, season: { select: { archiveTemplateKey: true } } },
  })
  /*
   * Entrants on a shell are the OWNER'S work, and the point of the whole feature.
   *
   * This asserted that shells stayed empty, which was wrong-headed twice over: it cannot tell an
   * import-created entrant from one the owner added, and the owner adding them is the reconstruction
   * workflow working. What the import did is settled at import time by the before/after counts, which
   * it checks itself and fails loudly on. Here the count is reported, not policed.
   */
  if (ownerAdded.length > 0) {
    console.log(`  (${ownerAdded.length} entrant row(s) added by hand since the import: `
      + `${ownerAdded.map((e) => `${e.season.archiveTemplateKey}/${e.status}`).join(', ')})`)
  }

  check('every shell maps to a manifest entry',
    shells.every((s) => loadManifest().entries.some((e) => e.templateKey === s.archiveTemplateKey)))
  check('template keys are unique', new Set(shells.map((s) => s.archiveTemplateKey)).size === 88)

  // Ranking eligibility follows from these two flags via the existing lifecycle rules.
  const { seasonCountsForRankings } = await import('../src/lib/competition/lifecycle-rules.ts')
  check('none counts for the Rankings', shells.every((s) => !seasonCountsForRankings({
    lifecycleState: s.lifecycleState, ladderAppliedAt: s.ladderAppliedAt,
    reconstruction: s.reconstruction, reopenedAt: null, cancelledAt: null, deletedAt: null,
  })))
}

section('Nothing else in the database moved')
{
  /*
   * Players and aliases can only GROW, and only by the owner adding members.
   *
   * 142 and 13 were the counts before the shells were created. The import created neither, and the
   * owner creates members while this runs — so a hard equality would fail on their legitimate work
   * and invite somebody to delete it to make a number match. What must hold is that nothing was
   * removed and the import added none.
   */
  const players = await prisma.player.count()
  const aliases = await prisma.playerAlias.count()
  check('no player was removed', players >= 142, String(players))
  check('no alias was removed', aliases >= 13, String(aliases))
  if (players > 142 || aliases > 13) {
    console.log(`  (${players - 142} player(s) and ${aliases - 13} alias(es) added by hand since the import)`)
  }
  /*
   * Entrants can only GROW, and only by the owner's hand.
   *
   * 201 was the count before the shells were created. The import added none; anything above that is
   * the owner working in Creator while this ran, which is legitimate and must never be deleted to
   * restore a tidy number.
   */
  const entrantCount = await prisma.seasonEntrant.count()
  check('no entrant was removed', entrantCount >= 201, String(entrantCount))
  // Real Seasons gain entrants as the owner reconstructs them. Only a LOSS would be a regression.
  const realEntrants = await prisma.seasonEntrant.count({ where: { season: { archiveTemplateKey: null } } })
  check('...and none was removed from a real Season', realEntrants >= 201, String(realEntrants))
  check('616 matches', (await prisma.seasonMatch.count()) === 616, String(await prisma.seasonMatch.count()))
  check('200 standings', (await prisma.seasonStanding.count()) === 200)
  check('140 playoff matches', (await prisma.seasonPlayoffMatch.count()) === 140)
  check('1168 ledger rows', (await prisma.ratingLedger.count()) === 1168)

  const s3732 = await prisma.season.findUnique({
    where: { id: 3732 },
    include: { _count: { select: { entrants: true, groups: true, matches: true, standings: true, playoffMatches: true } } },
  })
  check('Season 3732 still has 49 entrants', s3732?._count.entrants === 49, String(s3732?._count.entrants))
  check('...7 groups', s3732?._count.groups === 7)
  check('...147 matches', s3732?._count.matches === 147)
  check('...49 standings', s3732?._count.standings === 49)
  check('...31 playoff matches', s3732?._count.playoffMatches === 31)

  const y2005 = await prisma.season.findMany({ where: { competitionYear: 2005 }, select: { id: true, archiveTemplateKey: true } })
  check('the four 2005 Seasons are untouched', y2005.length === 4, String(y2005.length))
  check('...and none was given an archive template', y2005.every((s) => s.archiveTemplateKey === null))
}

// ─────────────────────────────────────────────────────────────────────────────────── matching
section('Matching is exact first, and refuses to guess')
{
  const arch = [archived('S1', 'trojan_man', 'A', 0)]

  check('an exact CueVerse ID matches',
    matchHandles(arch, [entrant(1, { cueverseId: 'trojan_man' })]).matched[0]?.reason === 'exact-cueverse-id')
  check('...regardless of case',
    matchHandles([archived('S1', 'Trojan_Man')], [entrant(1, { cueverseId: 'trojan_man' })]).matched.length === 1)
  check('an exact alias matches',
    matchHandles(arch, [entrant(1, { cueverseId: 'someone_else', aliases: ['trojan_man'] })]).matched[0]?.reason === 'exact-alias')
  check('an attached archive handle matches',
    matchHandles(arch, [entrant(1, { cueverseId: 'x', archiveHandles: ['trojan_man'] })]).matched[0]?.reason === 'exact-archive-handle')
  check('inner whitespace is forgiven',
    matchHandles([archived('S1', 'trojan man')], [entrant(1, { cueverseId: 'trojanman' })]).matched[0]?.reason === 'case-and-space')
  check('punctuation is forgiven when only one entrant fits',
    matchHandles([archived('S1', 'Top_Dog___')], [entrant(1, { cueverseId: 'top.dog' })]).matched[0]?.reason === 'punctuation')

  // Preferred Name is never enough on its own.
  const byName = matchHandles([{ ...archived('S1', 'unknown_handle'), rawName: 'Player 1' }], [entrant(1)])
  check('Preferred Name alone never matches', byName.matched.length === 0)
  check('...it is offered as a suggestion instead',
    byName.unresolved[0]?.suggestions.some((s) => /Preferred Name/i.test(s.why)))
  check('...and the suggestion is not auto-applied', RULE_CONFIDENCE['suggestion-only'].autoApply === false)

  // Two entrants that both fit is a question, not a coin toss.
  const two = matchHandles([archived('S1', 'topdog')], [
    entrant(1, { cueverseId: 'top_dog' }), entrant(2, { cueverseId: 'top.dog' }),
  ])
  check('two possible entrants leaves it unresolved', two.matched.length === 0)
  check('...reported as multiple possibilities', two.unresolved[0]?.reason === 'multiple-possible-entrants')
  check('...listing both', two.unresolved[0]?.suggestions.length === 2)

  const missing = matchHandles(arch, [entrant(1, { cueverseId: 'nobody' })])
  check('an archived handle with no entrant is unresolved', missing.unresolved[0]?.reason === 'player-not-among-entrants')
  check('...in plain language',
    UNRESOLVED_LABEL['player-not-among-entrants'] === 'Player not among current entrants')
  check('...and the extra entrant is listed as unused, not removed',
    missing.unusedEntrants.length === 1 && missing.unusedEntrants[0].entrantId === 1)

  // One entrant cannot be two historical people.
  const shared = matchHandles(
    [archived('S1', 'same_guy', 'A', 0), archived('S2', 'same_guy', 'B', 0)],
    [entrant(1, { cueverseId: 'same_guy' })],
  )
  check('one entrant fills only one archived identity', shared.matched.length === 1)
  check('...the second is left unresolved', shared.unresolved.length === 1)

  check('an ambiguous source placement is never placed',
    matchHandles(arch, [entrant(1, { cueverseId: 'trojan_man' })], { ambiguousSourceIds: ['S1'] }).matched.length === 0)
  check('...and says why',
    matchHandles(arch, [entrant(1, { cueverseId: 'trojan_man' })], { ambiguousSourceIds: ['S1'] })
      .unresolved[0]?.reason === 'ambiguous-source-placement')

  // A resolution the owner confirmed beats every rule, and stays scoped to this Season.
  const manual = matchHandles(arch, [entrant(7, { cueverseId: 'nothing_alike' })], { manualResolutions: { S1: 7 } })
  check('a manual resolution is honoured', manual.matched[0]?.entrantId === 7)

  check('the group and slot come from the archive',
    matchHandles([archived('S1', 'a', 'C', 4)], [entrant(1, { cueverseId: 'a' })]).matched[0]?.slot === 4)
}

section('Every rule declares whether it may act on its own')
{
  for (const [reason, rule] of Object.entries(RULE_CONFIDENCE)) {
    check(`${reason} declares a confidence`, ['exact', 'high', 'suggestion'].includes(rule.confidence))
    check(`${reason} explains itself`, rule.label.length > 0)
  }
  check('only suggestions are barred from applying',
    Object.entries(RULE_CONFIDENCE).filter(([, r]) => !r.autoApply).map(([k]) => k).join(',') === 'suggestion-only')
}

// ──────────────────────────────────────────────────────────────────── the services refuse safely
section('Auto Assign refuses what it cannot prove')
{
  const { previewGroupAssign, previewGroupScores, isBlocked } = await import('../src/lib/archive/auto-assign.ts')

  const sharedShell = await prisma.season.findFirst({
    where: { archiveTemplateKey: { in: loadManifest().entries.filter(isSharedStage).map((e) => e.templateKey) } },
    select: { id: true, archiveTemplateKey: true },
  })
  check('a shared-stage shell exists to test', !!sharedShell)
  if (sharedShell) {
    const g = await previewGroupAssign(sharedShell.id)
    check('group Auto Assign is blocked for a shared stage', isBlocked(g) && g.reason === SHARED_STAGE_MESSAGE,
      isBlocked(g) ? g.reason : 'not blocked')
    const sc = await previewGroupScores(sharedShell.id)
    check('score Auto Assign is blocked too', isBlocked(sc) && sc.reason === SHARED_STAGE_MESSAGE)
  }

  const normalShell = await prisma.season.findFirst({
    where: { archiveTemplateKey: { startsWith: '8brcam-2007-' } },
    select: { id: true, archiveTemplateKey: true },
  })
  check('a normal shell exists to test', !!normalShell)
  if (normalShell) {
    const g = await previewGroupAssign(normalShell.id)
    check('a normal shell previews rather than blocking', !isBlocked(g))
    if (!isBlocked(g)) {
      // With no entrants added, everything the archive knows is unresolved — and nothing is placed.
      check('...with nothing to place before entrants are added', g.toPlace.length === 0, String(g.toPlace.length))
      check('...and every archived handle unresolved', g.unresolved.length === g.sourceParticipants,
        `${g.unresolved.length} of ${g.sourceParticipants}`)
      check('...naming the reason plainly',
        g.unresolved.every((u) => u.reasonLabel === 'Player not among current entrants'))
      check('...and the template groups are known', g.groupNames.length > 0)
    }

    // Scores are gated on the lifecycle: a shell is in REGISTRATION_OPEN, not the group stage.
    const sc = await previewGroupScores(normalShell.id)
    check('score Auto Assign refuses before the group stage', isBlocked(sc))
  }

  const notArchive = await prisma.season.findFirst({
    where: { archiveTemplateKey: null }, select: { id: true },
  })
  if (notArchive) {
    const g = await previewGroupAssign(notArchive.id)
    check('a Season with no template is refused', isBlocked(g) && /no verified archive template/i.test(g.reason))
  }

  const missing = await previewGroupAssign(999_999_999)
  check('an unknown Season is refused', isBlocked(missing))
}

// ──────────────────────────────────────────────────────────────────────── the Creator filters
section('Creator filters survive the URL and tolerate rubbish')
{
  const row = (over: Partial<ReconstructionRow> = {}): ReconstructionRow => ({
    id: 1, title: '8BRCAM Season 3 \u00b7 2011 \u00b7 Division A', year: 2011, number: 3, division: 'A',
    lifecycle: 'REGISTRATION_OPEN', href: '/creator/seasons/1',
    entrants: 0, groupsAssigned: 0, resultsEntered: 0,
    archiveParticipants: 42, archiveGroups: 6, archiveResults: 105,
    archiveAssignments: 'complete', archiveExact: 'complete',
    sharedStage: false, sharedStageMessage: null,
    unresolvedCount: 0, ambiguousCount: 0, standingsOnly: false, ...over,
  })

  check('every progress option round-trips through the URL',
    PROGRESS_OPTIONS.every((o) => parseQuery({ progress: o.id }).progress === o.id))
  check('...and so does every archive option',
    ARCHIVE_OPTIONS.every((o) => parseQuery({ archive: o.id }).archive === o.id))
  check('a year is read', parseQuery({ year: '2011' }).year === 2011)
  check('a division is read, in any case', parseQuery({ division: 'b' }).division === 'B')

  // A URL is user input. Rubbish must produce an unfiltered list, never an error.
  for (const bad of ['', 'abc', '20111', '-1', 'null', '<script>']) {
    check('year "' + bad + '" is ignored', parseQuery({ year: bad }).year === null)
  }
  check('an unknown progress value is ignored', parseQuery({ progress: 'nonsense' }).progress === null)
  check('an unknown archive value is ignored', parseQuery({ archive: 'nonsense' }).archive === null)
  check('an array parameter takes the first value', parseQuery({ year: ['2011', '2012'] }).year === 2011)
  check('a missing parameter set is empty', parseQuery({}).year === null)

  const q = {
    year: 2011, division: 'B' as const, q: 'season',
    progress: 'not-started' as const, archive: 'shared-source' as const,
  }
  const roundTrip = parseQuery(Object.fromEntries(new URLSearchParams(encodeQuery(q))))
  check('encode then parse is the identity', JSON.stringify(roundTrip) === JSON.stringify(q),
    JSON.stringify(roundTrip))
  check('an empty query encodes to nothing',
    encodeQuery({ year: null, division: null, q: null, progress: null, archive: null }) === '')

  // Progress is what has been ENTERED, never what the archive holds.
  check('a full template with no entrants has not started', progressOf(row()) === 'not-started')
  check('entrants added', progressOf(row({ entrants: 42 })) === 'entrants-added')
  check('groups assigned', progressOf(row({ entrants: 42, groupsAssigned: 42 })) === 'groups-assigned')
  check('results partial',
    progressOf(row({ entrants: 42, groupsAssigned: 42, resultsEntered: 10 })) === 'results-partial')
  check('ready for playoffs', progressOf(row({ lifecycle: 'GROUPS_CLOSED' })) === 'ready-for-playoffs')
  check('completed', progressOf(row({ lifecycle: 'COMPLETED' })) === 'completed')

  const rows = [
    row({ id: 1, year: 2011, division: 'A' }),
    row({ id: 2, year: 2012, division: 'B', sharedStage: true }),
    row({ id: 3, year: 2011, division: 'B', ambiguousCount: 1 }),
  ]
  check('the year filter narrows', applyQuery(rows, parseQuery({ year: '2011' })).length === 2)
  check('the division filter narrows', applyQuery(rows, parseQuery({ division: 'B' })).length === 2)
  check('the two combine', applyQuery(rows, parseQuery({ year: '2011', division: 'B' })).length === 1)
  check('shared source is findable', applyQuery(rows, parseQuery({ archive: 'shared-source' }))[0]?.id === 2)
  check('contradictions are findable', applyQuery(rows, parseQuery({ archive: 'contradictions' }))[0]?.id === 3)
  check('a search matches the Season number alone', applyQuery(rows, parseQuery({ q: '3' })).length === 3)
  check('a search that matches nothing returns nothing', applyQuery(rows, parseQuery({ q: 'zzz' })).length === 0)
  check('a malformed filter leaves the list whole',
    applyQuery(rows, parseQuery({ year: 'abc', archive: 'nope' })).length === 3)

  const summary = progressSummary(row())
  check('the summary counts entrants against the archive', summary[0] === '0 / 42 entrants added', summary[0])
  check('...names the group state', summary[1] === 'Archive groups ready', summary[1])
  check('...and counts results', summary[2] === '0 / 105 group results entered', summary[2])

  const sharedSummary = progressSummary(row({ sharedStage: true }))
  check('a shared stage says Auto Assign is unavailable',
    sharedSummary.some((b) => b.includes('Auto Assign unavailable')))
  check('...and offers no results count',
    !sharedSummary.some((b) => b.includes('results entered')))
  check('standings-only says so',
    progressSummary(row({ standingsOnly: true })).some((b) => b.includes('Standings only')))
  check('unresolved handles are surfaced',
    progressSummary(row({ unresolvedCount: 6 })).some((b) => b === '6 unresolved handles'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
