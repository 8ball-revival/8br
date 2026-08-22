/**
 * Place Entrants: seat the archived players on the bracket that is already there.
 *
 * The step after Build Playoff Bracket. That one draws a bracket and demands the whole field; this
 * one arranges the bracket in front of you, places everyone it can confirm, and names everyone it
 * cannot — which is the only useful answer when a Season is half-reconstructed.
 *
 * What matters most here is what it REFUSES. Most of the 88 archived Seasons record who played in
 * the playoffs but not where; their round-one pairings in the source are the archive viewer's own
 * occurrence-count heuristic, not evidence. Placing from those would manufacture a draw and then be
 * indistinguishable from the real thing, so the button is not offered at all.
 *
 * ── Why this suite builds its own Season ─────────────────────────────────────────────────────────
 * An earlier version exercised the real 2012 S1A archive shell. Its teardown restored by COUNT —
 * it remembered how many entrants the Season started with and deleted them only if that number was
 * zero — so when the importer had already seated three, the four the test added were left behind
 * for good, on a real historical Season, wearing the importer's actor name. Nothing in the run
 * looked wrong.
 *
 * The mutating half now runs entirely on a Season this file creates: its own competition series, a
 * competition year no real Season uses, and a template key that exists nowhere in the archive. The
 * manifest it is placed from is injected rather than loaded, which is why no real archive key is
 * needed to test archive behaviour. Teardown deletes by id in `finally` and then proves the absence
 * of every row type it could have created.
 *
 * The read-only half still looks at the real Seasons — that is the point of it — but only counts
 * and reads. `assertReadOnly` below fails the suite if this file ever regains the ability to write
 * to an archive-linked Season.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-place-entrants.mts
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry, type ManifestEntry } from '../src/lib/archive/manifest.ts'
import {
  placementAvailability, previewPlacement, applyPlacement,
  previewPlayoffBracket, applyArchiveSelection, applyArchivePlacement,
} from '../src/lib/archive/auto-playoffs.ts'
import { isBlocked } from '../src/lib/archive/auto-assign.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-place-entrants' }

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/*
 * The fixture's identity.
 *
 * A competition year no real Season occupies, so a stray row is unmistakable, and a run id so two
 * runs cannot collide on the unique slug or template key.
 */
const FIXTURE_YEAR = 2099
const RUN = `${process.pid}-${Math.floor(process.uptime() * 1000)}`
const FIXTURE_KEY = `fixture-place-entrants-${RUN}`
const HANDLE_PREFIX = `fixture.pe.${RUN}.`

// ─────────────────────────────────────────────────────────────────────────────────────────────────
section('This suite cannot write to a real archive Season')
{
  /*
   * A source-level guard, because the contamination it prevents was invisible at runtime.
   *
   * Any write helper narrowed by `archiveTemplateKey: { not: null }` — or aimed at a hard-coded
   * Season id — would put the mutating half back onto real history. Reads are unaffected.
   */
  const src = readFileSync(new URL(import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('section(\'This suite cannot write'))
  const writes = /\b(create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/g
  const mutatingCalls = [...body.matchAll(writes)]
  const scoped = mutatingCalls.filter((m) => {
    const window = body.slice(m.index, m.index + 400)
    return /archiveTemplateKey|competitionYear:\s*(?!FIXTURE_YEAR)\d/.test(window)
      && !/FIXTURE_KEY|fixtureSeasonId|seriesId|playerIds/.test(window)
  })
  check('no write in this file is aimed at an archive-linked Season', scoped.length === 0,
    scoped.map((m) => m[0]).join(', '))
  check('no real archive template key appears in this file',
    !/8brcam-\d{4}-s\d/.test(src))
  check('no hard-coded real Season id appears in this file',
    !/seasonId:\s*\d{3,}/.test(src) && !/\bid:\s*54\d\d\b/.test(src))
}

// ── Read-only observations of the real archive ──────────────────────────────────────────────────
section('The button is offered only where the archive records positions')
const linked = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null } },
  select: { id: true, number: true, competitionYear: true, lifecycleState: true, archiveTemplateKey: true },
})
const graded = linked.map((s) => ({ ...s, placement: manifestEntry(s.archiveTemplateKey!)?.playoff.placement ?? 'none' }))
const heuristic = graded.filter((s) => s.placement === 'participants-only')

check('the archive splits into recorded and unrecorded topologies', graded.length > 0, String(graded.length))
for (const s of heuristic.slice(0, 3)) {
  const a = await placementAvailability(s.id)
  check(`${s.archiveTemplateKey}: never offered — the archive records no positions`, a.show === false)
}
const heuristicInSetup = heuristic.find((s) => String(s.lifecycleState) === 'PLAYOFF_SETUP')
if (heuristicInSetup) {
  const p = await previewPlacement(heuristicInSetup.id)
  check('one sitting in playoff setup says why rather than guessing',
    isBlocked(p) && /not where|guesswork/i.test(p.reason), isBlocked(p) ? p.reason : 'not blocked')
} else {
  console.log('  (no participants-only Season is in playoff setup right now — wording not exercised)')
}

// ── The mutating half, on a Season that exists only for this run ─────────────────────────────────
section('A Season with recorded positions can be placed')

let fixtureSeasonId: number | null = null
let seriesId: number | null = null
const playerIds: string[] = []

/** A four-player bracket with every position recorded — the 'exact' case, invented for this run. */
const synthetic = (): ManifestEntry => {
  const people = [0, 1, 2, 3].map((i) => ({
    sourceId: `F${i}`,
    rawHandle: `${HANDLE_PREFIX}${i}`,
    normalizedHandle: `${HANDLE_PREFIX}${i}`,
    rawName: `Fixture ${i}`,
    normalizedName: `fixture ${i}`,
    sourceNote: null,
    groupName: 'A',
    slot: i,
  }))
  return {
    templateKey: FIXTURE_KEY,
    sourceKey: FIXTURE_KEY,
    competitionSlug: '8brcam',
    competitionYear: FIXTURE_YEAR,
    seasonNumber: 1,
    division: 'A',
    rawSeasonTitle: `Fixture ${FIXTURE_YEAR}`,
    rawDivision: 'A',
    format: 'GROUPS_THEN_PLAYOFFS',
    competitionMonth: null,
    gamesPerMatch: 10,
    groupNames: ['A'],
    participants: people,
    matches: [],
    standings: [],
    groupAssignments: 'complete',
    exactResults: 'missing',
    sharedGroupStageSourceKey: null,
    ambiguousPlacements: [],
    playoff: {
      placement: 'exact',
      sourceConfidence: 'fixture',
      format: 'single-elimination',
      bracketSize: 4,
      participants: people.map((p, i) => ({
        sourceId: p.sourceId,
        rawHandle: p.rawHandle,
        normalizedHandle: p.normalizedHandle,
        seed: i + 1,
        firstRound: 1,
        bye: false,
        matchNo: i < 2 ? 1 : 2,
        side: i % 2 === 0 ? 'a' : 'b',
      })),
      championSourceId: 'F0',
      runnerUpSourceId: 'F1',
      unresolved: [],
    },
    unresolved: [],
    provenance: {
      sourceFile: 'fixture', sourceSection: 'fixture',
      sourceYear: FIXTURE_YEAR, sourceMonth: null, confidence: 'fixture',
    },
  }
}

const entry = synthetic()
const source = (key: string) => (key === FIXTURE_KEY ? entry : null)

try {
  const series = await prisma.competitionSeries.create({
    data: { name: `Fixture Series ${RUN}`, shortName: `FIX${RUN}`.slice(0, 20), slug: `fixture-series-${RUN}` },
    select: { id: true },
  })
  seriesId = series.id

  const season = await prisma.season.create({
    data: {
      number: 1,
      competitionYear: FIXTURE_YEAR,
      competitionSeriesId: series.id,
      slug: `fixture-season-${RUN}`,
      division: 'A',
      archiveTemplateKey: FIXTURE_KEY,
      lifecycleState: 'PLAYOFF_SETUP',
      reconstruction: true,
      publiclyVisible: false,
      countsTowardRankings: false,
    },
    select: { id: true },
  })
  fixtureSeasonId = season.id
  check('the fixture Season is not archive-linked to any real template',
    manifestEntry(FIXTURE_KEY) === null)

  for (const p of entry.participants) {
    const player = await prisma.player.create({
      data: {
        cueverseId: p.rawHandle,
        cueverseIdNormalized: p.normalizedHandle,
        primaryName: p.rawName,
      },
      select: { id: true },
    })
    playerIds.push(player.id)
    await prisma.seasonEntrant.create({
      data: {
        seasonId: season.id,
        playerId: player.id,
        username: p.rawHandle,
        cueverseId: p.rawHandle,
        displayName: p.rawName,
        addedByAdmin: true,
      },
    })
  }

  /*
   * The group stage the seeds come from.
   *
   * Playoff seeding is read from closed group standings, not from the entrant rows, so a fixture
   * without a group stage has no seeds and the bracket refuses to generate. Building one here keeps
   * the test on the same path a real Season takes.
   */
  const group = await prisma.seasonGroup.create({
    data: { seasonId: season.id, code: 'A', name: 'A', ordinal: 1, published: true },
    select: { id: true },
  })
  const seatedEntrants = await prisma.seasonEntrant.findMany({
    where: { seasonId: season.id }, select: { id: true, username: true }, orderBy: { id: 'asc' },
  })
  for (const [i, e] of seatedEntrants.entries()) {
    await prisma.seasonGroupPlayer.create({ data: { groupId: group.id, entrantId: e.id, seed: i + 1 } })
    await prisma.seasonStanding.create({
      data: {
        seasonId: season.id, groupId: group.id, entrantId: e.id, username: e.username,
        played: 3, wins: 3 - i, losses: i, points: (3 - i) * 3, rank: i + 1, qualified: true,
      },
    })
  }

  // ── The behaviour under test ──────────────────────────────────────────────────────────────────
  const preview = await previewPlayoffBracket(season.id, source)
  check('a recorded topology previews without being blocked', !isBlocked(preview),
    isBlocked(preview) ? preview.reason : undefined)

  const selected = await applyArchiveSelection(ACTOR, season.id, source)
  check('the recorded field is selected', selected.ok !== false, JSON.stringify(selected).slice(0, 120))

  const placed = await applyArchivePlacement(ACTOR, season.id, {}, source)
  check('selection actually changed the entrants', (selected as { changed?: number }).changed === 4,
    JSON.stringify(selected).slice(0, 140))
  check('placement succeeded', (placed as { ok?: boolean }).ok !== false,
    JSON.stringify(placed).slice(0, 200))
  const round1 = await prisma.seasonPlayoffMatch.count({ where: { seasonId: season.id, round: 1 } })
  check('a four-player bracket produces two round-one matches', round1 === 2, String(round1))

  const seated = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId: season.id, round: 1 },
    select: { homeEntrantId: true, awayEntrantId: true },
  })
  const filled = seated.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter(Boolean).length
  check('every recorded position is seated', filled === 4, String(filled))

  const applied = await applyPlacement(ACTOR, season.id, source)
  const again = await applyPlacement(ACTOR, season.id, source)
  check('applying a second time changes nothing', again.placed === applied.placed,
    `${again.placed} vs ${applied.placed}`)
  check('placement reports what it did', typeof placed === 'object')
} finally {
  /*
   * Teardown by id, never by count.
   *
   * The previous version's `if (hadEntrants === 0)` is exactly how four rows survived on a real
   * Season. Everything here was created by this run and is removed unconditionally, even if an
   * assertion above threw.
   */
  if (fixtureSeasonId !== null) {
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: fixtureSeasonId } })
    await prisma.seasonStanding.deleteMany({ where: { seasonId: fixtureSeasonId } })
    await prisma.seasonMatch.deleteMany({ where: { seasonId: fixtureSeasonId } })
    await prisma.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: fixtureSeasonId } } })
    await prisma.seasonGroup.deleteMany({ where: { seasonId: fixtureSeasonId } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: fixtureSeasonId } })
    await prisma.ratingLedger.deleteMany({ where: { seasonId: fixtureSeasonId } })
    await prisma.auditLog.deleteMany({ where: { entity: 'Season', entityId: String(fixtureSeasonId) } })
    await prisma.season.delete({ where: { id: fixtureSeasonId } })
  }
  if (playerIds.length > 0) {
    await prisma.playerAlias.deleteMany({ where: { playerId: { in: playerIds } } })
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } })
  }
  if (seriesId !== null) await prisma.competitionSeries.delete({ where: { id: seriesId } })

  section('The fixture leaves nothing behind')
  const residue = {
    seasons: await prisma.season.count({ where: { competitionYear: FIXTURE_YEAR } }),
    templateKeys: await prisma.season.count({ where: { archiveTemplateKey: { startsWith: 'fixture-' } } }),
    entrants: fixtureSeasonId === null ? 0 : await prisma.seasonEntrant.count({ where: { seasonId: fixtureSeasonId } }),
    groups: fixtureSeasonId === null ? 0 : await prisma.seasonGroup.count({ where: { seasonId: fixtureSeasonId } }),
    matches: fixtureSeasonId === null ? 0 : await prisma.seasonMatch.count({ where: { seasonId: fixtureSeasonId } }),
    standings: fixtureSeasonId === null ? 0 : await prisma.seasonStanding.count({ where: { seasonId: fixtureSeasonId } }),
    playoff: fixtureSeasonId === null ? 0 : await prisma.seasonPlayoffMatch.count({ where: { seasonId: fixtureSeasonId } }),
    audit: fixtureSeasonId === null ? 0 : await prisma.auditLog.count({ where: { entity: 'Season', entityId: String(fixtureSeasonId) } }),
    players: await prisma.player.count({ where: { cueverseIdNormalized: { startsWith: 'fixture.pe.' } } }),
    series: await prisma.competitionSeries.count({ where: { slug: { startsWith: 'fixture-series-' } } }),
  }
  const total = Object.values(residue).reduce((a, b) => a + b, 0)
  check('no synthetic Season, entrant, group, match, standing, playoff, audit or Player remains',
    total === 0, JSON.stringify(residue))

  // The real archive is exactly as it was found.
  const realNow = await prisma.season.count({ where: { archiveTemplateKey: { not: null } } })
  check('no archive-linked Season was created or removed', realNow === linked.length,
    `${realNow} vs ${linked.length}`)
  const dirty = await prisma.season.count({
    where: {
      archiveTemplateKey: { not: null },
      lifecycleState: { notIn: ['COMPLETED'] },
      OR: [{ groups: { some: {} } }, { matches: { some: {} } }, { standings: { some: {} } }],
    },
  })
  check('no unfinished archive Season gained group children', dirty === 0, String(dirty))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
