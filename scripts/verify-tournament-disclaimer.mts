/**
 * The note shown under a Tournament's playoff bracket: saved, trimmed, capped, clearable, refused
 * before a bracket exists, and — deliberately — still editable once the tournament is finished,
 * which is exactly when a reconstructed bracket needs one. Self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-tournament-disclaimer.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { reseedEntrants, rebuildManualPlayoff, setTournamentPlayoffDisclaimer } from '../src/lib/competition/service.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const actor = { userId: 930001, username: 'zzdisc-verify' }

const t = await prisma.tournament.create({
  data: {
    slug: 'zzdisc-verify', name: 'Disclaimer Verify', competitionYear: new Date().getFullYear(),
    code: 'ZZD1', number: 93001,
    tournamentFormat: 'SINGLE_ELIM', participantFormat: 'INDIVIDUAL', raceLength: 5,
    lifecycleState: 'REGISTRATION_CLOSED', registrationStatus: 'CLOSED', status: 'UPCOMING', playoffsStatus: 'PENDING',
  },
})
const tid = t.id
const read = async () =>
  (await prisma.tournament.findUnique({ where: { id: tid }, select: { playoffDisclaimer: true } }))?.playoffDisclaimer ?? null

try {
  console.log('--- Before a bracket exists ---')
  check('a tournament starts with no note', (await read()) === null)
  const early = await setTournamentPlayoffDisclaimer(actor, tid, 'Too soon.')
  check('a note is refused with no bracket to annotate', !early.ok, 'it was allowed')
  const missing = await setTournamentPlayoffDisclaimer(actor, 99999999, 'nowhere')
  check('an unknown tournament is refused', !missing.ok, 'it was allowed')

  console.log('')
  console.log('--- With a bracket ---')
  const ids: number[] = []
  for (let i = 1; i <= 4; i++) {
    const r = await prisma.registration.create({
      data: { tournamentId: tid, username: `zzd${i}`, displayName: `ZZD${i}`, status: 'APPROVED', approvedAt: new Date() },
    })
    ids.push(r.id)
  }
  await reseedEntrants(actor, tid, ids)
  await rebuildManualPlayoff(actor, tid, ids)
  check('bracket built', (await prisma.playoffMatch.count({ where: { tournamentId: tid } })) > 0)

  const note = 'Pairings are taken from the archive; the scores were never recorded and are approximate.'
  const set = await setTournamentPlayoffDisclaimer(actor, tid, note)
  check('a note can be saved', set.ok, set.error)
  check('the note is stored verbatim', (await read()) === note)

  check('surrounding whitespace is trimmed',
    (await setTournamentPlayoffDisclaimer(actor, tid, '   spaced   ')).ok && (await read()) === 'spaced')

  check('over-long text is capped rather than rejected',
    (await setTournamentPlayoffDisclaimer(actor, tid, 'x'.repeat(900))).ok && ((await read()) ?? '').length === 500)

  // The whole point: a reconstructed tournament is entered, finished, and only THEN annotated.
  await prisma.tournament.update({ where: { id: tid }, data: { lifecycleState: 'COMPLETED', status: 'COMPLETED' } })
  const done = await setTournamentPlayoffDisclaimer(actor, tid, 'Edited after the tournament completed.')
  check('the note is still editable once the tournament is completed', done.ok, done.error)
  check('the last edit stuck', (await read()) === 'Edited after the tournament completed.')

  check('blank text clears the note', (await setTournamentPlayoffDisclaimer(actor, tid, '   ')).ok && (await read()) === null)
  check('null clears the note', (await setTournamentPlayoffDisclaimer(actor, tid, null)).ok && (await read()) === null)

  console.log('')
  console.log('--- The edit is audited ---')
  await setTournamentPlayoffDisclaimer(actor, tid, 'Audited.')
  const logged = await prisma.auditLog.count({
    where: { actorUsername: 'zzdisc-verify', action: 'tournament.playoff.disclaimer' },
  })
  check('saving writes an audit entry', logged > 0)
  await setTournamentPlayoffDisclaimer(actor, tid, null)
  const cleared = await prisma.auditLog.count({
    where: { actorUsername: 'zzdisc-verify', action: 'tournament.playoff.disclaimer.clear' },
  })
  check('clearing writes its own audit entry', cleared > 0)
} catch (e) {
  fail++
  console.error(e)
} finally {
  await prisma.tournament.delete({ where: { id: tid } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: 'zzdisc-verify' } }).catch(() => {})
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
// Deleting a Tournament directly leaves the derived snapshot cache listing one that no longer
// exists; the app's own delete action rebuilds it, so a test that bypasses that action must too.
{
  const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
  await regenerateTournamentSnapshot().catch(() => {})
}
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
