/**
 * Seed / reset the single active registration: 2026 Tournament 2, registration OPEN.
 * Idempotent — safe to re-run. Staff can further edit it at /staff/tournament.
 *
 *   npx tsx scripts/seed-season2.mts
 */
import { prisma } from '../src/lib/prisma.ts'

const slug = 'ego-tournament-2'
const closesAt = new Date('2026-08-28T06:00:00-07:00') // Aug 28 2026, 6:00 AM MST
const opensAt = new Date('2026-07-01T00:00:00-07:00')

const tournament = await prisma.tournament.upsert({
  where: { slug },
  update: {
    name: '2026 Tournament 2',
    registrationStatus: 'OPEN',
    registrationOpensAt: opensAt,
    registrationClosesAt: closesAt,
  },
  create: {
    slug,
    name: '2026 Tournament 2',
    status: 'UPCOMING',
    registrationStatus: 'OPEN',
    registrationOpensAt: opensAt,
    registrationClosesAt: closesAt,
    raceLength: 5,
    qualifiersPerGroup: 2,
    formatSummary: 'Group stage into single-elimination playoffs',
    eligibilitySummary: 'Open to all registered 8 Ball Revival account holders.',
  },
})

console.log(`Seeded: #${tournament.id} "${tournament.name}" (${tournament.slug}) — registration ${tournament.registrationStatus}, closes ${tournament.registrationClosesAt?.toISOString()}`)
process.exit(0)
