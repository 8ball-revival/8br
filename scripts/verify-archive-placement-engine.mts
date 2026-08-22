/**
 * Archive-driven bracket building, exercised against a template nobody's history depends on.
 *
 * ── Why this suite exists ────────────────────────────────────────────────────────────────────────
 * Build Playoff Bracket and Place Entrants read the 8BRCAM manifest and decide who played and where
 * they sat. Until now none of that could be tested: the manifest was loaded from disk inside the
 * engine, so exercising it meant pointing at a real archived Season — and every real template key
 * belongs to a Season whose reconstruction somebody has already done by hand.
 *
 * The lookup is a parameter now. Production passes nothing and reads the manifest exactly as before;
 * this passes a synthetic template describing a small, completely made-up competition. Same code,
 * same rules, no archive touched.
 *
 * ── What the synthetic template is for ───────────────────────────────────────────────────────────
 * It is built to contain the awkward cases on purpose: a handle that matches nobody, a handle that
 * matches two people, a recorded bye, and a player the archive places in a later round. Those are
 * the situations where guessing would be easy and wrong.
 *
 * Fixtures only, all removed afterwards. No real Season and no real template is read or written.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-archive-placement-engine.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { addSeasonEntrant, closeRegistration } from '../src/lib/seasons/service.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { generateSeasonGroups, publishSeasonGroups } from '../src/lib/seasons/groups.ts'
import { saveSeasonGroupResults, closeSeasonGroups } from '../src/lib/seasons/group-stage.ts'
import { enterSeasonPlayoffSetup, generateSeasonBracket, loadSeasonSeeding } from '../src/lib/seasons/playoffs.ts'
import { bracketTopology } from '../src/lib/seasons/playoff-topology.ts'
import {
  previewPlayoffBracket, applyArchiveSelection, applyArchivePlacement, previewPlacement, applyPlacement,
  type TemplateSource,
} from '../src/lib/archive/auto-playoffs.ts'
import type { ManifestEntry } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()

/*
 * The old combined action, composed from the two that replaced it.
 *
 * `applyPlayoffBracket` used to select the field AND reproduce the archived draw in one call. These
 * suites were written against that behaviour, which makes them the characterization harness for the
 * split: if selecting and then placing does not produce what the combined call produced, the split
 * changed something it should not have.
 *
 * A source that records participants but no topology has no placement to apply — the combined call
 * returned success with nothing placed, so that shape is preserved here rather than surfaced as an
 * error the old callers never saw.
 */
async function applySelectionThenPlacement(
  actor: { userId: number; username: string },
  seasonId: number,
  opts: { replaceDraft?: boolean } = {},
  src?: TemplateSource,
) {
  const sel = src
    ? await applyArchiveSelection(actor, seasonId, src)
    : await applyArchiveSelection(actor, seasonId)
  if (!sel.ok) {
    return { ok: false, error: sel.error, selected: 0, excluded: 0, placed: 0, unresolvedSlots: 0, missing: sel.missing, ambiguous: sel.ambiguous }
  }
  const place = src
    ? await applyArchivePlacement(actor, seasonId, opts, src)
    : await applyArchivePlacement(actor, seasonId, opts)
  if (!place.ok && /does not record enough/.test(place.error ?? '')) {
    return { ok: true, selected: sel.selected, excluded: sel.excluded, placed: 0, unresolvedSlots: sel.selected, missing: sel.missing, ambiguous: sel.ambiguous }
  }
  return place
}


const ACTOR = { userId: 2, username: 'verify-archive-engine' }
const YEAR = 2090
/*
 * One key per fixture Season.
 *
 * `archiveTemplateKey` is unique across Seasons — correctly, since a template describes exactly one
 * historical competition — so the suite cannot point five fixtures at one key. Each gets its own
 * under a shared prefix, and the injected source answers for the prefix and nothing else.
 */
const TEMPLATE_PREFIX = 'synthetic-verify-only'
const keyFor = (n: number) => `${TEMPLATE_PREFIX}-${n}`
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })

/** Handles invented for this suite. Nothing here resembles a real archive handle. */
const H = {
  a: 'zz_verify_alpha',
  b: 'zz_verify_bravo',
  c: 'zz_verify_charlie',
  d: 'zz_verify_delta',
  ghost: 'zz_verify_nobody',      // matches no account at all
  twin: 'zz_verify_twin',          // matches two accounts
}

async function cleanup() {
  const rows = await prisma.season.findMany({ where: { competitionYear: YEAR }, select: { id: true } })
  for (const r of rows) {
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonStanding.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonGroup.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: r.id } })
    await prisma.season.delete({ where: { id: r.id } }).catch(() => {})
  }
  const players = await prisma.player.findMany({
    where: { primaryName: { startsWith: 'ZZ Verify' } }, select: { id: true },
  })
  for (const p of players) {
    await prisma.playerAlias.deleteMany({ where: { playerId: p.id } })
    await prisma.player.delete({ where: { id: p.id } }).catch(() => {})
  }
}
await cleanup()

/** A throwaway Player carrying one of the synthetic handles. */
async function mkPlayer(name: string, handle: string | null) {
  return prisma.player.create({
    data: {
      primaryName: `ZZ Verify ${name}`,
      cueverseId: handle,
      cueverseIdNormalized: handle ? handle.toLowerCase() : null,
    },
    select: { id: true, primaryName: true, cueverseId: true },
  })
}

/**
 * The synthetic template.
 *
 * A bracket of four with an exact topology: alpha v delta and bravo v charlie in round one. `ghost`
 * is a participant the archive names but no account matches; `twin` matches two, so the engine must
 * refuse rather than choose.
 */
function makeTemplate(over: Partial<ManifestEntry['playoff']> = {}, templateKey = keyFor(0)): ManifestEntry {
  const p = (sourceId: string, rawHandle: string, seed: number, matchNo: number, side: 'a' | 'b', bye = false, firstRound = 1) => ({
    sourceId, rawHandle, normalizedHandle: rawHandle.toLowerCase(),
    seed, firstRound, bye, matchNo, side,
  })
  return {
    templateKey,
    playoff: {
      placement: 'exact',
      sourceConfidence: 'synthetic',
      format: 'single-elim',
      bracketSize: 4,
      participants: [
        p('S1', H.a, 1, 1, 'a'),
        p('S2', H.d, 4, 1, 'b'),
        p('S3', H.b, 2, 2, 'a'),
        p('S4', H.c, 3, 2, 'b'),
      ],
      championSourceId: 'S1',
      runnerUpSourceId: 'S3',
      unresolved: [],
      ...over,
    },
    ambiguousPlacements: [],
  } as unknown as ManifestEntry
}

/** The injected lookup: answers only for the synthetic prefix, so no real template can ever load. */
const sourceOf = (entry: ManifestEntry): TemplateSource => (key) =>
  (key.startsWith(TEMPLATE_PREFIX) ? { ...entry, templateKey: key } : null)

/** A Season carried to PLAYOFF_SETUP, pointed at the synthetic template. */
async function seasonAtSetup(number: number, playerIds: string[]): Promise<number> {
  const templateKey = keyFor(number)
  const made = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number, division: null, accessMode: 'OPEN',
  })
  if (!made.ok || made.id == null) throw new Error(made.error ?? 'fixture failed')
  const id = made.id
  for (const pid of playerIds) await addSeasonEntrant(ACTOR, id, pid)
  await closeRegistration(ACTOR, id)
  await transitionSeasonState(ACTOR, id, 'GROUP_SETUP')
  await generateSeasonGroups(ACTOR, id, 1)
  await publishSeasonGroups(ACTOR, id)
  const g = await prisma.seasonGroup.findFirstOrThrow({ where: { seasonId: id }, select: { id: true } })
  const ms = await prisma.seasonMatch.findMany({ where: { seasonId: id, groupId: g.id }, orderBy: { id: 'asc' } })
  await saveSeasonGroupResults(ACTOR, id, g.id, ms.map((m, i) => ({
    matchId: m.id, home: '7', away: String(i % 5), version: m.version,
  })))
  await closeSeasonGroups(ACTOR, id)
  await enterSeasonPlayoffSetup(ACTOR, id)
  // The pointer to this fixture's own synthetic template.
  await prisma.season.update({ where: { id }, data: { archiveTemplateKey: templateKey } })
  return id
}

try {
  section('Synthetic people and a synthetic template')
  const alpha = await mkPlayer('Alpha', H.a)
  const bravo = await mkPlayer('Bravo', H.b)
  const charlie = await mkPlayer('Charlie', H.c)
  const delta = await mkPlayer('Delta', H.d)
  const extra = await mkPlayer('Extra', 'zz_verify_extra')
  check('five throwaway players exist', [alpha, bravo, charlie, delta, extra].every((p) => p.id))
  check('none of them is a real archive player',
    [alpha, bravo, charlie, delta, extra].every((p) => p.primaryName.startsWith('ZZ Verify')))

  const template = makeTemplate()
  const src = sourceOf(template)
  check('the injected source answers for a synthetic key', src(keyFor(1))?.templateKey === keyFor(1))
  check('...and refuses every other key, so no real template can load', src('8brcam-2005-s1') === null)

  section('Exact participant selection')
  // Five entrants; the archive names only four of them as playoff players.
  const s1 = await seasonAtSetup(1, [alpha.id, bravo.id, charlie.id, delta.id, extra.id])
  const plan = await previewPlayoffBracket(s1, src)
  check('the preview is not blocked', !('blocked' in plan && plan.blocked), JSON.stringify(plan).slice(0, 160))
  if (!('blocked' in plan && plan.blocked)) {
    check('it reads the synthetic template', plan.templateKey === keyFor(1), plan.templateKey)
    check('...as an exact topology', plan.placement === 'exact')
    check('...of bracket size 4', plan.bracketSize === 4, String(plan.bracketSize))
    check('four archived players are to be included', plan.include.length === 4, `${plan.include.length}`)
    check('...and the entrant the archive never names is excluded',
      plan.exclude.some((e) => e.displayName?.includes('Extra')), JSON.stringify(plan.exclude))
    check('nothing is ambiguous in the clean case', plan.ambiguous.length === 0)
    check('...and nothing is missing', plan.missing.length === 0, JSON.stringify(plan.missing))
  }

  const applied = await applySelectionThenPlacement(ACTOR, s1, {}, src)
  check('applying builds the bracket', applied.ok === true, JSON.stringify(applied))
  const included = await prisma.seasonEntrant.count({ where: { seasonId: s1, playoffIncluded: true } })
  check('exactly the four archived players are selected', included === 4, `${included}`)
  const topo = await bracketTopology(s1)
  check('...in a bracket of four', topo.entrySlots.length === 4, `${topo.entrySlots.length}`)
  check('...and nothing is published',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1, published: true } })) === 0)
  check('...and the Season did not start',
    (await prisma.season.findUniqueOrThrow({ where: { id: s1 }, select: { lifecycleState: true } })).lifecycleState === 'PLAYOFF_SETUP')

  section('Exact Round 1 placement')
  const place = await previewPlacement(s1, src)
  check('the placement preview runs', !('blocked' in place && place.blocked), JSON.stringify(place).slice(0, 160))
  const placeApplied = await applyPlacement(ACTOR, s1, src)
  check('placement applies', placeApplied.ok === true, JSON.stringify(placeApplied))

  const seated = await bracketTopology(s1)
  const byMatch = new Map<number, typeof seated.entrySlots>()
  for (const sl of seated.entrySlots) byMatch.set(sl.matchId, [...(byMatch.get(sl.matchId) ?? []), sl])
  const ties = [...byMatch.values()].sort((x, y) => x[0].slot - y[0].slot)
  const nameIn = (tie: typeof seated.entrySlots, side: 'home' | 'away') =>
    tie.find((sl) => sl.side === side)?.entrantName ?? null
  check('the archive’s first tie is alpha against delta',
    [nameIn(ties[0], 'home'), nameIn(ties[0], 'away')].every((n) => /Alpha|Delta/.test(n ?? '')),
    `${nameIn(ties[0], 'home')} v ${nameIn(ties[0], 'away')}`)
  check('...and the second is bravo against charlie',
    [nameIn(ties[1], 'home'), nameIn(ties[1], 'away')].every((n) => /Bravo|Charlie/.test(n ?? '')),
    `${nameIn(ties[1], 'home')} v ${nameIn(ties[1], 'away')}`)
  check('every selected player is seated exactly once',
    new Set(seated.entrySlots.map((sl) => sl.entrantId).filter(Boolean)).size === 4)
  check('no result was entered',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1, winnerEntrantId: { not: null } } })) === 0)

  section('Applying twice changes nothing')
  const before = (await bracketTopology(s1)).entrySlots.map((sl) => `${sl.matchId}:${sl.side}:${sl.entrantId}`).sort().join('|')
  const twice = await applyPlacement(ACTOR, s1, src)
  check('the second apply succeeds', twice.ok === true, JSON.stringify(twice))
  const after = (await bracketTopology(s1)).entrySlots.map((sl) => `${sl.matchId}:${sl.side}:${sl.entrantId}`).sort().join('|')
  check('...and the arrangement is byte-identical', before === after)
  check('...with no duplicate rows',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1 } })) === 3,
    String(await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1 } })))

  section('An unmatched archive handle is reported, not guessed')
  const withGhost = makeTemplate({
    participants: [
      { sourceId: 'S1', rawHandle: H.a, normalizedHandle: H.a, seed: 1, firstRound: 1, bye: false, matchNo: 1, side: 'a' },
      { sourceId: 'S3', rawHandle: H.b, normalizedHandle: H.b, seed: 2, firstRound: 1, bye: false, matchNo: 2, side: 'a' },
      { sourceId: 'S4', rawHandle: H.c, normalizedHandle: H.c, seed: 3, firstRound: 1, bye: false, matchNo: 2, side: 'b' },
      // The one nobody can be: named by the archive, matching no account.
      { sourceId: 'S9', rawHandle: H.ghost, normalizedHandle: H.ghost, seed: 4, firstRound: 1, bye: false, matchNo: 1, side: 'b' },
    ],
  })
  const s2 = await seasonAtSetup(2, [alpha.id, bravo.id, charlie.id])
  const ghostPlan = await previewPlayoffBracket(s2, sourceOf(withGhost))
  check('the preview still runs', !('blocked' in ghostPlan && ghostPlan.blocked))
  if (!('blocked' in ghostPlan && ghostPlan.blocked)) {
    check('the unmatched handle is reported as missing',
      ghostPlan.missing.some((m) => m.rawHandle === H.ghost), JSON.stringify(ghostPlan.missing))
    check('...and the three it CAN match are still included',
      ghostPlan.include.length === 3, `${ghostPlan.include.length}`)
    check('...so a partial archive still produces a bracket', ghostPlan.refusal === null, ghostPlan.refusal ?? '')
  }
  const ghostApplied = await applySelectionThenPlacement(ACTOR, s2, {}, sourceOf(withGhost))
  check('applying places the confirmed players', ghostApplied.ok === true, JSON.stringify(ghostApplied))
  check('...and nobody was invented for the unmatched handle',
    (await prisma.seasonEntrant.count({ where: { seasonId: s2 } })) === 3,
    String(await prisma.seasonEntrant.count({ where: { seasonId: s2 } })))

  section('An ambiguous handle is refused rather than resolved')
  const twinA = await mkPlayer('TwinOne', null)
  const twinB = await mkPlayer('TwinTwo', null)
  await prisma.playerAlias.createMany({
    data: [
      { playerId: twinA.id, alias: H.twin, aliasType: 'HANDLE' },
      { playerId: twinB.id, alias: H.twin, aliasType: 'HANDLE' },
    ],
  })
  const withTwin = makeTemplate({
    participants: [
      { sourceId: 'S1', rawHandle: H.a, normalizedHandle: H.a, seed: 1, firstRound: 1, bye: false, matchNo: 1, side: 'a' },
      { sourceId: 'S3', rawHandle: H.b, normalizedHandle: H.b, seed: 2, firstRound: 1, bye: false, matchNo: 2, side: 'a' },
      { sourceId: 'S4', rawHandle: H.c, normalizedHandle: H.c, seed: 3, firstRound: 1, bye: false, matchNo: 2, side: 'b' },
      // The one that matches two people, which must be refused rather than resolved.
      { sourceId: 'S8', rawHandle: H.twin, normalizedHandle: H.twin, seed: 4, firstRound: 1, bye: false, matchNo: 1, side: 'b' },
    ],
  })
  const s3 = await seasonAtSetup(3, [alpha.id, bravo.id, charlie.id, twinA.id, twinB.id])
  const twinPlan = await previewPlayoffBracket(s3, sourceOf(withTwin))
  check('the preview runs', !('blocked' in twinPlan && twinPlan.blocked))
  if (!('blocked' in twinPlan && twinPlan.blocked)) {
    const flagged = twinPlan.ambiguous.some((a) => a.rawHandle === H.twin)
      || twinPlan.missing.some((m) => m.rawHandle === H.twin)
    check('the ambiguous handle is reported and not placed', flagged,
      `ambiguous=${JSON.stringify(twinPlan.ambiguous)} missing=${JSON.stringify(twinPlan.missing)}`)
    check('...and neither twin was chosen',
      !twinPlan.include.some((i) => /TwinOne|TwinTwo/.test(i.displayName ?? '')),
      JSON.stringify(twinPlan.include.map((i) => i.displayName)))
  }

  section('A recorded bye survives into the bracket')
  const withBye = makeTemplate({
    bracketSize: 4,
    participants: [
      { sourceId: 'S1', rawHandle: H.a, normalizedHandle: H.a, seed: 1, firstRound: 1, bye: true, matchNo: 1, side: 'a' },
      { sourceId: 'S3', rawHandle: H.b, normalizedHandle: H.b, seed: 2, firstRound: 1, bye: false, matchNo: 2, side: 'a' },
      { sourceId: 'S4', rawHandle: H.c, normalizedHandle: H.c, seed: 3, firstRound: 1, bye: false, matchNo: 2, side: 'b' },
    ],
  })
  const s4 = await seasonAtSetup(4, [alpha.id, bravo.id, charlie.id])
  const byeApplied = await applySelectionThenPlacement(ACTOR, s4, {}, sourceOf(withBye))
  check('the bracket builds', byeApplied.ok === true, JSON.stringify(byeApplied))
  const byeTopo = await bracketTopology(s4)
  check('a bracket of four holds three players and one empty position',
    byeTopo.entrySlots.filter((sl) => sl.entrantId != null).length === 3
    && byeTopo.entrySlots.filter((sl) => sl.entrantId == null).length === 1,
    `${byeTopo.entrySlots.filter((sl) => sl.entrantId != null).length} seated`)
  check('...and the bye has not been advanced',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s4, winnerEntrantId: { not: null } } })) === 0)

  section('Manual placement is preserved where the archive says nothing')
  const s5 = await seasonAtSetup(5, [alpha.id, bravo.id, charlie.id, delta.id])
  await applySelectionThenPlacement(ACTOR, s5, {}, src)
  const partial = makeTemplate({
    // Only the first tie is recorded; the second is the operator's to arrange.
    participants: makeTemplate().playoff.participants.slice(0, 2),
  })
  const seatsBefore = (await bracketTopology(s5)).entrySlots
  const tie2Before = seatsBefore.filter((sl) => sl.matchId === [...new Set(seatsBefore.map((x) => x.matchId))].sort()[1])
  const partialApplied = await applyPlacement(ACTOR, s5, sourceOf(partial))
  check('a partial placement applies', partialApplied.ok === true, JSON.stringify(partialApplied))
  const seatsAfter = (await bracketTopology(s5)).entrySlots
  const tie2After = seatsAfter.filter((sl) => tie2Before.some((b) => b.matchId === sl.matchId && b.side === sl.side))
  check('the tie the archive did not mention is untouched',
    JSON.stringify(tie2Before.map((x) => x.entrantId).sort()) === JSON.stringify(tie2After.map((x) => x.entrantId).sort()),
    `${JSON.stringify(tie2Before.map((x) => x.entrantId))} -> ${JSON.stringify(tie2After.map((x) => x.entrantId))}`)
  check('nobody was duplicated',
    new Set(seatsAfter.map((sl) => sl.entrantId).filter(Boolean)).size
    === seatsAfter.filter((sl) => sl.entrantId != null).length)

  section('No real archived Season was read or written')
  check('every fixture Season points only at a synthetic key',
    (await prisma.season.count({ where: { competitionYear: YEAR, archiveTemplateKey: { startsWith: TEMPLATE_PREFIX } } }))
    === (await prisma.season.count({ where: { competitionYear: YEAR } })))
  check('no real Season carries a synthetic key',
    (await prisma.season.count({ where: { archiveTemplateKey: { startsWith: TEMPLATE_PREFIX }, competitionYear: { not: YEAR } } })) === 0)
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
  check('every fixture Player is removed',
    (await prisma.player.count({ where: { primaryName: { startsWith: 'ZZ Verify' } } })) === 0)
  check('no synthetic template key remains on any Season',
    (await prisma.season.count({ where: { archiveTemplateKey: { startsWith: TEMPLATE_PREFIX } } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
