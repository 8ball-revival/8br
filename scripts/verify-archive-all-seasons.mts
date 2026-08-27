/**
 * Check EVERY archive Season against the archive, and the archive layer as a whole.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * The archive used to be represented in the gate by one Season. verify-archive-season.mts defaults
 * to "the most completely reconstructed" one, the batch runner calls it with no arguments, and so a
 * single favourable sample stood for forty-four. It passed while thirty-seven of them were wrong.
 *
 * A suite that samples cannot fail for the reason you need it to. This one asks every Season, and
 * reports which ones failed and on what — so a regression names itself instead of hiding behind a
 * Season nobody checked.
 *
 * The per-Season checks are shared with the single-Season script (scripts/support/season-audit.mts).
 * What is added here is everything only visible ACROSS Seasons: strays, orphans, the rankings
 * boundary, and the two Seasons whose correct state is to be left alone.
 *
 * Usage: tsx scripts/verify-archive-all-seasons.mts [--verbose]
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { auditSeason } from './support/season-audit.mts'

assertLocalDatabase()

const VERBOSE = process.argv.includes('--verbose')

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}
const n = async (sql: string): Promise<number> =>
  Number((await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(sql))[0]?.n ?? 0)

// ── Every Division A archive Season, one at a time ──────────────────────────────────────────────
console.log('--- Every Division A archive Season against its source ---')

const divisionA = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null }, division: 'A' },
  select: { id: true },
  orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
})

const audits = []
for (const s of divisionA) audits.push(await auditSeason(s.id))

const bad = audits.filter((a) => a.failed > 0)
for (const a of bad) {
  console.log(`    ${a.label} (${a.seasonId}) — ${a.failed} failed`)
  for (const c of a.checks.filter((x) => !x.ok)) {
    console.log(`        x ${c.label}${c.detail ? ` — ${c.detail}` : ''}`)
  }
}
if (VERBOSE) for (const a of audits.filter((x) => x.failed === 0)) console.log(`    ${a.label} — clean`)

check(`all ${audits.length} Division A Seasons reconcile with the archive`,
  bad.length === 0,
  `${bad.length} Season(s) failed: ${bad.map((b) => b.label).join(', ')}`)

// ── The Seasons whose correct state is to be left alone ─────────────────────────────────────────
console.log('\n--- The 2006 shared group stages, deliberately not imported ---')

/*
 * 2006 S1 and S2 ran their group stage UNDIVIDED: one table covering both divisions. The importer
 * refuses them, and that refusal is the correct outcome rather than a gap — applying the shared
 * table to each division separately would enter the same matches twice and count them twice in the
 * Rankings.
 *
 * Left untested, "these two are empty" is indistinguishable from "the import silently failed on two
 * Seasons". So the intended state is asserted: present, still open, and holding nothing.
 */
const shared = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null }, division: 'B', competitionYear: 2006, number: { in: [1, 2] } },
  select: { id: true, number: true, lifecycleState: true, championName: true },
})
check('both are present as shells', shared.length === 2, `${shared.length} found`)
for (const s of shared) {
  const entrants = await prisma.seasonEntrant.count({ where: { seasonId: s.id } })
  const matches = await prisma.seasonMatch.count({ where: { seasonId: s.id } })
  const ledger = await prisma.ratingLedger.count({ where: { seasonId: s.id } })
  check(`2006 S${s.number}B is still open, holding nothing`,
    String(s.lifecycleState) === 'REGISTRATION_OPEN' && entrants === 0 && matches === 0 && ledger === 0,
    `${s.lifecycleState}, ${entrants} entrant(s), ${matches} match(es), ${ledger} ledger row(s)`)
  check('...and claims no champion', !s.championName, String(s.championName))
}

// ── The rankings boundary, across the whole archive ─────────────────────────────────────────────
console.log('\n--- Rankings boundary ---')

/*
 * Division B is unranked by owner decision, carried on countsTowardRankings. It stays completely
 * visible; it simply feeds nothing. A single ledger row sourced from a Division B Season means the
 * ladder took in a competition it was told to ignore.
 */
const bLedger = await n(`select count(*) n from rating_ledger l join season s on s.id=l."seasonId" where s.division='B'`)
check('Division B contributes nothing to the ladder', bLedger === 0, `${bLedger} row(s)`)

const bFlag = await n(`select count(*) n from season where division='B' and "countsTowardRankings" = true`)
check('...and no Division B Season claims otherwise', bFlag === 0, `${bFlag} Season(s) flagged ranked`)

const incompleteRanked = await n(`select count(*) n from season s
  where s."lifecycleState" <> 'COMPLETED' and exists (select 1 from rating_ledger l where l."seasonId"=s.id)`)
check('no incomplete Season contributes to the ladder', incompleteRanked === 0, `${incompleteRanked} Season(s)`)

const completedUnranked = await n(`select count(*) n from season s
  where s."lifecycleState" = 'COMPLETED' and s.division='A' and s."archiveTemplateKey" is not null
    and not exists (select 1 from rating_ledger l where l."seasonId"=s.id)`)
check('every completed Division A archive Season contributes', completedUnranked === 0, `${completedUnranked} Season(s)`)

// ── Duplicates and orphans ──────────────────────────────────────────────────────────────────────
console.log('\n--- Duplicates and orphans ---')

const dupEntrant = await n(`select count(*) n from (
  select "seasonId","playerId" from season_entrant where "playerId" is not null group by 1,2 having count(*)>1) d`)
check('no Player is entered twice in one Season', dupEntrant === 0, `${dupEntrant} duplicate pair(s)`)

const unlinked = await n(`select count(*) n from season_entrant where "playerId" is null`)
check('every entrant is linked to a canonical Player', unlinked === 0, `${unlinked} unlinked`)

const orphanEntrantPlayer = await n(`select count(*) n from season_entrant e
  where e."playerId" is not null and not exists (select 1 from "Player" p where p.id=e."playerId")`)
check('...and that Player exists', orphanEntrantPlayer === 0, `${orphanEntrantPlayer} dangling`)

const orphanStanding = await n(`select count(*) n from season_standing st
  where not exists (select 1 from season_entrant e where e.id=st."entrantId")`)
check('every standing belongs to an entrant', orphanStanding === 0, `${orphanStanding} orphan(s)`)

const orphanGroupPlayer = await n(`select count(*) n from season_group_player gp
  where not exists (select 1 from season_entrant e where e.id=gp."entrantId")
     or not exists (select 1 from season_group g where g.id=gp."groupId")`)
check('every group member belongs to an entrant and a group', orphanGroupPlayer === 0, `${orphanGroupPlayer} orphan(s)`)

const orphanMatch = await n(`select count(*) n from season_match m
  where not exists (select 1 from season_entrant e where e.id=m."homeEntrantId")
     or not exists (select 1 from season_entrant e where e.id=m."awayEntrantId")`)
check('every group match names two real entrants', orphanMatch === 0, `${orphanMatch} orphan(s)`)

const orphanLedgerSeason = await n(`select count(*) n from rating_ledger l
  where l."seasonId" is not null and not exists (select 1 from season s where s.id=l."seasonId")`)
check('every ledger row names a real Season', orphanLedgerSeason === 0, `${orphanLedgerSeason} dangling`)

const orphanLedgerPlayer = await n(`select count(*) n from rating_ledger l
  where not exists (select 1 from "Player" p where p.id=l."playerId")`)
check('...and a real Player', orphanLedgerPlayer === 0, `${orphanLedgerPlayer} dangling`)

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`}`)
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
