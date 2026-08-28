/**
 * The parts of the schema Prisma cannot express, applied after `db push`.
 *
 * ── Why this file has to exist ──────────────────────────────────────────────────────────────────
 * Production's Season uniqueness is an EXPRESSION index, built on COALESCE(division, ''), so a
 * second Season with no division collides with the first instead of slipping past SQL's rule that
 * NULLs are all distinct. Prisma has no syntax for an expression index, so `db push` cannot create
 * it and `schema.prisma` deliberately does not declare it — a plain four-column version would be a
 * weaker constraint wearing the same name.
 *
 * Which left development with a schema that was quietly LOOSER than production: a duplicate Season
 * number that the live database would reject was accepted locally, so the bug would only ever be
 * found in production. `verify-season-numbering` caught exactly that.
 *
 * Anything else production has that Prisma cannot describe belongs here too, so the two schemas stay
 * the same shape rather than drifting apart one un-expressible object at a time.
 */
import { prisma } from '../../src/lib/prisma.ts'
import { assertFixtureDatabase } from '../../src/lib/db-guard.ts'

assertFixtureDatabase('dev:reset (schema extras)')

await prisma.$executeRawUnsafe(`
  create unique index if not exists season_competition_year_number_division_key
    on public.season ("competitionSeriesId", "competitionYear", number, coalesce(division, ''))`)

/*
 * The CHECK constraints, taken from production rather than invented here.
 *
 * Prisma has no syntax for a CHECK, so none of these survive `db push` either. They are the rules
 * the database enforces on its own — a Season number that must be positive, a vote that may only be
 * plus or minus one, a report that must name exactly one of a post or a comment. Without them,
 * development accepts rows the live database would reject, which is the wrong way round for a
 * safety net.
 *
 * `add constraint if not exists` does not exist in PostgreSQL, so each is dropped first: the whole
 * point is that re-running this leaves the same database.
 */
const CHECKS: [table: string, name: string, definition: string][] = [
  ['season', 'season_number_positive', 'check (number > 0)'],
  ['season', 'season_competitionYear_range', 'check ("competitionYear" >= 1900 and "competitionYear" <= 2100)'],
  ['comp_tournament', 'comp_tournament_competitionYear_range', 'check ("competitionYear" >= 1900 and "competitionYear" <= 2100)'],
  ['break_post_vote', 'break_post_vote_value', 'check (value = any (array[-1, 1]))'],
  ['break_comment_vote', 'break_comment_vote_value', 'check (value = any (array[-1, 1]))'],
  ['break_report', 'break_report_one_target', 'check (("postId" is null) <> ("commentId" is null))'],
]

for (const [table, name, definition] of CHECKS) {
  await prisma.$executeRawUnsafe(`alter table public.${table} drop constraint if exists "${name}"`)
  await prisma.$executeRawUnsafe(`alter table public.${table} add constraint "${name}" ${definition}`)
}

console.log(`  ✓ Season uniqueness index and ${CHECKS.length} CHECK constraints applied (matching production)`)
await prisma.$disconnect()
