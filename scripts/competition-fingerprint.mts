/**
 * Row counts and content fingerprints for every canonical competition table.
 *
 * Run before and after a large change: the counts say whether anything appeared or vanished, and the
 * fingerprints say whether anything CHANGED while the counts stayed still — which a count alone can
 * never tell you. Deterministic, so two runs of an untouched database produce identical output.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/competition-fingerprint.mts
 */
import crypto from 'node:crypto'
import { prisma } from '../src/lib/prisma.ts'

/** table → the columns whose content defines "unchanged", in a stable order. */
const TABLES: { table: string; key: string; cols: string[] }[] = [
  { table: 'competition_series', key: 'id', cols: ['name', 'slug', 'active'] },
  { table: 'season', key: 'id', cols: ['number', 'competitionYear', 'competitionSeriesId', 'division', 'lifecycleState', 'championName', 'championHandle', 'runnerUpName', 'finalScore', 'archiveTemplateKey', 'entrantsCount'] },
  { table: 'season_entrant', key: 'id', cols: ['seasonId', 'playerId', 'username', 'displayName', 'status', 'playoffIncluded', 'playoffSeed', 'qualification'] },
  { table: 'season_group', key: 'id', cols: ['seasonId', 'name', 'ordinal'] },
  { table: 'season_match', key: 'id', cols: ['seasonId', 'groupId', 'homeEntrantId', 'awayEntrantId', 'homeGames', 'awayGames', 'status', 'completedAt'] },
  { table: 'season_standing', key: 'id', cols: ['groupId', 'entrantId', 'played', 'wins', 'losses', 'draws', 'points', 'rank'] },
  { table: 'season_playoff_match', key: 'id', cols: ['seasonId', 'round', 'slot', 'homeEntrantId', 'awayEntrantId', 'homeGames', 'awayGames', 'winnerEntrantId', 'status', 'published'] },
  { table: 'comp_tournament', key: 'id', cols: ['number', 'name', 'competitionYear', 'competitionSeriesId', 'lifecycleState', 'tournamentFormat', 'participantFormat', 'championName', 'championHandle', 'runnerUpName', 'finalScore'] },
  { table: 'comp_registration', key: 'id', cols: ['tournamentId', 'playerId', 'username', 'status', 'seed'] },
  { table: 'comp_tournament_team', key: 'id', cols: ['tournamentId', 'name', 'registrationId'] },
  { table: 'comp_tournament_team_member', key: 'id', cols: ['teamId', 'playerId', 'name', 'captain'] },
  { table: 'comp_tournament_group', key: 'id', cols: ['tournamentId', 'name', 'ordinal'] },
  { table: 'comp_tournament_match', key: 'id', cols: ['tournamentId', 'groupId', 'homeGames', 'awayGames', 'status'] },
  { table: 'comp_playoff_match', key: 'id', cols: ['tournamentId', 'round', 'slot', 'homeRegistrationId', 'awayRegistrationId', 'homeGames', 'awayGames', 'winnerRegistrationId', 'status', 'published'] },
  { table: 'Player', key: 'id', cols: ['primaryName', 'cueverseId', 'cueverseIdNormalized', 'active', 'linkedUserId'] },
  { table: 'PlayerAlias', key: 'id', cols: ['playerId', 'alias', 'aliasType'] },
  { table: 'PlayerMerge', key: 'id', cols: ['canonicalPlayerId', 'mergedPlayerId', 'status'] },
  { table: 'rating_ledger', key: 'id', cols: ['playerId', 'seasonId', 'tournamentId', 'matchKey', 'result', 'ratingChange', 'postRating'] },
  { table: 'championship', key: 'id', cols: [] },
  { table: 'article', key: 'id', cols: ['slug', 'title', 'state'] },
  { table: 'break_post', key: 'id', cols: ['slug', 'title', 'state'] },
]

const q = (s: string) => `"${s}"`

async function exists(table: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ${table}`
  return Number(r[0].n) > 0
}

async function realCols(table: string, wanted: string[]): Promise<string[]> {
  if (wanted.length === 0) return []
  const r = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table}`
  const have = new Set(r.map((x) => x.column_name))
  return wanted.filter((c) => have.has(c))
}

const out: string[] = []
for (const t of TABLES) {
  if (!(await exists(t.table))) { out.push(`${t.table.padEnd(34)} (absent)`); continue }
  const cols = await realCols(t.table, t.cols)
  const countRow = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM "public".${q(t.table)}`)
  const n = Number(countRow[0].n)

  let fp = '-'
  if (cols.length > 0 && n > 0) {
    // One deterministic string per row, ordered by key, hashed to a short digest.
    const expr = cols.map((c) => `coalesce(${q(c)}::text, '~')`).join(` || '|' || `)
    const rows = await prisma.$queryRawUnsafe<{ v: string }[]>(
      `SELECT ${expr} AS v FROM "public".${q(t.table)} ORDER BY ${q(t.key)}`,
    )
    fp = crypto.createHash('sha256').update(rows.map((r) => r.v).join('\n')).digest('hex').slice(0, 16)
  }
  out.push(`${t.table.padEnd(34)} ${String(n).padStart(7)}  ${fp}`)
}

console.log('table                                count  fingerprint')
console.log('-'.repeat(62))
for (const line of out) console.log(line)

// A couple of records the owner named explicitly, checked by hand.
const s3732 = await prisma.season.findUnique({
  where: { id: 3732 },
  select: { number: true, competitionYear: true, lifecycleState: true, championName: true, entrantsCount: true },
})
console.log('\nSeason 3732:', JSON.stringify(s3732))
console.log('archive shells:', await prisma.season.count({ where: { archiveTemplateKey: { not: null } } }))

await prisma.$disconnect()
