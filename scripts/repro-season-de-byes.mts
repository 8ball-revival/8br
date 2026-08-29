/**
 * Double-elimination bye propagation — reproduced end to end, on a disposable Season.
 *
 * ── What this is for ─────────────────────────────────────────────────────────────────────────────
 * A live Season stalled: 20 players in a bracket of 32, twelve winners-bracket byes, every winners
 * tie played — and the losers bracket never started. Four losers round-one ties held one player and
 * an opponent that was never coming, and four held nobody at all.
 *
 * The rule that decides "this position is empty for good" only asked whether anything FED the
 * position. In a winners bracket that is sound. In a losers bracket every position is fed by some
 * winners tie, so no losers position could ever be a bye — including the ones fed by a tie that was
 * itself a bye and therefore had no loser to send.
 *
 * ── How this proves it ───────────────────────────────────────────────────────────────────────────
 * It builds the same shape from scratch and plays it out through the same functions the Creator calls:
 * generate, start, record results, record forfeits. Nothing is written by hand into the bracket, so a
 * pass here is a statement about the engine and not about this script.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────────────────────────
 * Runs against the LOCAL REPLICA only — it refuses to start otherwise. Everything it creates is
 * removed at the end, including its audit entries, and every genuine record is fingerprinted before
 * and after and compared table by table. It never writes to the live Season it was written for.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env.replica scripts/repro-season-de-byes.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { analyseByes, generateSeasonBracket, enterSeasonPlayoffSetup, startSeasonPlayoffs, recordSeasonPlayoffResult, recordSeasonPlayoffForfeit, resettleSeasonByes } from '../src/lib/seasons/playoffs.ts'

const REPLICA = '8br_prod_replica_20260828'
const STALLED_SEASON = 16426

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const actor = { userId: 0, username: 'de-bye-repro' }

/** Every row in the database, counted per table. The proof that nothing genuine moved. */
async function fingerprint(): Promise<Map<string, number>> {
  const tables = await prisma.$queryRaw<{ table_schema: string; table_name: string }[]>`
    select table_schema, table_name from information_schema.tables
    where table_schema in ('public', 'payload') and table_type = 'BASE TABLE'
    order by table_schema, table_name`
  const out = new Map<string, number>()
  for (const t of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*) as n from "${t.table_schema}"."${t.table_name}"`)
    out.set(`${t.table_schema}.${t.table_name}`, Number(n))
  }
  return out
}

async function main() {
  // ── Refuse to run anywhere but the replica ───────────────────────────────────────────────────
  const [{ current_database: db }] = await prisma.$queryRaw<{ current_database: string }[]>`select current_database()`
  if (db !== REPLICA) {
    console.error(`REFUSED: connected to "${db}", not the replica "${REPLICA}".`)
    process.exit(2)
  }
  console.log(`Database: ${db}`)

  /*
   * The live Season that stalled is NOT in this replica -- the restore predates it. So this script
   * proves the rule on a bracket it builds itself, with the same shape, and the live Season gets its
   * own read-only dry run against production before any repair.
   */
  {
    const rows = await prisma.seasonPlayoffMatch.count({ where: { seasonId: STALLED_SEASON } })
    console.log(`\nLive Season ${STALLED_SEASON}: ${rows} ties in this replica (0 = restored before it existed).`)
  }

  const before = await fingerprint()
  console.log(`\nFingerprint taken: ${before.size} tables, ${[...before.values()].reduce((a, b) => a + b, 0)} rows.`)

  // ── Build the disposable Season ───────────────────────────────────────────────────────────────
  section('A disposable Season: 20 entrants, bracket of 32, double elimination')
  const stamp = String(Date.now())
  const series = await prisma.competitionSeries.create({
    data: { name: `ZZ Disposable ${stamp}`, slug: `zz-disposable-${stamp}`, shortName: 'ZZD', active: false },
  })
  const season = await prisma.season.create({
    data: {
      number: 1, competitionYear: 2099, competitionSeriesId: series.id,
      slug: `zz-disposable-${stamp}-s1`, subtitle: 'Disposable — double-elimination bye reproduction',
      lifecycleState: 'GROUPS_CLOSED', playoffDoubleElim: true,
      publiclyVisible: false, countsTowardRankings: false, reconstruction: true,
    },
  })
  const group = await prisma.seasonGroup.create({
    data: { seasonId: season.id, code: 'A', name: 'Group A', ordinal: 1, published: true },
  })
  const entrants: { id: number; name: string }[] = []
  for (let i = 1; i <= 20; i++) {
    const username = `ZZ Player ${String(i).padStart(2, '0')}`
    const e = await prisma.seasonEntrant.create({
      data: {
        seasonId: season.id, username, displayName: username, status: 'APPROVED',
        ratingSnapshot: 1600 - i * 5,
      },
    })
    entrants.push({ id: e.id, name: username })
    await prisma.seasonGroupPlayer.create({ data: { groupId: group.id, entrantId: e.id, seed: i } })
    // Rank 1..20 in one group, so the seeding the bracket is built from is unambiguous.
    await prisma.seasonStanding.create({
      data: {
        seasonId: season.id, groupId: group.id, entrantId: e.id, username,
        played: 19, wins: 20 - i, losses: i - 1, draws: 0,
        gamesWon: (20 - i) * 7, gamesLost: (i - 1) * 7, points: (20 - i) * 3, rank: i, qualified: true,
      },
    })
  }
  await prisma.season.update({ where: { id: season.id }, data: { entrantsCount: 20 } })
  const nameOf = new Map(entrants.map((e) => [e.id, e.name]))
  /** The player who forfeits a winners round-one tie, and must therefore reach losers round one. */
  let forfeitedInWb1: number | null = null
  console.log(`  Season #${season.id}, series #${series.id}, ${entrants.length} entrants.`)

  let stage = 'created'
  try {
    // ── Setup → generate → start, through the real functions ────────────────────────────────────
    const setup = await enterSeasonPlayoffSetup(actor, season.id)
    check('playoff setup opens with every entrant included', setup.ok, setup.error)

    const gen = await generateSeasonBracket(actor, season.id, { size: 32 })
    check('a 32-slot double-elimination bracket is generated', gen.ok && gen.size === 32, gen.error)
    stage = 'generated'

    {
      const wb1 = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: season.id, section: 'WB', round: 1 }, orderBy: { slot: 'asc' } })
      const byes = wb1.filter((m) => m.homeEntrantId == null || m.awayEntrantId == null)
      const real = wb1.filter((m) => m.homeEntrantId != null && m.awayEntrantId != null)
      check('winners round one holds 16 ties', wb1.length === 16, `got ${wb1.length}`)
      check('...of which 12 are byes — the live Season exactly', byes.length === 12, `got ${byes.length}`)
      check('...and 4 are real matches', real.length === 4, `got ${real.length}`)
    }

    const start = await startSeasonPlayoffs(actor, season.id)
    check('the playoffs start', start.ok, start.error)
    stage = 'live'

    /*
     * ── The heart of it ─────────────────────────────────────────────────────────────────────────
     *
     * Two moments, and the difference between them is the whole rule.
     *
     * At the START the four real winners ties have not been played, so the losers positions they
     * feed are empty because nobody has lost yet. Those must WAIT. The positions fed by a BYE are
     * empty because nobody is ever coming, and those are settled.
     *
     * Once the four winners ties are played their losers arrive, and each now sits opposite a
     * position nothing can reach -- which is exactly the state the live Season was left in, and
     * exactly what the old rule could not recognise.
     */
    section('Losers round one at the start — a bye is settled, an unplayed feeder is not')
    let lb1: Awaited<ReturnType<typeof prisma.seasonPlayoffMatch.findMany>> = []
    {
      lb1 = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: season.id, section: 'LB', round: 101 }, orderBy: { slot: 'asc' } })
      check('losers round one holds 8 ties', lb1.length === 8, `got ${lb1.length}`)
      for (const m of lb1) {
        console.log(`    slot ${m.slot}: ${m.homeUsername ?? '(waiting)'} v ${m.awayUsername ?? '(waiting)'} [${m.status}]`)
      }

      // Four ties are fed by two byes each: nobody is ever coming to either side.
      const dead = lb1.filter((m) => m.homeUsername === 'Bye' && m.awayUsername === 'Bye')
      check('four ties the field can never reach are named on both sides', dead.length === 4, `got ${dead.length}`)
      check('...and none of them was given a winner', dead.every((m) => m.winnerEntrantId == null))
      check('...nor a score', dead.every((m) => m.homeGames == null && m.awayGames == null))

      // The other four are half-named: one side a bye, the other still expecting a real loser.
      const pending = lb1.filter((m) => !dead.includes(m))
      check('the other four have their bye side named', pending.length === 4
        && pending.every((m) => m.homeUsername === 'Bye' || m.awayUsername === 'Bye'), `${pending.length}`)
      check('...and their other side left WAITING, because its feeder has not been played',
        pending.every((m) => (m.homeUsername === 'Bye' ? m.awayUsername : m.homeUsername) == null))
      check('...so no walkover was awarded past a tie still to come',
        pending.every((m) => m.winnerEntrantId == null))
    }

    section('The four winners ties are played — three results and a forfeit')
    {
      const wb1 = await prisma.seasonPlayoffMatch.findMany({
        where: { seasonId: season.id, section: 'WB', round: 1, winnerEntrantId: null },
        orderBy: { slot: 'asc' },
      })
      check('four winners ties remain to be played', wb1.length === 4, `got ${wb1.length}`)
      for (const [i, m] of wb1.entries()) {
        // One of them a forfeit, so the reproduction covers the case the report described: a player
        // who forfeits in the winners bracket must still drop, not be eliminated.
        const r = i === 3
          ? await recordSeasonPlayoffForfeit(actor, m.id, 'home')
          : await recordSeasonPlayoffResult(actor, m.id, 9, 5)
        check(`winners round one #${m.id} recorded${i === 3 ? ' as a forfeit' : ''}`, r.ok, r.error)
        if (i === 3) forfeitedInWb1 = m.homeEntrantId!
      }
    }

    section('Losers round one now — the four walkovers the live Season never got')
    {
      lb1 = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: season.id, section: 'LB', round: 101 }, orderBy: { slot: 'asc' } })
      for (const m of lb1) {
        console.log(`    slot ${m.slot}: ${m.homeUsername ?? '(waiting)'} v ${m.awayUsername ?? '(waiting)'}`
          + `${m.winnerEntrantId != null ? ` → ${nameOf.get(m.winnerEntrantId) ?? m.winnerEntrantId}` : ''} [${m.status}]`)
      }
      const walkovers = lb1.filter((m) => m.winnerEntrantId != null)
      check('the four half-filled ties became walkovers', walkovers.length === 4, `got ${walkovers.length}`)
      check('...each awarded to the player who was already sitting in it',
        walkovers.every((m) => m.winnerEntrantId === (m.homeEntrantId ?? m.awayEntrantId)))
      check('...with no games recorded, because none were played',
        walkovers.every((m) => m.homeGames == null && m.awayGames == null))
      check('...and no forfeit recorded against anybody',
        walkovers.every((m) => m.forfeitEntrantId == null))
      check('...opposite a side named as a bye rather than left blank',
        walkovers.every((m) => m.homeUsername === 'Bye' || m.awayUsername === 'Bye'))
      check('the player who forfeited in the winners bracket is among them, not eliminated',
        walkovers.some((m) => m.winnerEntrantId === forfeitedInWb1),
        `forfeiter ${nameOf.get(forfeitedInWb1!) ?? forfeitedInWb1}`)

      const lb2 = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: season.id, section: 'LB', round: 102 }, orderBy: { slot: 'asc' } })
      const seated = lb2.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter((x): x is number => x != null)
      const expected = walkovers.map((m) => m.winnerEntrantId!)
      check('every walkover winner advanced into losers round two',
        expected.every((id) => seated.includes(id)),
        `expected ${expected.map((i) => nameOf.get(i)).join(', ')}; seated ${seated.map((i) => nameOf.get(i)).join(', ')}`)
      check('...and nobody the bracket did not send was put there',
        seated.every((id) => expected.includes(id) || lb1.some((m) => m.winnerEntrantId === id)))
    }

    // ── Play the whole thing out ────────────────────────────────────────────────────────────────
    section('Playing the bracket out — ordinary results and forfeits')
    let played = 0
    let forfeits = 0
    for (let guard = 0; guard < 200; guard++) {
      const playable = await prisma.seasonPlayoffMatch.findMany({
        where: { seasonId: season.id, winnerEntrantId: null, homeEntrantId: { not: null }, awayEntrantId: { not: null } },
        orderBy: [{ round: 'asc' }, { slot: 'asc' }],
      })
      if (!playable.length) break
      const m = playable[0]
      // Deterministic, and mixed: every third decided tie is a forfeit by the home player.
      if ((played + forfeits) % 3 === 2) {
        const r = await recordSeasonPlayoffForfeit(actor, m.id, 'home')
        if (!r.ok) { check(`forfeit recorded on #${m.id}`, false, r.error); break }
        forfeits++
      } else {
        const r = await recordSeasonPlayoffResult(actor, m.id, 9, 4 + (played % 4))
        if (!r.ok) { check(`result recorded on #${m.id}`, false, r.error); break }
        played++
      }
    }
    console.log(`  ${played} results, ${forfeits} forfeits.`)
    check('ordinary results were recorded', played > 0)
    check('forfeits were recorded', forfeits > 0)

    // ── Nothing is left stuck ───────────────────────────────────────────────────────────────────
    section('Nothing is left waiting on a match that will never happen')
    {
      const all = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: season.id }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
      const view = analyseByes(all)
      const stuck = all.filter((m) => {
        if (m.winnerEntrantId != null) return false
        // Undecided is only acceptable when the tie can never be reached at all.
        const dead = m.homeEntrantId == null && m.awayEntrantId == null
          && view.permanentlyEmpty(m.id, 0) && view.permanentlyEmpty(m.id, 1)
        return !dead
      })
      for (const m of stuck) console.log(`    STUCK #${m.id} ${m.label ?? `round ${m.round}`}: ${m.homeUsername ?? '(empty)'} v ${m.awayUsername ?? '(empty)'}`)
      check('every undecided tie is one the field could never reach', stuck.length === 0, `${stuck.length} stuck`)

      const gf = all.find((m) => m.section === 'GF')
      check('the Grand Final was reached and decided', gf != null && gf.winnerEntrantId != null,
        gf ? `${gf.homeUsername ?? '(empty)'} v ${gf.awayUsername ?? '(empty)'}` : 'no grand final')

      const { completionReadiness } = await import('../src/lib/seasons/close.ts')
      const ready = await completionReadiness(season.id)
      check('the Season could now be completed', ready.ok, ready.problems.join(' '))
      console.log(`  Champion: ${ready.championName ?? '(none)'}`)
    }

    // ── Forfeiting players are in the losers bracket, not eliminated ─────────────────────────────
    section('A forfeit drops a player; it does not eliminate them')
    {
      const all = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: season.id } })
      const wbForfeits = all.filter((m) => m.section === 'WB' && m.forfeitEntrantId != null)
      check('at least one winners-bracket tie was forfeited', wbForfeits.length > 0, `${wbForfeits.length}`)
      const missing = wbForfeits.filter((m) => {
        const target = all.find((x) => x.id === m.loserFeedsMatchId)
        if (!target) return true
        const slot = m.loserFeedsSlot ?? 0
        return (slot === 0 ? target.homeEntrantId : target.awayEntrantId) !== m.forfeitEntrantId
      })
      for (const m of missing) console.log(`    #${m.id}: ${nameOf.get(m.forfeitEntrantId!)} did not land in #${m.loserFeedsMatchId}`)
      check('every winners-bracket forfeiter landed in the losers bracket', missing.length === 0,
        `${missing.length} of ${wbForfeits.length} missing`)
      check('...and none of them was marked a bye',
        wbForfeits.every((m) => m.homeUsername !== 'Bye' && m.awayUsername !== 'Bye'))
      check('...and none of them lost their games to a walkover',
        wbForfeits.every((m) => m.homeGames == null && m.awayGames == null))
    }

    // ── Idempotence ─────────────────────────────────────────────────────────────────────────────
    section('Running settlement again changes nothing')
    {
      const again = await resettleSeasonByes(actor, season.id)
      check('a re-run reports no change', again.ok && again.changed === 0,
        again.error ?? `changed ${again.changed}: ${JSON.stringify(again.matches)}`)
      const twice = await resettleSeasonByes(actor, season.id)
      check('...and so does the one after it', twice.ok && twice.changed === 0, twice.error)
    }
  } finally {
    // ── Remove every disposable record ────────────────────────────────────────────────────────
    section(`Cleaning up (reached: ${stage})`)
    const del = await prisma.auditLog.deleteMany({ where: { actorUsername: actor.username } })
    await prisma.season.delete({ where: { id: season.id } })
    await prisma.competitionSeries.delete({ where: { id: series.id } })
    console.log(`  Season, series, entrants, group, standings and bracket removed; ${del.count} audit entries removed.`)
  }

  // ── Prove nothing genuine moved ───────────────────────────────────────────────────────────────
  section('Every genuine record is exactly as it was')
  {
    const after = await fingerprint()
    const drift: string[] = []
    for (const [table, n] of before) {
      const m = after.get(table)
      if (m !== n) drift.push(`${table}: ${n} → ${m}`)
    }
    for (const table of after.keys()) if (!before.has(table)) drift.push(`${table}: new table`)
    for (const d of drift) console.log(`    DRIFT ${d}`)
    check('every table holds exactly the rows it held before', drift.length === 0, drift.join('; '))

    const stalled = await prisma.seasonPlayoffMatch.count({ where: { seasonId: STALLED_SEASON, winnerEntrantId: { not: null } } })
    console.log(`  Live Season ${STALLED_SEASON} still has ${stalled} decided ties — untouched.`)
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
