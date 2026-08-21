/**
 * Verifies the DRAFT bracket contract for Tournaments:
 *
 *   - a draft seats round 1 and nobody beyond it, byes included
 *   - round-1 positions can be rearranged by hand, as a swap
 *   - a seed number belongs to the position, not the player
 *   - publishing walks byes through into round 2
 *   - publishing recomputes advancement rather than trusting stale seats
 *   - placement is refused once the bracket is published
 *   - a bye is never offered for scoring
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-bracket-draft-placement.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import * as svc from '../src/lib/competition/service.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-bracket-draft' }
const TAG = 'zzbdp'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
function section(t: string) { console.log(`\n--- ${t} ---`) }

async function cleanup() {
  const ts = await prisma.tournament.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })
  for (const t of ts) {
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: t.id } })
    await prisma.registration.deleteMany({ where: { tournamentId: t.id } })
    await prisma.tournament.delete({ where: { id: t.id } }).catch(() => {})
  }
  await prisma.$executeRawUnsafe(`DELETE FROM payload.users WHERE username LIKE '${TAG}%'`)
}

/** A five-entrant tournament: not a power of two, so it has real byes to argue about. */
async function makeTournament(entrants: number) {
  const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })
  const maxNo = (await prisma.tournament.aggregate({ _max: { number: true } }))._max.number ?? 0
  const t = await prisma.tournament.create({
    data: {
      number: maxNo + 1,
      name: `${TAG} draft placement`,
      slug: `${TAG}-draft-placement-${maxNo + 1}`,
      competitionYear: 2099,
      competitionSeriesId: series.id,
      tournamentFormat: 'SINGLE_ELIM',
      participantFormat: 'INDIVIDUAL',
      lifecycleState: 'REGISTRATION_CLOSED',
      registrationStatus: 'CLOSED',
      raceLength: 5,
    },
    select: { id: true },
  })
  const regIds: number[] = []
  for (let i = 0; i < entrants; i++) {
    const u = await prisma.$queryRaw<{ id: number }[]>`
      INSERT INTO payload.users (email, username, hash, salt, updated_at, created_at)
      VALUES (${`${TAG}-${i}@example.invalid`}, ${`${TAG}-${i}`}, 'x', 'x', now(), now())
      RETURNING id`
    const r = await prisma.registration.create({
      data: { tournamentId: t.id, userId: Number(u[0].id), username: `${TAG}-${i}`, status: 'APPROVED', seed: i + 1 },
      select: { id: true },
    })
    regIds.push(r.id)
  }
  return { tournamentId: t.id, regIds }
}

const round1 = (tournamentId: number) =>
  prisma.playoffMatch.findMany({ where: { tournamentId, round: 1 }, orderBy: { slot: 'asc' } })
const beyond1 = (tournamentId: number) =>
  prisma.playoffMatch.findMany({ where: { tournamentId, round: { gt: 1 } }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })

async function main() {
  await cleanup()

  // Five entrants → an 8-slot bracket with 3 byes.
  const { tournamentId: tid, regIds } = await makeTournament(5)

  section('A draft seats the first round and nothing beyond it')
  const built = await svc.rebuildManualPlayoff(ACTOR, tid, regIds)
  check('the draft bracket builds', built.ok, built.error)

  const r1 = await round1(tid)
  const later = await beyond1(tid)
  check('an 8-slot bracket: 4 first-round matches', r1.length === 4, String(r1.length))
  check('...and 3 matches beyond it', later.length === 3, String(later.length))
  check('all five entrants are seated in round 1',
    r1.flatMap((m) => [m.homeRegistrationId, m.awayRegistrationId]).filter((x) => x != null).length === 5)
  check('three positions are byes',
    r1.flatMap((m) => [m.homeRegistrationId, m.awayRegistrationId]).filter((x) => x == null).length === 3)
  check('NOBODY is advanced past round 1',
    later.every((m) => m.homeRegistrationId == null && m.awayRegistrationId == null))
  check('...and no name is left showing there either',
    later.every((m) => m.homeUsername == null && m.awayUsername == null))
  check('nothing is published yet', (await prisma.playoffMatch.count({ where: { tournamentId: tid, published: true } })) === 0)

  section('Round-1 positions can be rearranged by hand')
  // Seed 1 sits at slot 0 home; find a different, occupied position to trade with.
  const top = r1[0]
  const other = r1.find((m) => m.id !== top.id && m.homeRegistrationId != null)!
  const a = top.homeRegistrationId!
  const b = other.homeRegistrationId!
  const seedAtTop = top.homeSeed
  const seedAtOther = other.homeSeed

  const moved = await svc.setTournamentBracketSlot(ACTOR, tid, top.id, 'home', b)
  check('a player can be dropped into another position', moved.ok, moved.error)

  const afterSwap = await round1(tid)
  const topNow = afterSwap.find((m) => m.id === top.id)!
  const otherNow = afterSwap.find((m) => m.id === other.id)!
  check('the dragged player is now in the target position', topNow.homeRegistrationId === b)
  check('...and the one who was there took their place — a swap, not an overwrite', otherNow.homeRegistrationId === a)
  check('the field is still exactly five players',
    afterSwap.flatMap((m) => [m.homeRegistrationId, m.awayRegistrationId]).filter((x) => x != null).length === 5)
  check('the seed number stayed with the POSITION', topNow.homeSeed === seedAtTop && otherNow.homeSeed === seedAtOther)

  section('A player can be given a bye that belonged to someone else')
  const byeSeat = afterSwap.find((m) => m.awayRegistrationId == null && m.homeRegistrationId != null)
  const origin = afterSwap.find((m) => m.id !== byeSeat?.id && m.homeRegistrationId != null)
  if (!byeSeat || !origin) {
    check('there is a bye position to test with', false)
  } else {
    const mover = origin.homeRegistrationId!
    const displaced = byeSeat.homeRegistrationId!
    const r = await svc.setTournamentBracketSlot(ACTOR, tid, byeSeat.id, 'away', mover)
    check('a player can be dropped onto a bye position', r.ok, r.error)
    const now = await round1(tid)
    check('...they are there',
      now.find((m) => m.id === byeSeat.id)!.awayRegistrationId === mover)
    check('...so that bye is now a real match',
      now.find((m) => m.id === byeSeat.id)!.homeRegistrationId === displaced)
    check('...and the position they left became the bye',
      now.find((m) => m.id === origin.id)!.homeRegistrationId == null)
    check('...with the field still five strong — a bye is a position, not a deletion',
      now.flatMap((m) => [m.homeRegistrationId, m.awayRegistrationId]).filter((x) => x != null).length === 5)

    // Undo it by dragging them home again, so the bye maths below is the plain case. Moving them
    // back must also carry the displaced player back — the swap has to be its own inverse.
    await svc.setTournamentBracketSlot(ACTOR, tid, origin.id, 'home', mover)
    const restored = await round1(tid)
    check('dragging them back restores the draw exactly',
      restored.find((m) => m.id === origin.id)!.homeRegistrationId === mover
      && restored.find((m) => m.id === byeSeat.id)!.awayRegistrationId == null
      && restored.find((m) => m.id === byeSeat.id)!.homeRegistrationId === displaced)
  }

  section('Later rounds are played for, not arranged')
  const anyLater = (await beyond1(tid))[0]
  const refusedRound = await svc.setTournamentBracketSlot(ACTOR, tid, anyLater.id, 'home', regIds[0])
  check('placing into round 2 is refused', !refusedRound.ok)
  check('...saying why', /first round/i.test(refusedRound.error ?? ''), refusedRound.error)

  section('Publishing walks the byes through')
  const beforePublish = await round1(tid)
  const byeMatches = beforePublish.filter((m) =>
    (m.homeRegistrationId == null) !== (m.awayRegistrationId == null))
  check('five entrants in an eight-slot bracket leaves exactly three byes',
    byeMatches.length === 3, String(byeMatches.length))

  const pub = await svc.publishPlayoff(ACTOR, tid)
  check('the bracket publishes', pub.ok, pub.error)
  check('every match is public', (await prisma.playoffMatch.count({ where: { tournamentId: tid, published: false } })) === 0)

  const advanced = await beyond1(tid)
  for (const m of byeMatches) {
    const who = m.homeRegistrationId ?? m.awayRegistrationId
    const target = advanced.find((x) => x.id === m.feedsMatchId)
    const seatedId = m.feedsSlot === 0 ? target?.homeRegistrationId : target?.awayRegistrationId
    check(`the bye in slot ${m.slot} advanced its player`, seatedId === who,
      `expected ${who}, found ${seatedId}`)
  }
  check('a bye match still records NO winner — nobody played',
    byeMatches.every((m) => m.winnerRegistrationId == null))
  const reread = await round1(tid)
  check('...still true after publishing',
    reread.filter((m) => (m.homeRegistrationId == null) !== (m.awayRegistrationId == null))
      .every((m) => m.winnerRegistrationId == null))
  check('a bye is never offered for scoring — it has no second name',
    reread.filter((m) => m.homeUsername == null || m.awayUsername == null).length === byeMatches.length)

  section('A published bracket is no longer arranged')
  const refusedPub = await svc.setTournamentBracketSlot(ACTOR, tid, reread[0].id, 'home', regIds[0])
  check('placement is refused once published', !refusedPub.ok)
  check('...and points at returning to draft', /draft/i.test(refusedPub.error ?? ''), refusedPub.error)

  section('Publication stays reversible')
  const back = await svc.returnPlayoffToDraft(ACTOR, tid)
  check('the bracket can go back to draft — publishing was not a one-way door', back.ok, back.error)
  check('...and placement works again',
    (await svc.setTournamentBracketSlot(ACTOR, tid, reread[0].id, 'home', regIds[0])).ok)

  section('Publishing recomputes advancement instead of trusting stale seats')
  // Plant a seat that belongs to no bye — exactly what an old draft, or a rearranged one, leaves.
  const stale = (await beyond1(tid))[0]
  await prisma.playoffMatch.update({
    where: { id: stale.id },
    data: { homeRegistrationId: regIds[0], homeUsername: 'STALE', homeSeed: 99 },
  })
  const rePub = await svc.publishPlayoff(ACTOR, tid)
  check('it publishes again', rePub.ok, rePub.error)
  const afterRe = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: stale.id } })
  check('the invented seat is gone', afterRe.homeUsername !== 'STALE',
    String(afterRe.homeUsername))

  await cleanup()
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  if (fail > 0) process.exitCode = 1
}

main().catch(async (e) => {
  console.error(e)
  await cleanup().catch(() => {})
  await prisma.$disconnect()
  process.exitCode = 1
})
