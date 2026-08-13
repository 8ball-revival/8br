/**
 * Verifies the tournament CREATION backend: all four formats, individual + team (all sizes),
 * team formation, race length, scheduling (start-now vs later), access (open vs password — hashed,
 * never plaintext), curated flair (validated/sanitized), and every validation guard. Uses the real
 * createTournament service + prisma. Self-cleans (all rows use the VC* code prefix / high numbers).
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-create.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { createTournament, type CreateTournamentConfig } from '../src/lib/competition/tournament-create.ts'
import { verifyJoinPassword } from '../src/lib/competition/join-password.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 950001, username: 'create-verify' }

const base: CreateTournamentConfig = { name: 'X', participantFormat: 'INDIVIDUAL', tournamentFormat: 'SINGLE_ELIM', raceLength: 7 }
async function make(cfg: Partial<CreateTournamentConfig>, name: string) {
  return createTournament(actor, { ...base, ...cfg, name })
}
const createdIds: number[] = []
async function ok(cfg: Partial<CreateTournamentConfig>, name: string) {
  const r = await make(cfg, name)
  if (r.ok && r.id) createdIds.push(r.id)
  return r
}

console.log('\n--- formats ---')
for (const fmt of ['SINGLE_ELIM', 'DOUBLE_ELIM', 'SWISS', 'GROUPS_PLAYOFFS'] as const) {
  const extra = fmt === 'SWISS' ? { swissRounds: 5 } : fmt === 'GROUPS_PLAYOFFS' ? { groupCount: 4, qualifiersPerGroup: 2 } : {}
  const r = await ok({ tournamentFormat: fmt, ...extra }, `VC ${fmt}`)
  check(`create ${fmt}`, r.ok)
  if (r.id) {
    const t = await prisma.tournament.findUniqueOrThrow({ where: { id: r.id } })
    check(`${fmt} persisted format`, t.tournamentFormat === fmt)
    check(`${fmt} starts in DRAFT + start-now flag`, t.lifecycleState === 'DRAFT' && r.startNow === true)
    if (fmt === 'SWISS') check('swiss rounds stored', t.swissRounds === 5)
    if (fmt === 'GROUPS_PLAYOFFS') check('group config stored', t.groupCount === 4 && t.qualifiersPerGroup === 2)
  }
}

console.log('\n--- participants / team sizes / formation ---')
for (const size of [2, 3, 4, 5, 6]) {
  const r = await ok({ participantFormat: 'TEAM', teamSize: size, teamFormation: size % 2 === 0 ? 'RANDOM' : 'PICK' }, `VC Team ${size}`)
  if (r.id) {
    const t = await prisma.tournament.findUniqueOrThrow({ where: { id: r.id } })
    check(`team of ${size} stored with formation`, t.teamSize === size && t.teamFormation === (size % 2 === 0 ? 'RANDOM' : 'PICK'))
  }
}

console.log('\n--- scheduling ---')
{
  const now = await ok({}, 'VC Now')
  check('start-now → startNow true, no scheduledStartAt', now.startNow === true && (await prisma.tournament.findUniqueOrThrow({ where: { id: now.id! } })).scheduledStartAt === null)
  const later = await ok({ scheduleForLater: true, scheduledStartAt: '2027-01-01T19:00' }, 'VC Later')
  const lt = await prisma.tournament.findUniqueOrThrow({ where: { id: later.id! } })
  check('schedule-later → startNow false + scheduledStartAt set', later.startNow === false && lt.scheduledStartAt != null)
}

console.log('\n--- access (password hashed, never plaintext) ---')
{
  const priv = await ok({ accessMode: 'PASSWORD', joinPassword: 'topsecret' }, 'VC Private')
  const t = await prisma.tournament.findUniqueOrThrow({ where: { id: priv.id! } })
  check('password tournament stores accessMode', t.accessMode === 'PASSWORD')
  check('join password stored as a hash, not plaintext', !!t.joinPasswordHash && !t.joinPasswordHash.includes('topsecret'))
  check('stored hash verifies against the password', verifyJoinPassword('topsecret', t.joinPasswordHash))
}

console.log('\n--- flair (validated + sanitized) ---')
{
  const r = await ok({ flair: { badge: 'trophy', description: 'Hello <script>alert(1)</script> world' } }, 'VC Flair')
  const t = await prisma.tournament.findUniqueOrThrow({ where: { id: r.id! } })
  check('badge stored', t.badge === 'trophy')
  check('description sanitized (script stripped)', !!t.description && !/script/i.test(t.description))
}

console.log('\n--- validation guards (all must be refused) ---')
check('rejects: empty name', !(await createTournament(actor, { ...base, name: '   ' })).ok)
const bad: [string, Partial<CreateTournamentConfig>][] = [
  ['race length 0', { raceLength: 0 }],
  ['team size 1', { participantFormat: 'TEAM', teamSize: 1 }],
  ['team size 7', { participantFormat: 'TEAM', teamSize: 7 }],
  ['password too short', { accessMode: 'PASSWORD', joinPassword: 'ab' }],
  ['swiss rounds 0', { tournamentFormat: 'SWISS', swissRounds: 0 }],
  ['groups: 0 groups', { tournamentFormat: 'GROUPS_PLAYOFFS', groupCount: 0, qualifiersPerGroup: 2 }],
  ['bad schedule date', { scheduleForLater: true, scheduledStartAt: 'not-a-date' }],
  ['unknown badge', { flair: { badge: 'skull' } }],
]
for (const [label, cfg] of bad) {
  const r = await make(cfg, `VC Bad ${label}`)
  check(`rejects: ${label}`, !r.ok)
  if (r.ok && r.id) createdIds.push(r.id)
}

// cleanup
await prisma.tournament.deleteMany({ where: { OR: [{ id: { in: createdIds } }, { code: { startsWith: 'T' }, name: { startsWith: 'VC ' } }] } }).catch(() => {})
await prisma.auditLog.deleteMany({ where: { actorUsername: 'create-verify' } }).catch(() => {})
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
