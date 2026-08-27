/**
 * Entity counts for the archive repair, split by division.
 *
 * A repair of this size is judged on what it did and did not change, and a count taken by hand at
 * each step is a count that will disagree with itself eventually. This is one query set, run against
 * whichever local database DATABASE_URL names, so the rehearsal, the reference and the real database
 * are all measured the same way.
 *
 * Read-only. Usage: tsx scripts/archive-counts.mts [--json]
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const n = async (sql: string): Promise<number> =>
  Number((await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(sql))[0]?.n ?? 0)

/**
 * Scoped to a division via the Season the row hangs off, so "matches" means the same thing twice.
 *
 * `join` is the path from the table to its Season: most rows carry seasonId directly, but a group
 * member only knows its group, so it reaches the Season through season_group.
 */
const byDivision = async (table: string, join = 't."seasonId"') => ({
  A: await n(`select count(*) n from ${table} t join season s on s.id=${join} where s.division='A'`),
  B: await n(`select count(*) n from ${table} t join season s on s.id=${join} where s.division='B'`),
  total: await n(`select count(*) n from ${table}`),
})

const VIA_GROUP = '(select g."seasonId" from season_group g where g.id=t."groupId")'

const counts = {
  players: await n('select count(*) n from "Player"'),
  playerAliases: await n('select count(*) n from "PlayerAlias"'),
  playerMerges: await n('select count(*) n from "PlayerMerge"'),
  seasons: {
    A: await n(`select count(*) n from season where division='A'`),
    B: await n(`select count(*) n from season where division='B'`),
    total: await n('select count(*) n from season'),
    archiveLinked: await n('select count(*) n from season where "archiveTemplateKey" is not null'),
    completed: await n(`select count(*) n from season where "lifecycleState"='COMPLETED'`),
  },
  seasonEntrants: await byDivision('season_entrant'),
  seasonGroups: await byDivision('season_group'),
  seasonGroupMembers: await byDivision('season_group_player', VIA_GROUP),
  seasonStandings: await byDivision('season_standing'),
  seasonGroupMatches: await byDivision('season_match'),
  seasonPlayoffMatches: await byDivision('season_playoff_match'),
  tournaments: await n('select count(*) n from comp_tournament'),
  tournamentEntrants: await n('select count(*) n from comp_registration'),
  tournamentMatches: await n('select count(*) n from comp_tournament_match'),
  tournamentPlayoffMatches: await n('select count(*) n from comp_playoff_match'),
  achievementDefinitions: await n('select count(*) n from achievement_definition'),
  breakPosts: await n('select count(*) n from break_post'),
  ratingLedger: {
    total: await n('select count(*) n from rating_ledger'),
    /*
     * Division B is unranked by owner decision, carried on countsTowardRankings. A row here is
     * therefore not a small discrepancy -- it means the ladder took in a Season it was told to
     * ignore, so it is counted separately rather than folded into the total.
     */
    fromDivisionB: await n(`select count(*) n from rating_ledger l
      join season s on s.id = l."seasonId" where s.division='B'`),
  },
}

const totalMatches =
  counts.seasonGroupMatches.total + counts.seasonPlayoffMatches.total +
  counts.tournamentMatches + counts.tournamentPlayoffMatches

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...counts, totalMatches }, null, 2))
} else {
  const row = (label: string, v: number | { A: number; B: number; total: number }) =>
    typeof v === 'number'
      ? console.log(`  ${label.padEnd(30)} ${String(v).padStart(7)}`)
      : console.log(`  ${label.padEnd(30)} ${String(v.total).padStart(7)}   (A ${v.A} / B ${v.B})`)

  console.log(`--- ${process.env.DATABASE_URL?.split('/').pop()} ---`)
  row('Players', counts.players)
  row('Player aliases', counts.playerAliases)
  row('Player merges', counts.playerMerges)
  row('Seasons', counts.seasons)
  console.log(`    archive-linked ${counts.seasons.archiveLinked}, completed ${counts.seasons.completed}`)
  row('Season entrants', counts.seasonEntrants)
  row('Season groups', counts.seasonGroups)
  row('Season group members', counts.seasonGroupMembers)
  row('Season standings', counts.seasonStandings)
  row('Season group matches', counts.seasonGroupMatches)
  row('Season playoff matches', counts.seasonPlayoffMatches)
  row('Tournaments', counts.tournaments)
  row('Tournament entrants', counts.tournamentEntrants)
  row('Tournament matches', counts.tournamentMatches)
  row('Tournament playoff matches', counts.tournamentPlayoffMatches)
  row('TOTAL matches', totalMatches)
  row('Achievement definitions', counts.achievementDefinitions)
  row('The Break posts', counts.breakPosts)
  row('Rating ledger rows', counts.ratingLedger.total)
  console.log(`    from Division B (must be 0) ${counts.ratingLedger.fromDivisionB}`)
}
