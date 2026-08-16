/**
 * Verifies playoff publication + public visibility for Group Stage + Playoffs (and bracket formats):
 *  - the centralized visibility helper (canViewPlayoffs) and server-side redaction (redactPlayoffs);
 *  - generating a bracket does NOT publish it; publishing makes it visible; publishing is idempotent
 *    and refuses a nonexistent bracket.
 * Self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-playoff-visibility.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { reseedEntrants, rebuildManualPlayoff, publishPlayoff } from '../src/lib/competition/service.ts'
import { canViewPlayoffs, redactPlayoffs } from '../src/lib/competition/playoff-visibility.ts'
import type { TournamentWorkspaceData } from '../src/lib/tournaments/live.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 950001, username: 'vis-verify' }

console.log('Visibility rule (canViewPlayoffs)')
check('staff may view even an UNpublished bracket', canViewPlayoffs({ isStaff: true, playoffsPublished: false }) === true)
check('public may NOT view before publication', canViewPlayoffs({ isStaff: false, playoffsPublished: false }) === false)
check('public MAY view after publication', canViewPlayoffs({ isStaff: false, playoffsPublished: true }) === true)

console.log('\nServer-side redaction (redactPlayoffs)')
const sample = {
  entrants: [{ registrationId: 1 }, { registrationId: 2 }],
  teams: [],
  matches: [{ id: 1 }, { id: 2 }],
  bracketRounds: [{ name: 'Final', matches: [{ a: { name: 'Seed 1' }, b: { name: 'Seed 2' } }] }],
  hasBracket: true,
  hasPublishedBracket: true,
  hasResults: true,
  bracketStale: true,
  isGroupStage: true,
  groups: [{ id: 7, name: 'Group A', standings: [{ username: 'a' }] }],
} as unknown as TournamentWorkspaceData

const hidden = redactPlayoffs(sample, false)
check('redacted: bracketRounds emptied', hidden.bracketRounds.length === 0)
check('redacted: playoff matches emptied', hidden.matches.length === 0)
check('redacted: hasBracket / hasPublishedBracket false', !hidden.hasBracket && !hidden.hasPublishedBracket)
check('redacted: NO seed/matchup strings leak', !JSON.stringify(hidden).includes('Seed 1'))
check('redacted: groups + entrants preserved', hidden.groups.length === 1 && hidden.entrants.length === 2)
check('not redacted when viewer may see it', redactPlayoffs(sample, true).bracketRounds.length === 1)

console.log('\nPublish flow (generate ≠ publish; publish makes visible; idempotent; guards)')
const t = await prisma.tournament.create({
  data: {
    slug: 'vis-verify', name: 'Vis Verify', competitionYear: new Date().getFullYear(), code: 'VIS1', number: 95001,
    tournamentFormat: 'SINGLE_ELIM', participantFormat: 'INDIVIDUAL', raceLength: 5,
    lifecycleState: 'REGISTRATION_CLOSED', registrationStatus: 'CLOSED', status: 'UPCOMING', playoffsStatus: 'PENDING',
  },
})
const tid = t.id
try {
  // Publishing a nonexistent bracket is refused.
  const early = await publishPlayoff(actor, tid)
  check('refuses to publish a nonexistent bracket', !early.ok)

  const ids: number[] = []
  for (let i = 1; i <= 4; i++) { const r = await prisma.registration.create({ data: { tournamentId: tid, username: `p${i}`, displayName: `P${i}`, status: 'APPROVED', approvedAt: new Date() } }); ids.push(r.id) }
  await reseedEntrants(actor, tid, ids)
  await rebuildManualPlayoff(actor, tid, ids)

  // Generation did NOT publish.
  const afterBuild = await prisma.tournament.findUniqueOrThrow({ where: { id: tid }, select: { playoffsStatus: true } })
  const publishedAfterBuild = await prisma.playoffMatch.count({ where: { tournamentId: tid, published: true } })
  check('generating the bracket does NOT publish it', afterBuild.playoffsStatus !== 'PUBLISHED' && publishedAfterBuild === 0)

  // Publish → visible.
  const pub = await publishPlayoff(actor, tid)
  check('publish succeeds', pub.ok)
  const afterPub = await prisma.tournament.findUniqueOrThrow({ where: { id: tid }, select: { playoffsStatus: true } })
  const unpublished = await prisma.playoffMatch.count({ where: { tournamentId: tid, published: false } })
  check('publish persists PUBLISHED state + marks every match published', afterPub.playoffsStatus === 'PUBLISHED' && unpublished === 0)
  check('publish records an audit entry (who/when)', !!(await prisma.auditLog.findFirst({ where: { entityId: String(tid), action: 'playoff.publish' } })))

  // Idempotent — a duplicate publish is safe.
  const again = await publishPlayoff(actor, tid)
  const stillUnpublished = await prisma.playoffMatch.count({ where: { tournamentId: tid, published: false } })
  check('duplicate publish is safe (idempotent)', again.ok && stillUnpublished === 0)
} finally {
  await prisma.tournament.delete({ where: { id: tid } }).catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail) process.exit(1)
