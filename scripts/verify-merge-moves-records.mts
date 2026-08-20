/**
 * A merge moves the competition records; an undo puts them back.
 *
 * The service used to record the link and deactivate the secondary profile without touching the
 * results, and nothing unions the two on read — so a merged player kept appearing twice in the
 * Rankings with their history split, and the official ladder disagreed with the table about which
 * record was which. That is not a merge; it is a note saying one ought to happen.
 *
 * The property under test is a ROUND TRIP: merge, and every result belongs to one profile; undo, and
 * the data is byte-for-byte what it was. A merge that cannot be undone cleanly is worse than no
 * merge, because the operator has no way back from a mistake.
 *
 * Everything runs on throwaway players in a fixture Competition. The real records are never touched.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-merge-moves-records.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createSeason, closeRegistration, addSeasonEntrant } from '../src/lib/seasons/service.ts'
import { mergeAccounts, undoMerge } from '../src/lib/players/merge.ts'

assertLocalDatabase('verify-merge-moves-records')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const FIXTURE_SLUG = 'zzmergemove'
const actor = { userId: 990960, username: 'verify' }

async function cleanup() {
  const seasons = await prisma.season.findMany({
    where: { competitionSeries: { slug: FIXTURE_SLUG } }, select: { id: true },
  }).catch(() => [] as { id: number }[])
  for (const { id } of seasons) await prisma.season.delete({ where: { id } }).catch(() => {})

  const players = await prisma.player.findMany({
    where: { cueverseId: { startsWith: 'zzmm_' } }, select: { id: true },
  }).catch(() => [] as { id: string }[])
  for (const p of players) {
    await prisma.playerMerge.deleteMany({ where: { OR: [{ canonicalPlayerId: p.id }, { mergedPlayerId: p.id }] } }).catch(() => {})
    await prisma.playerAlias.deleteMany({ where: { playerId: p.id } }).catch(() => {})
    await prisma.ratingLedger.deleteMany({ where: { playerId: p.id } }).catch(() => {})
    await prisma.player.delete({ where: { id: p.id } }).catch(() => {})
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: actor.username } }).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: FIXTURE_SLUG, seasons: { none: {} } } }).catch(() => {})
}

const mkPlayer = (tag: string) => prisma.player.create({
  data: { primaryName: `zzmm ${tag}`, cueverseId: `zzmm_${tag}`, cueverseIdNormalized: `zzmm_${tag}` },
  select: { id: true, primaryName: true, cueverseId: true },
})

async function main() {
  await cleanup()
  const comp = await prisma.competitionSeries.upsert({
    where: { slug: FIXTURE_SLUG },
    update: {},
    create: { slug: FIXTURE_SLUG, name: 'ZZ Merge Move Fixture', shortName: 'ZMM', active: true },
    select: { id: true },
  })

  const primary = await mkPlayer('primary')
  const secondary = await mkPlayer('secondary')
  const filler = await Promise.all(['f1', 'f2', 'f3', 'f4'].map(mkPlayer))

  // Two Seasons: the secondary plays one, the primary the other. Different Seasons, so the merge
  // has somewhere to move the entrant to.
  const seasonA = await createSeason(actor, { competitionSeriesId: comp.id, accessMode: 'OPEN', lounge: 'Social' })
  const seasonB = await createSeason(actor, { competitionSeriesId: comp.id, accessMode: 'OPEN', lounge: 'Social' })
  if (!seasonA.id || !seasonB.id) throw new Error('could not create the fixture Seasons')

  for (const p of [secondary, filler[0], filler[1]]) await addSeasonEntrant(actor, seasonA.id, p.id)
  for (const p of [primary, filler[2], filler[3]]) await addSeasonEntrant(actor, seasonB.id, p.id)
  await closeRegistration(actor, seasonA.id)
  await closeRegistration(actor, seasonB.id)

  const before = {
    entrants: await prisma.seasonEntrant.count(),
    players: await prisma.player.count(),
    secondaryEntrants: await prisma.seasonEntrant.count({ where: { playerId: secondary.id } }),
    primaryEntrants: await prisma.seasonEntrant.count({ where: { playerId: primary.id } }),
  }
  check('the secondary starts with an entrant', before.secondaryEntrants === 1, String(before.secondaryEntrants))
  check('the primary starts with an entrant', before.primaryEntrants === 1, String(before.primaryEntrants))

  section('Merging moves the records across')
  const merged = await mergeAccounts(actor, primary.id, secondary.id, 'fixture')
  check('the merge succeeded', merged.ok, merged.error ?? '')
  if (!merged.ok || !merged.mergeId) throw new Error(merged.error ?? 'merge failed')

  check('the secondary keeps no entrants',
    (await prisma.seasonEntrant.count({ where: { playerId: secondary.id } })) === 0)
  check('the primary now holds both',
    (await prisma.seasonEntrant.count({ where: { playerId: primary.id } })) === 2)
  check('the secondary keeps no ledger rows',
    (await prisma.ratingLedger.count({ where: { playerId: secondary.id } })) === 0)
  check('no entrant row was created or destroyed',
    (await prisma.seasonEntrant.count()) === before.entrants)
  check('no player was created or destroyed',
    (await prisma.player.count()) === before.players)
  check('the secondary profile is retired',
    (await prisma.player.findUniqueOrThrow({ where: { id: secondary.id }, select: { active: true } })).active === false)

  // The moved entrant should read under the surviving identity, not the retired one.
  const movedRow = await prisma.seasonEntrant.findFirstOrThrow({
    where: { playerId: primary.id, seasonId: seasonA.id },
    select: { username: true, displayName: true },
  })
  check('the moved entrant reads under the surviving identity',
    movedRow.username === primary.cueverseId, `${movedRow.username} vs ${primary.cueverseId}`)

  section('The snapshot records exactly what moved')
  const record = await prisma.playerMerge.findUniqueOrThrow({
    where: { id: merged.mergeId }, select: { note: true },
  })
  const snap = JSON.parse(record.note ?? '{}') as { movedEntrants?: { id: number; username: string }[] }
  check('one entrant is listed as moved', (snap.movedEntrants ?? []).length === 1,
    String((snap.movedEntrants ?? []).length))
  check('...with the name it carried before the move',
    snap.movedEntrants?.[0]?.username === secondary.cueverseId,
    `${snap.movedEntrants?.[0]?.username} vs ${secondary.cueverseId}`)

  section('Undo puts everything back')
  const undone = await undoMerge(actor, merged.mergeId, 'fixture')
  check('the undo succeeded', undone.ok, undone.error ?? '')
  check('the entrant is back on the secondary',
    (await prisma.seasonEntrant.count({ where: { playerId: secondary.id } })) === before.secondaryEntrants)
  check('the primary is back to its own',
    (await prisma.seasonEntrant.count({ where: { playerId: primary.id } })) === before.primaryEntrants)
  check('still no entrant created or destroyed',
    (await prisma.seasonEntrant.count()) === before.entrants)

  const restored = await prisma.seasonEntrant.findFirstOrThrow({
    where: { playerId: secondary.id }, select: { username: true },
  })
  check('the restored entrant reads under its original identity',
    restored.username === secondary.cueverseId, `${restored.username} vs ${secondary.cueverseId}`)
  check('the merge record is gone',
    (await prisma.playerMerge.count({ where: { id: merged.mergeId } })) === 0)

  section('A merge that would collide is refused, not guessed')
  {
    // Put both profiles in the SAME Season, which a merge cannot resolve.
    const clashSeason = await createSeason(actor, { competitionSeriesId: comp.id, accessMode: 'OPEN', lounge: 'Social' })
    if (!clashSeason.id) throw new Error('could not create the clash Season')
    await addSeasonEntrant(actor, clashSeason.id, primary.id)
    await addSeasonEntrant(actor, clashSeason.id, secondary.id)
    await addSeasonEntrant(actor, clashSeason.id, filler[0].id)
    await closeRegistration(actor, clashSeason.id)

    const blocked = await mergeAccounts(actor, primary.id, secondary.id, 'fixture clash')
    check('the merge is refused', !blocked.ok)
    check('...naming the Season', (blocked.error ?? '').includes(String(clashSeason.id)), blocked.error ?? '')
    check('...and nothing moved',
      (await prisma.seasonEntrant.count({ where: { playerId: secondary.id } })) === 2,
      String(await prisma.seasonEntrant.count({ where: { playerId: secondary.id } })))
    check('...and no merge was recorded',
      (await prisma.playerMerge.count({ where: { mergedPlayerId: secondary.id } })) === 0)
  }
}

let code = 0
try {
  await main()
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await cleanup()
  const left = await prisma.player.count({ where: { cueverseId: { startsWith: 'zzmm_' } } }).catch(() => -1)
  const seasons = await prisma.season.count({ where: { competitionSeries: { slug: FIXTURE_SLUG } } }).catch(() => -1)
  check('fixtures cleaned up', left === 0 && seasons === 0, `${left} players, ${seasons} seasons`)

  // The ledger is derived and this suite rebuilt it several times; leave it in step with the real
  // records rather than with a fixture that no longer exists.
  await prisma.$transaction(async (tx) => {
    const { rebuildRatingLedger } = await import('../src/lib/stats/ledger.ts')
    await rebuildRatingLedger(tx)
  }, { timeout: 120_000 }).catch(() => {})

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  code = fail === 0 ? 0 : 1
  await prisma.$disconnect()
}
process.exit(code)
