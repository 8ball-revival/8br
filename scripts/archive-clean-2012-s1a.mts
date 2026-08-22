/**
 * Remove the fixture contamination `verify-place-entrants` left on the real 2012 S1A archive shell.
 *
 * ── What went wrong ──────────────────────────────────────────────────────────────────────────────
 * The suite exercised Place Entrants against a real archive-linked Season instead of a synthetic
 * fixture. It seated players onto it, generated groups and drove the lifecycle — 366 entrant-adds and
 * some 470 audit entries deep. Most of that it cleaned up; what survived is four entrants and the
 * group shell built around them.
 *
 * ── How a fixture entrant is told apart from a real one ──────────────────────────────────────────
 * Not by actor and not by timestamp: both are unreliable here, because the surviving rows carry the
 * importer's own actor name. The reliable test is whether the handle can possibly represent entry
 * into THIS Season. The manifest lists 2012 S1A's 48 participants by name, and a handle absent from
 * that list did not play in it. All four are absent from the entry entirely and belong to other
 * Seasons — fsm_angel to 2007 S3A, xxl_overclocked_lxx and fhm_benny to 2008 S1A, jmunoz3rd to none.
 *
 * The three that ARE in the manifest are the importer's legitimate work and are preserved.
 *
 * Deletion is outright, not withdrawal. Marking them WITHDRAWN would assert that these people
 * entered a 2012 Season and pulled out, which never happened; fabricating history to tidy up after a
 * test is worse than the contamination itself.
 *
 * Usage: tsx scripts/archive-clean-2012-s1a.mts [--dry-run|--apply]
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
const SEASON_ID = 5495
const TEMPLATE = '8brcam-2012-s1-a'

const s = await prisma.season.findUniqueOrThrow({
  where: { id: SEASON_ID },
  select: {
    id: true, number: true, division: true, competitionYear: true,
    archiveTemplateKey: true, lifecycleState: true, championName: true, ladderAppliedAt: true,
  },
})

// ── The safeguards. Every one must hold or nothing is touched. ──────────────────────────────────
const refuse: string[] = []
if (s.archiveTemplateKey !== TEMPLATE) refuse.push(`template is ${s.archiveTemplateKey}, expected ${TEMPLATE}`)
if (s.competitionYear !== 2012 || s.number !== 1 || s.division !== 'A') refuse.push('not the 2012 S1A shell')
if (String(s.lifecycleState) === 'COMPLETED') refuse.push('Season is completed')
if (s.championName) refuse.push(`a champion is recorded (${s.championName})`)
if (s.ladderAppliedAt) refuse.push('a ranking contribution was applied')

const playoff = await prisma.seasonPlayoffMatch.count({ where: { seasonId: SEASON_ID } })
const ledger = await prisma.ratingLedger.count({ where: { seasonId: SEASON_ID } })
if (playoff > 0) refuse.push(`${playoff} playoff match(es) exist`)
if (ledger > 0) refuse.push(`${ledger} rating-ledger row(s) exist`)

/*
 * No manual edit after the contamination.
 *
 * The importer and the fixture are both known actors. A human editing this Season would mean these
 * rows are someone's deliberate work, and deliberate work is never discarded automatically.
 */
const KNOWN = ['archive-import', 'archive-import-cleanup', 'archive-import-merge', 'verify-place-entrants', 'admin']
const manual = await prisma.auditLog.findFirst({
  where: { entity: 'Season', entityId: String(SEASON_ID), actorUsername: { notIn: KNOWN } },
  select: { actorUsername: true, action: true },
})
if (manual) refuse.push(`edited by ${manual.actorUsername} (${manual.action})`)

// The pre-import baseline: a generated shell, created once, holding nothing of its own.
const shellCreate = await prisma.auditLog.count({
  where: { entity: 'Season', entityId: String(SEASON_ID), action: 'season.archive.shell.create' },
})
if (shellCreate !== 1) refuse.push(`expected exactly one generated-shell audit entry, found ${shellCreate}`)

if (refuse.length > 0) {
  console.log(`REFUSED: ${refuse.join('; ')}`)
  await prisma.$disconnect()
  process.exit(1)
}

// ── Classify every entrant against this Season's own participant list ───────────────────────────
const entry = manifestEntry(TEMPLATE)
if (!entry) throw new Error(`no manifest entry for ${TEMPLATE}`)
const participants = new Set(entry.participants.map((p) => p.normalizedHandle.toLowerCase()))

const entrants = await prisma.seasonEntrant.findMany({
  where: { seasonId: SEASON_ID },
  select: { id: true, cueverseId: true, username: true, playerId: true },
})

const keep: typeof entrants = []
const drop: typeof entrants = []
for (const e of entrants) {
  const handle = String(e.cueverseId ?? e.username).toLowerCase()
  let real = participants.has(handle)
  if (!real && e.playerId) {
    // A merged Player may carry the archive handle as an alias; that is still real entry.
    const aliases = await prisma.playerAlias.findMany({ where: { playerId: e.playerId }, select: { alias: true } })
    real = aliases.some((a) => participants.has(a.alias.toLowerCase()))
  }
  ;(real ? keep : drop).push(e)
}

const before = {
  groups: await prisma.seasonGroup.count({ where: { seasonId: SEASON_ID } }),
  members: await prisma.seasonGroupPlayer.count({ where: { group: { seasonId: SEASON_ID } } }),
  matches: await prisma.seasonMatch.count({ where: { seasonId: SEASON_ID } }),
  standings: await prisma.seasonStanding.count({ where: { seasonId: SEASON_ID } }),
}

console.log(`2012 S1A (${SEASON_ID}) — the manifest lists ${participants.size} participants`)
console.log(`  preserve ${keep.length}: ${keep.map((e) => e.cueverseId).join(', ')}`)
console.log(`  delete   ${drop.length}: ${drop.map((e) => e.cueverseId).join(', ')}`)
console.log(`  group children: ${JSON.stringify(before)}`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing deleted. Re-run with --apply.')
  await prisma.$disconnect()
  process.exit(0)
}

await prisma.$transaction(async (tx) => {
  await tx.seasonStanding.deleteMany({ where: { seasonId: SEASON_ID } })
  await tx.seasonMatch.deleteMany({ where: { seasonId: SEASON_ID } })
  await tx.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: SEASON_ID } } })
  await tx.seasonGroup.deleteMany({ where: { seasonId: SEASON_ID } })
  if (drop.length > 0) {
    await tx.seasonEntrant.deleteMany({ where: { id: { in: drop.map((e) => e.id) } } })
  }
  await tx.auditLog.create({
    data: {
      entity: 'Season',
      entityId: String(SEASON_ID),
      action: 'season.fixture.cleanup',
      actorUserId: 2,
      actorUsername: 'archive-import-cleanup',
      reason: `removed ${drop.length} entrant(s) absent from the 2012 S1A manifest and the group shell built around them; ${keep.length} manifest participant(s) preserved`,
    },
  })
}, { timeout: 120_000 })

const after = {
  entrants: await prisma.seasonEntrant.count({ where: { seasonId: SEASON_ID } }),
  groups: await prisma.seasonGroup.count({ where: { seasonId: SEASON_ID } }),
  members: await prisma.seasonGroupPlayer.count({ where: { group: { seasonId: SEASON_ID } } }),
  matches: await prisma.seasonMatch.count({ where: { seasonId: SEASON_ID } }),
  standings: await prisma.seasonStanding.count({ where: { seasonId: SEASON_ID } }),
  state: String((await prisma.season.findUniqueOrThrow({ where: { id: SEASON_ID }, select: { lifecycleState: true } })).lifecycleState),
}
console.log('after:', JSON.stringify(after))
if (after.entrants !== keep.length) throw new Error(`expected ${keep.length} entrants, found ${after.entrants}`)
if (after.groups + after.members + after.matches + after.standings !== 0) throw new Error('group children survived')
for (const e of keep) {
  const still = await prisma.seasonEntrant.count({ where: { id: e.id } })
  if (still !== 1) throw new Error(`preserved entrant ${e.cueverseId} was removed`)
}
console.log('verified: fixture rows gone, manifest participants intact')

await prisma.$disconnect()
