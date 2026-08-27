/**
 * Rebuild the Tournament snapshot cache from the Tournaments that actually exist.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * `comp_tournament_snapshot` is a singleton cache — one row, holding the derived Tournament payload
 * every consumer resolves against. It held five Tournaments where the database has three: numbers 4
 * and 5 were `zzverify-gp singles` and `zzverify-gp teams`, fixtures a verification suite created
 * and deleted. The suite removed the Tournaments and left the cache describing them, both still
 * marked `live`.
 *
 * Nothing regenerates the cache on a schedule, so the residue survived every dump taken since. It is
 * normally invisible: a full verification sweep happens to rebuild the cache partway through, which
 * is why `verify-registry-reset` only catches it when run alone.
 *
 * ── What it touches ─────────────────────────────────────────────────────────────────────────────
 * The one cache row, and nothing else. It calls `regenerateTournamentSnapshot`, the same service a
 * Tournament mutation calls, which READS the Tournament table and rewrites the payload from it — so
 * the cache cannot say anything the database does not, and no Tournament, Player, Season, match,
 * rating or audit row is written. The revision advances, which is what a cache rebuild is.
 *
 * Idempotent: running it again rebuilds the same payload from the same rows.
 *
 * Usage: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/regenerate-tournament-snapshot.mts [--apply]
 *        Without --apply it reports the drift and writes nothing.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { regenerateTournamentSnapshot } from '../src/lib/tournaments/migrate.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')

const numbersIn = (payload: unknown): number[] =>
  Array.isArray(payload)
    ? (payload as Array<{ number?: number }>).map((c) => c.number).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b)
    : []

const real = (await prisma.tournament.findMany({ select: { number: true, name: true }, orderBy: { number: 'asc' } }))
const realNumbers = real.map((t) => t.number)
console.log(`Tournaments in the database: ${real.map((t) => `${t.number} ${t.name}`).join(', ')}`)

const before = await prisma.tournamentSnapshot.findUnique({ where: { id: 1 } })
const cachedBefore = numbersIn(before?.payload)
console.log(`Cache revision ${before?.revision ?? '(none)'} lists: ${cachedBefore.join(', ') || 'nothing'}`)

const stale = cachedBefore.filter((n) => !realNumbers.includes(n))
const missing = realNumbers.filter((n) => !cachedBefore.includes(n))
console.log(`  stale (cached, no such Tournament): ${stale.join(', ') || 'none'}`)
console.log(`  missing (exists, not cached):       ${missing.join(', ') || 'none'}`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.')
  await prisma.$disconnect()
  process.exit(0)
}

const revision = await regenerateTournamentSnapshot()
const after = await prisma.tournamentSnapshot.findUnique({ where: { id: 1 } })
const cachedAfter = numbersIn(after?.payload)
console.log(`\nrebuilt at revision ${revision}; cache now lists: ${cachedAfter.join(', ') || 'nothing'}`)

const ok =
  cachedAfter.length === realNumbers.length && cachedAfter.every((n, i) => n === realNumbers[i])
console.log(ok ? 'the cache and the database agree' : 'MISMATCH — the cache does not match the Tournament table')
await prisma.$disconnect()
process.exit(ok ? 0 : 1)
