/**
 * Internal consistency of the database, judged against itself.
 *
 * ── Why this is separate from the archive suites ────────────────────────────────────────────────
 * The three archive suites compare the database against external captures that are known to be
 * incomplete. They are discrepancy reports about those captures, and a difference there is a
 * question about the sources, not a defect in the data.
 *
 * This asks a different and much harder question: is the database coherent ON ITS OWN TERMS? Does
 * every row point at something that exists, is anybody entered twice, does a completed Season name a
 * champion, does a Season that is excluded from the ladder actually contribute nothing? Those are
 * answerable without any archive at all, and a failure in one is a real defect wherever the data
 * came from.
 *
 * It takes no arguments and reads nothing but the database, so the same suite verifies the local
 * database and the restored production replacement, and the two can be compared directly.
 *
 * Read-only. Usage: tsx scripts/verify-db-integrity.mts [--json]
 */
import { prisma } from '../src/lib/prisma.ts'

let failures = 0
const results: { label: string; ok: boolean; detail: string }[] = []
const JSON_OUT = process.argv.includes('--json')

const n = async (sql: string): Promise<number> =>
  Number((await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(sql))[0]?.n ?? 0)

const check = (label: string, ok: boolean, detail = '') => {
  results.push({ label, ok, detail })
  if (!JSON_OUT) console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}
const section = (s: string) => { if (!JSON_OUT) console.log(`\n--- ${s} ---`) }

section('Referential integrity')

/*
 * ── One documented orphan, preserved by Owner decision (27 August 2026) ─────────────────────────
 * Entrant 48455 -- `apaffiliate`, 2012 S1A, WITHDRAWN -- points at a Player the 23 August reversal
 * deleted. The archive confirms the entry (the 2012 S1A manifest names them), so the row records
 * something real, and it is WITHDRAWN, so it contributes no match, result, standing or rating and
 * never reaches a public page. It is preserved rather than deleted, because deleting a historical
 * record to tidy a report is the wrong trade.
 *
 * It is exempted by its exact id, so this check still fails for any orphan that is not this one.
 */
const KNOWN_ORPHAN_ENTRANTS = [48455]

const orphans: [string, string][] = [
  ['every entrant names a Player that exists',
    `select count(*) n from season_entrant e where e."playerId" is not null
       and e.id <> all(array[${KNOWN_ORPHAN_ENTRANTS.join(',')}])
       and not exists (select 1 from "Player" p where p.id = e."playerId")`],
  ['every entrant belongs to a Season that exists',
    `select count(*) n from season_entrant e where not exists (select 1 from season s where s.id = e."seasonId")`],
  ['every standing belongs to an entrant',
    `select count(*) n from season_standing st where not exists (select 1 from season_entrant e where e.id = st."entrantId")`],
  ['every group member belongs to an entrant and a group',
    `select count(*) n from season_group_player gp
       where not exists (select 1 from season_entrant e where e.id = gp."entrantId")
          or not exists (select 1 from season_group g where g.id = gp."groupId")`],
  ['every group match names two entrants that exist',
    `select count(*) n from season_match m
       where not exists (select 1 from season_entrant e where e.id = m."homeEntrantId")
          or not exists (select 1 from season_entrant e where e.id = m."awayEntrantId")`],
  ['every ledger row names a Player that exists',
    `select count(*) n from rating_ledger l where not exists (select 1 from "Player" p where p.id = l."playerId")`],
  ['every ledger row names a Season that exists',
    `select count(*) n from rating_ledger l where l."seasonId" is not null
       and not exists (select 1 from season s where s.id = l."seasonId")`],
  ['every alias names a Player that exists',
    `select count(*) n from "PlayerAlias" a where not exists (select 1 from "Player" p where p.id = a."playerId")`],
]
for (const [label, sql] of orphans) {
  const c = await n(sql)
  check(label, c === 0, `${c} orphaned row(s)`)
}

section('Rows belong to the competition they claim')

/*
 * A match whose entrants belong to a DIFFERENT Season is the kind of corruption that reads as
 * plausible everywhere it is displayed -- the names resolve, the score renders -- and is only
 * visible by asking whether the two sides were ever in the same competition.
 */
check('no group match crosses Seasons', await n(`
  select count(*) n from season_match m
  join season_entrant h on h.id = m."homeEntrantId"
  join season_entrant a on a.id = m."awayEntrantId"
  where h."seasonId" <> m."seasonId" or a."seasonId" <> m."seasonId"`) === 0)

check('no playoff match crosses Seasons', await n(`
  select count(*) n from season_playoff_match p
  join season_entrant e on e.id in (p."homeEntrantId", p."awayEntrantId")
  where e."seasonId" <> p."seasonId"`) === 0)

check('no group belongs to another Season’s match', await n(`
  select count(*) n from season_match m join season_group g on g.id = m."groupId" where g."seasonId" <> m."seasonId"`) === 0)

section('Duplicates')

check('no Player is entered twice in one Season', await n(`
  select count(*) n from (select "seasonId","playerId" from season_entrant
    where "playerId" is not null group by 1,2 having count(*) > 1) d`) === 0)

check('no two Players share a normalised CueVerse ID', await n(`
  select count(*) n from (select "cueverseIdNormalized" from "Player"
    where "cueverseIdNormalized" is not null group by 1 having count(*) > 1) d`) === 0)

check('no Season is recorded twice', await n(`
  select count(*) n from (select "competitionSeriesId","competitionYear",number,division
    from season group by 1,2,3,4 having count(*) > 1) d`) === 0)

section('Competition state')

check('a completed Season names a champion', await n(`
  select count(*) n from season where "lifecycleState" = 'COMPLETED' and "championName" is null`) === 0,
  'completed Seasons with no champion')

check('an unfinished Season claims no champion', await n(`
  select count(*) n from season where "lifecycleState" <> 'COMPLETED' and "championName" is not null`) === 0,
  'unfinished Seasons naming a champion')

check('no match is scored for only one side', await n(`
  select count(*) n from season_match
  where ("homeGames" is null) <> ("awayGames" is null)`) === 0, 'half-scored matches')

check('no forfeit also carries a score', await n(`
  select count(*) n from season_playoff_match
  where "forfeitEntrantId" is not null and ("homeGames" is not null or "awayGames" is not null)`) === 0)

section('The rankings boundary')

/*
 * Division B is unranked by owner decision. One ledger row sourced from it means the ladder took in
 * a competition it was told to ignore, which is invisible on the surface and wrong in every rating.
 */
check('Division B contributes nothing to the ladder', await n(`
  select count(*) n from rating_ledger l join season s on s.id = l."seasonId" where s.division = 'B'`) === 0)

check('no Division B Season claims to be ranked', await n(`
  select count(*) n from season where division = 'B' and "countsTowardRankings" = true`) === 0)

check('no unfinished Season contributes to the ladder', await n(`
  select count(*) n from season s where s."lifecycleState" <> 'COMPLETED'
    and exists (select 1 from rating_ledger l where l."seasonId" = s.id)`) === 0)

section('Documented exceptions')

const knownOrphan = await n(
  'select count(*) n from season_entrant where id in (' + KNOWN_ORPHAN_ENTRANTS.join(',') + ") and status = 'WITHDRAWN'")
check('the one preserved orphaned entrant is still WITHDRAWN and inert',
  knownOrphan === KNOWN_ORPHAN_ENTRANTS.length,
  'a preserved orphan changed status — it must never become a playing record')

section('Search')

const gen = await prisma.$queryRawUnsafe<Array<{ state: string }>>(`
  select coalesce((select is_generated from information_schema.columns
    where table_schema='public' and table_name='break_post' and column_name='searchVector'), 'ABSENT') as state`)
check('break_post."searchVector" is a STORED GENERATED column', gen[0]?.state === 'ALWAYS', `is_generated = ${gen[0]?.state}`)
check('...and its GIN indexes are present', await n(`
  select count(*) n from pg_indexes where tablename = 'break_post' and indexdef ilike '%gin%'`) === 3)

if (JSON_OUT) {
  console.log(JSON.stringify({ failures, results }, null, 2))
} else {
  console.log(`\n${failures === 0 ? 'RESULT: all integrity checks passed' : `RESULT: ${failures} check(s) failed`}`)
}
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
