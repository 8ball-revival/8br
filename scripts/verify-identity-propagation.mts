/**
 * Renaming a player must reach every competition record that copied the old identity.
 *
 * Builds a throwaway Season and Tournament that a fixture player appears in across every
 * denormalised surface, renames them, then asserts nothing anywhere still shows the old handle or
 * the old display name. Also asserts the two things a rename must NOT rewrite: the audit log and the
 * alias history.
 *
 * Everything created is prefixed `zzprop` and removed at the end.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-identity-propagation.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { propagateIdentityChange, identityChanged } from '../src/lib/players/identity-propagation.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}

const TAG = 'zzprop'
const OLD_ID = 'zzprop_oldhandle'
const NEW_ID = 'zzprop_newhandle'
const OLD_NAME = 'zzprop Oldname'
const NEW_NAME = 'zzprop Newname'

async function cleanup() {
  const seasons = await prisma.season.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } })
  const sids = seasons.map((s) => s.id)
  const tours = await prisma.tournament.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } })
  const tids = tours.map((t) => t.id)
  const players = await prisma.player.findMany({ where: { primaryName: { startsWith: TAG } }, select: { id: true } })
  const pids = players.map((p) => p.id)

  if (pids.length) await prisma.ratingLedger.deleteMany({ where: { playerId: { in: pids } } }).catch(() => {})
  if (sids.length) {
    await prisma.seasonMatch.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.seasonStanding.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: { in: sids } } } }).catch(() => {})
    await prisma.seasonGroup.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.season.deleteMany({ where: { id: { in: sids } } }).catch(() => {})
  }
  if (tids.length) {
    await prisma.tournamentMatch.deleteMany({ where: { tournamentId: { in: tids } } }).catch(() => {})
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: { in: tids } } }).catch(() => {})
    await prisma.swissMatch.deleteMany({ where: { tournamentId: { in: tids } } }).catch(() => {})
    await prisma.standing.deleteMany({ where: { tournamentId: { in: tids } } }).catch(() => {})
    await prisma.tournamentBracketMatch.deleteMany({ where: { tournamentId: { in: tids } } }).catch(() => {})
    await prisma.tournamentTeamMember.deleteMany({ where: { team: { tournamentId: { in: tids } } } }).catch(() => {})
    await prisma.tournamentTeam.deleteMany({ where: { tournamentId: { in: tids } } }).catch(() => {})
    await prisma.tournamentFreeAgent.deleteMany({ where: { tournamentId: { in: tids } } }).catch(() => {})
    await prisma.groupPlayer.deleteMany({ where: { group: { tournamentId: { in: tids } } } }).catch(() => {})
    await prisma.tournamentGroup.deleteMany({ where: { tournamentId: { in: tids } } }).catch(() => {})
    await prisma.registration.deleteMany({ where: { tournamentId: { in: tids } } }).catch(() => {})
    await prisma.tournament.deleteMany({ where: { id: { in: tids } } }).catch(() => {})
  }
  if (pids.length) {
    await prisma.playerAlias.deleteMany({ where: { playerId: { in: pids } } }).catch(() => {})
    await prisma.player.deleteMany({ where: { id: { in: pids } } }).catch(() => {})
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: OLD_ID } }).catch(() => {})
}

async function main() {
  await cleanup()

  console.log('--- Fixture: a player appearing everywhere ---')
  const series = await prisma.competitionSeries.findFirst({ where: { active: true }, select: { id: true } })
  if (!series) { check('a Competition exists to attach fixtures to', false); return }

  const subject = await prisma.player.create({
    data: { primaryName: OLD_NAME, cueverseId: OLD_ID, cueverseIdNormalized: OLD_ID.toLowerCase(), active: true },
    select: { id: true },
  })
  const other = await prisma.player.create({
    data: { primaryName: `${TAG} Other`, cueverseId: `${TAG}_other`, cueverseIdNormalized: `${TAG}_other`, active: true },
    select: { id: true },
  })
  // Someone else who happens to share the OLD display name — they must be left alone.
  const namesake = await prisma.player.create({
    data: { primaryName: OLD_NAME, cueverseId: `${TAG}_namesake`, cueverseIdNormalized: `${TAG}_namesake`, active: true },
    select: { id: true },
  })

  const lastN = await prisma.season.findFirst({ orderBy: { number: 'desc' }, select: { number: true } })
  const num = (lastN?.number ?? 0) + 1
  const season = await prisma.season.create({
    data: {
      number: num, competitionYear: 2026, competitionSeriesId: series.id, slug: `${TAG}-season-${num}`,
      lifecycleState: 'COMPLETED', completedAt: new Date(),
      championPlayerId: subject.id, championName: OLD_NAME, championHandle: OLD_ID,
      runnerUpName: `${TAG} Other`, runnerUpHandle: `${TAG}_other`,
    },
    select: { id: true },
  })
  const eA = await prisma.seasonEntrant.create({
    data: { seasonId: season.id, playerId: subject.id, username: OLD_ID, displayName: OLD_NAME, cueverseId: OLD_ID },
    select: { id: true },
  })
  const eB = await prisma.seasonEntrant.create({
    data: { seasonId: season.id, playerId: other.id, username: `${TAG}_other`, displayName: `${TAG} Other` },
    select: { id: true },
  })
  const grp = await prisma.seasonGroup.create({ data: { seasonId: season.id, code: 'A', ordinal: 0, published: true }, select: { id: true } })
  await prisma.seasonMatch.create({
    data: {
      seasonId: season.id, groupId: grp.id, round: 1, homeEntrantId: eA.id, awayEntrantId: eB.id,
      homeUsername: OLD_ID, awayUsername: `${TAG}_other`, status: 'COMPLETED', homeGames: 7, awayGames: 3,
    },
  })
  await prisma.seasonPlayoffMatch.create({
    data: { seasonId: season.id, round: 1, slot: 1, homeUsername: OLD_ID, awayUsername: `${TAG}_other`, published: true },
  })
  await prisma.seasonStanding.create({
    data: { seasonId: season.id, groupId: grp.id, entrantId: eA.id, username: OLD_ID },
  })

  const tour = await prisma.tournament.create({
    data: {
      slug: `${TAG}-t-${num}`, name: `${TAG} Cup`, competitionYear: 2026,
      championName: OLD_NAME, championHandle: OLD_ID,
    },
    select: { id: true },
  })
  const reg = await prisma.registration.create({
    data: { tournamentId: tour.id, username: OLD_ID, displayName: OLD_NAME, playerId: subject.id },
    select: { id: true },
  })
  const reg2 = await prisma.registration.create({
    data: { tournamentId: tour.id, username: `${TAG}_other`, playerId: other.id },
    select: { id: true },
  })
  const tg = await prisma.tournamentGroup.create({
    data: { tournamentId: tour.id, code: 'A', name: 'Group A', ordinal: 0 }, select: { id: true },
  })
  await prisma.tournamentMatch.create({
    data: {
      tournamentId: tour.id, groupId: tg.id, round: 1,
      homeRegistrationId: reg.id, awayRegistrationId: reg2.id,
      homeUsername: OLD_ID, awayUsername: `${TAG}_other`,
    },
  })
  await prisma.playoffMatch.create({
    data: { tournamentId: tour.id, round: 1, slot: 1, homeUsername: OLD_ID, awayUsername: `${TAG}_other` },
  })
  await prisma.standing.create({
    data: { tournamentId: tour.id, groupId: tg.id, registrationId: reg.id, username: OLD_ID },
  })
  await prisma.swissMatch.create({
    data: { tournamentId: tour.id, round: 1, boardOrder: 1, homeName: OLD_NAME, awayName: `${TAG} Other` },
  })
  await prisma.tournamentBracketMatch.create({
    data: {
      tournamentId: tour.id, roundName: 'Final', roundOrder: 1, matchOrder: 1,
      aName: OLD_NAME, aHandle: OLD_ID, bName: `${TAG} Other`, bHandle: `${TAG}_other`,
    },
  })
  const team = await prisma.tournamentTeam.create({
    data: { tournamentId: tour.id, name: `${TAG} Team`, registrationId: reg.id }, select: { id: true },
  })
  await prisma.tournamentTeamMember.create({
    // `name` is required on a roster row — the label shown on the bracket slot.
    data: { teamId: team.id, playerId: subject.id, name: OLD_NAME, handle: OLD_ID, memberOrder: 0 },
  })
  check('team roster fixture created', (await prisma.tournamentTeamMember.count({ where: { teamId: team.id } })) === 1)
  await prisma.ratingLedger.createMany({
    data: [
      {
        matchKey: `${TAG}-m1`, stage: 'GROUP', seasonId: season.id, playerId: subject.id,
        playerName: OLD_NAME, opponentName: `${TAG} Other`, result: 'WIN', actual: 1, expected: 0.5,
        preRating: 1500, ratingChange: 8, postRating: 1508, sequence: 990001, completedAt: new Date(),
      },
      {
        matchKey: `${TAG}-m1`, stage: 'GROUP', seasonId: season.id, playerId: other.id,
        playerName: `${TAG} Other`, opponentName: OLD_NAME, result: 'LOSS', actual: 0, expected: 0.5,
        preRating: 1500, ratingChange: -8, postRating: 1492, sequence: 990002, completedAt: new Date(),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any,
  })
  // An audit row and an alias, both of which must survive the rename untouched.
  await prisma.auditLog.create({
    data: { actorUserId: 999123, actorUsername: OLD_ID, action: 'zzprop.test', entity: 'User' },
  })
  await prisma.playerAlias.create({ data: { playerId: subject.id, alias: 'zzpropoldalias' } })
  check('fixture built across every denormalised surface', true)

  console.log('\n--- Rename ---')
  const change = {
    playerId: subject.id,
    oldCueverseId: OLD_ID, newCueverseId: NEW_ID,
    oldPreferredName: OLD_NAME, newPreferredName: NEW_NAME,
  }
  check('a rename registers as a change', identityChanged(change))
  check('a no-op does not', !identityChanged({ ...change, newCueverseId: OLD_ID, newPreferredName: OLD_NAME }))

  await prisma.player.update({
    where: { id: subject.id },
    data: { cueverseId: NEW_ID, cueverseIdNormalized: NEW_ID.toLowerCase(), primaryName: NEW_NAME },
  })
  const report = await propagateIdentityChange(change)
  check('propagation reported work', report.total > 0, `${report.total} rows`)
  console.log('   ' + JSON.stringify(report.updated))

  console.log('\n--- Nothing anywhere still shows the old identity ---')
  const stale: Array<[string, number]> = [
    ['season entrant username', await prisma.seasonEntrant.count({ where: { username: OLD_ID } })],
    ['season entrant cueverseId', await prisma.seasonEntrant.count({ where: { cueverseId: OLD_ID } })],
    ['season entrant displayName', await prisma.seasonEntrant.count({ where: { playerId: subject.id, displayName: OLD_NAME } })],
    ['season match home', await prisma.seasonMatch.count({ where: { homeUsername: OLD_ID } })],
    ['season playoff home', await prisma.seasonPlayoffMatch.count({ where: { homeUsername: OLD_ID } })],
    ['season standing', await prisma.seasonStanding.count({ where: { username: OLD_ID } })],
    ['season champion handle', await prisma.season.count({ where: { championHandle: OLD_ID } })],
    ['season champion name', await prisma.season.count({ where: { championPlayerId: subject.id, championName: OLD_NAME } })],
    ['registration username', await prisma.registration.count({ where: { username: OLD_ID } })],
    ['registration displayName', await prisma.registration.count({ where: { playerId: subject.id, displayName: OLD_NAME } })],
    ['tournament match home', await prisma.tournamentMatch.count({ where: { homeUsername: OLD_ID } })],
    ['tournament playoff home', await prisma.playoffMatch.count({ where: { homeUsername: OLD_ID } })],
    ['tournament standing', await prisma.standing.count({ where: { username: OLD_ID } })],
    ['tournament champion handle', await prisma.tournament.count({ where: { championHandle: OLD_ID } })],
    ['swiss board name', await prisma.swissMatch.count({ where: { homeName: OLD_NAME } })],
    ['bracket handle', await prisma.tournamentBracketMatch.count({ where: { aHandle: OLD_ID } })],
    ['bracket name', await prisma.tournamentBracketMatch.count({ where: { aName: OLD_NAME } })],
    ['team member handle', await prisma.tournamentTeamMember.count({ where: { playerId: subject.id, handle: OLD_ID } })],
    ['team member name', await prisma.tournamentTeamMember.count({ where: { playerId: subject.id, name: OLD_NAME } })],
    ['ledger playerName', await prisma.ratingLedger.count({ where: { playerId: subject.id, playerName: OLD_NAME } })],
    ['ledger opponentName', await prisma.ratingLedger.count({ where: { matchKey: `${TAG}-m1`, opponentName: OLD_NAME } })],
  ]
  for (const [label, n] of stale) check(`${label} carries no stale value`, n === 0, `${n} left`)

  console.log('\n--- The new identity is actually there ---')
  check('entrant renamed', (await prisma.seasonEntrant.count({ where: { playerId: subject.id, username: NEW_ID, displayName: NEW_NAME } })) === 1)
  check('season match renamed', (await prisma.seasonMatch.count({ where: { homeUsername: NEW_ID } })) === 1)
  check('season champion renamed', (await prisma.season.count({ where: { id: season.id, championHandle: NEW_ID, championName: NEW_NAME } })) === 1)
  check('tournament champion renamed', (await prisma.tournament.count({ where: { id: tour.id, championHandle: NEW_ID, championName: NEW_NAME } })) === 1)
  check('bracket slot renamed', (await prisma.tournamentBracketMatch.count({ where: { aHandle: NEW_ID, aName: NEW_NAME } })) === 1)
  check("the opponent's ledger row now names the new identity",
    (await prisma.ratingLedger.count({ where: { matchKey: `${TAG}-m1`, playerId: other.id, opponentName: NEW_NAME } })) === 1)

  console.log('\n--- Nobody else was touched ---')
  check('the other player keeps their handle',
    (await prisma.seasonMatch.count({ where: { awayUsername: `${TAG}_other` } })) === 1)
  check('a namesake with the same old display name is untouched',
    (await prisma.player.count({ where: { id: namesake.id, primaryName: OLD_NAME } })) === 1)
  check('the runner-up fields are untouched',
    (await prisma.season.count({ where: { id: season.id, runnerUpHandle: `${TAG}_other` } })) === 1)

  console.log('\n--- History that must NOT be rewritten ---')
  check('the audit log still records the old handle',
    (await prisma.auditLog.count({ where: { actorUsername: OLD_ID } })) === 1)
  check('the alias history is untouched',
    (await prisma.playerAlias.count({ where: { playerId: subject.id, alias: 'zzpropoldalias' } })) === 1)

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
