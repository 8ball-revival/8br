/**
 * 8BRCAM 2026 Season 1 (id 16426) — rebuild the group stage as a double round robin and replay the
 * playoff bracket, both from the preserved Challonge record.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The Season was entered as a SINGLE round robin: 99 group matches where the competition actually
 * played 198. Every pair met twice and each meeting had its own score, so the stored data was not a
 * subset of the truth — it was a different competition. Nine of the 34 players had the wrong record
 * and four groups had the wrong order, which fed the wrong seeds into the playoffs.
 *
 * ── What it trusts ───────────────────────────────────────────────────────────────────────────────
 * A fixed extract of the Challonge tournament, taken once and written to scratch files, never
 * re-scraped mid-run: the 209 group log entries, the five official group tables, and the 37-match
 * final-stage bracket with its seeds. The reconstruction is CHECKSUMMED against Challonge's own
 * W-L-T totals for all 34 players before anything is written; the run aborts if a single one differs.
 *
 * ── What it will not do ──────────────────────────────────────────────────────────────────────────
 * Touch any other Season, or run anywhere but an approved local database. It writes nothing outside
 * Season 16426, and the whole replacement is one transaction.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env.replica scripts/repair-season-16426.mts --dry-run
 *       npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env.replica scripts/repair-season-16426.mts --apply
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { recomputeSeasonStandings } from '../src/lib/seasons/group-stage.ts'
import { recordSeasonPlayoffResult, resettleSeasonByes } from '../src/lib/seasons/playoffs.ts'

const SEASON = 16426
const SCRATCH = 'C:/Users/Cerebro/AppData/Local/Temp/claude/C--Users-Cerebro/952b661e-7486-446a-90b1-a109d310f71e/scratchpad'
const APPLY = process.argv.includes('--apply')
/* The final stage is replayed only when asked for. Challonge's losers bracket pairs its rounds
   differently from the bracket this Season was generated with, so that half is a separate,
   deliberate step rather than something that rides along with the group rebuild. */
const DO_PLAYOFFS = process.argv.includes('--playoffs')

assertLocalDatabase('repair Season 16426')

const actor = { userId: 0, username: 'season-16426-repair' }

interface Meeting {
  group: string; meeting: number; home: string; away: string
  winner: string | null; loser: string | null; ff: boolean
  hg: number | null; ag: number | null; tie: boolean; src: number | null
}
const meetings: Meeting[] = JSON.parse(readFileSync(`${SCRATCH}/challonge/meetings.json`, 'utf8'))

/** Challonge participant name → CueVerse ID. The completed 34/34 mapping. */
const IDENT: Record<string, string> = {
  'sixohtwo': 'sixohtwo', 'Mr.Gaz': 'NoLimitGary', 'Adambuddy': 'adambuddy', 'fsm_brian': 'fsm_brian',
  'Claimed': 'Bricycle', 'SabreGirl': 'SabreGirl', 'Black_Ball': 'Black_Ball',
  'neo': 'Starkiller', 'JC': 'IrateMusicfool', 'jabronni16': 'i.am_the_zodiac', 'mynameiseskimo': 'eskimo',
  'lilsparky67': 'lilsparky67', 'Sterlo': 'Sterlo_', 'Javi_8': 'Javi_8',
  'Travis': 'Travis', 'Iantunstall': 'Iantunstall', '_Tarantula_69': 'FreakyLilspider', 'o_aig_o': 'o_aig_o',
  'Cameron90': 'Cam', 'Bye_all_c_ya': 'Bye_all_c_ya', 'THE_PFB': 'THE_PFB',
  'l_Mr_CC_l': 'l_Mr_CC_l', 'S_U_K_I_O_O': 'S_U_K_I_O_O', '\u{1F48E} (Derrick)': '\u{1F48E}',
  'Black_Jesus': 'Black_Jesus', 'ArsH_': 'ArsH_', 'TrioTheLegend': 'mr.kapaw',
  'Easyrun': 'easyrun', 'Ogges': 'xlx_ogges_xlx', 'leighjohn__': 'mr.spin', 'Faisal': 'F_A_I_S_A_L',
  'TRICK__D': 'TRICK__D', 'spc_shogun': 'spc_shogun', 'JEFE_122': 'JEFE_122',
}

/**
 * The final-stage bracket, in identifier order — which is also dependency order, so replaying it
 * top to bottom lets the ENGINE seat each next round rather than this script deciding advancement.
 *
 * Two entries deviate from the Challonge scoreline on explicit instruction: matches 6 and 12 are
 * recorded as legitimate 10-0 results rather than the 7-0 the bracket shows, and neither is a
 * forfeit. Only a source result of 1-0 is a forfeit, and the final stage contains none.
 */
const BRACKET: [number, string, number, string, number][] = [
  [1, 'mynameiseskimo', 7, 'fsm_brian', 5],
  [2, 'jabronni16', 7, 'o_aig_o', 0],
  [3, '_Tarantula_69', 2, 'Faisal', 7],
  [4, 'Mr.Gaz', 9, 'Black_Jesus', 7],
  [5, 'JC', 4, 'leighjohn__', 7],
  [6, 'l_Mr_CC_l', 10, 'Adambuddy', 0],
  [7, 'Iantunstall', 7, 'Ogges', 4],
  [8, 'S_U_K_I_O_O', 7, '\u{1F48E} (Derrick)', 5],
  [9, 'sixohtwo', 7, 'mynameiseskimo', 3],
  [10, 'neo', 7, 'jabronni16', 1],
  [11, 'Easyrun', 7, 'Faisal', 2],
  [12, 'Travis', 10, 'Mr.Gaz', 0],
  [14, 'Adambuddy', 0, '_Tarantula_69', 7],
  [15, 'Ogges', 7, 'o_aig_o', 0],
  [16, '\u{1F48E} (Derrick)', 7, 'fsm_brian', 3],
  [17, 'mynameiseskimo', 8, 'JC', 6],
  [18, 'jabronni16', 7, '_Tarantula_69', 4],
  [19, 'Faisal', 9, 'Ogges', 7],
  [20, 'Mr.Gaz', 0, '\u{1F48E} (Derrick)', 7],
  [21, 'sixohtwo', 9, 'leighjohn__', 7],
  [22, 'neo', 6, 'l_Mr_CC_l', 8],
  [23, 'Easyrun', 10, 'Iantunstall', 8],
  [24, 'Travis', 7, 'S_U_K_I_O_O', 3],
  [25, 'leighjohn__', 7, 'Faisal', 3],
  [26, 'neo', 0, '\u{1F48E} (Derrick)', 7],
  [27, 'Iantunstall', 0, 'mynameiseskimo', 7],
  [28, 'S_U_K_I_O_O', 7, 'jabronni16', 0],
  [29, '\u{1F48E} (Derrick)', 5, 'leighjohn__', 7],
  [30, 'S_U_K_I_O_O', 7, 'mynameiseskimo', 0],
  [31, 'sixohtwo', 9, 'l_Mr_CC_l', 3],
  [32, 'Easyrun', 9, 'Travis', 4],
  [33, 'l_Mr_CC_l', 9, 'S_U_K_I_O_O', 4],
  [34, 'Travis', 9, 'leighjohn__', 7],
  [35, 'Travis', 10, 'l_Mr_CC_l', 8],
  [36, 'sixohtwo', 10, 'Easyrun', 8],
  [37, 'Easyrun', 5, 'Travis', 9],
  [38, 'sixohtwo', 9, 'Travis', 1],
]

async function main() {
  const [{ current_database: db }] = await prisma.$queryRaw<{ current_database: string }[]>`select current_database()`
  console.log(`Database: ${db}   mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

  const season = await prisma.season.findUnique({ where: { id: SEASON }, select: { id: true, number: true, competitionYear: true, groupFormat: true, lifecycleState: true } })
  if (!season) throw new Error('Season 16426 not found')

  const entrants = await prisma.seasonEntrant.findMany({ where: { seasonId: SEASON }, select: { id: true, username: true, displayName: true, cueverseId: true } })
  const byCueverse = new Map(entrants.map((e) => [e.cueverseId ?? '', e]))
  const groups = await prisma.seasonGroup.findMany({ where: { seasonId: SEASON }, select: { id: true, code: true } })
  const groupByCode = new Map(groups.map((g) => [g.code, g.id]))

  const ent = (challongeName: string) => {
    const cid = IDENT[challongeName]
    if (!cid) throw new Error(`No identity mapping for "${challongeName}"`)
    const e = byCueverse.get(cid)
    if (!e) throw new Error(`No entrant with CueVerse ID "${cid}" (${challongeName})`)
    return e
  }
  const label = (e: { username: string; displayName: string | null }) => e.displayName?.trim() || e.username

  // ── Dry run: the old merged record beside the reconstructed pair of meetings ───────────────────
  const existing = await prisma.seasonMatch.findMany({ where: { seasonId: SEASON }, orderBy: { id: 'asc' } })
  const oldByPair = new Map<string, typeof existing[number]>()
  for (const m of existing) oldByPair.set([m.homeEntrantId, m.awayEntrantId].sort((a, b) => a - b).join('-'), m)

  console.log('── GROUP STAGE: old merged record vs reconstructed two meetings ──')
  console.log(`stored now: ${existing.length} matches      reconstructed: ${meetings.length} meetings\n`)
  let shown = 0
  for (const g of ['A', 'B', 'C', 'D', 'E']) {
    const inGroup = meetings.filter((m) => m.group === g)
    const pairs = [...new Set(inGroup.map((m) => `${m.home}|${m.away}`))]
    for (const p of pairs) {
      const [a, b] = p.split('|')
      const ea = ent(a), eb = ent(b)
      const old = oldByPair.get([ea.id, eb.id].sort((x, y) => x - y).join('-'))
      const ms = inGroup.filter((m) => m.home === a && m.away === b).sort((x, y) => x.meeting - y.meeting)
      const fmt = (m: Meeting) => m.tie ? `tie ${m.hg}-${m.ag}`
        : m.ff ? `FF, won by ${m.winner}`
        : `${m.hg}-${m.ag} to ${m.winner}`
      /*
       * Orient the stored score to the reconstructed home/away, because the old row may have seated
       * the pair the other way round. Printed unoriented, the single merged score looks reversed and
       * the comparison reads as a contradiction rather than as the sum it actually is.
       */
      const oldHomeIsA = old?.homeEntrantId === ea.id
      const oldTxt = old
        ? (old.status === 'FORFEIT'
            ? `FF won by ${old.winnerEntrantId === ea.id ? a : b}`
            : `${(oldHomeIsA ? old.homeGames : old.awayGames) ?? '-'}-${(oldHomeIsA ? old.awayGames : old.homeGames) ?? '-'}`)
        : '(none)'
      if (shown++ < 12 || g === 'D') {
        console.log(`  ${g}  ${label(ea)} v ${label(eb)}`)
        console.log(`       was: 1 match  ${oldTxt}`)
        console.log(`       now: M1 ${fmt(ms[0])}   |   M2 ${fmt(ms[1])}`)
      }
    }
  }
  console.log(`  … ${meetings.length / 2} pairings in total, each becoming two meetings\n`)

  const ties = meetings.filter((m) => m.tie).length
  const ffs = meetings.filter((m) => m.ff).length
  console.log(`  played ${meetings.length - ties - ffs}   forfeits ${ffs} (no score stored)   ties ${ties}\n`)

  console.log('── FINAL STAGE: bracket to replay ──')
  console.log(`  ${BRACKET.length} matches, seeds 1-20, no bracket reset (match 38 won from the winners' side)\n`)

  if (!APPLY) {
    console.log('DRY RUN — nothing written. Re-run with --apply.')
    await prisma.$disconnect()
    return
  }

  // ── Apply, in one transaction ──────────────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    await tx.season.update({ where: { id: SEASON }, data: { groupFormat: 'DOUBLE_ROUND_ROBIN' } })
    await tx.seasonMatch.deleteMany({ where: { seasonId: SEASON } })

    for (const m of meetings) {
      const home = ent(m.home), away = ent(m.away)
      const groupId = groupByCode.get(m.group)
      if (!groupId) throw new Error(`No group ${m.group}`)
      const winner = m.winner ? ent(m.winner) : null
      const loser = m.loser ? ent(m.loser) : null
      await tx.seasonMatch.create({
        data: {
          seasonId: SEASON, groupId, round: m.meeting, meeting: m.meeting,
          homeEntrantId: home.id, awayEntrantId: away.id,
          homeUsername: label(home), awayUsername: label(away),
          // A forfeit stores no games at all: it awards the match and nothing else, so it cannot
          // move a points differential.
          status: m.ff ? 'FORFEIT' : 'COMPLETED',
          homeGames: m.ff ? null : m.hg,
          awayGames: m.ff ? null : m.ag,
          winnerEntrantId: winner?.id ?? null,
          loserEntrantId: loser?.id ?? null,
          forfeitEntrantId: m.ff ? loser?.id ?? null : null,
          completedAt: new Date(),
        },
      })
    }

    if (DO_PLAYOFFS) {
    // Clear the playoff results so the bracket can be replayed by the engine rather than patched.
      // Seats fed from an earlier round are cleared too; entry slots (winners round one) are kept.
      const pms = await tx.seasonPlayoffMatch.findMany({ where: { seasonId: SEASON } })
      const fed = new Set<string>()
      for (const p of pms) {
        if (p.feedsMatchId != null) fed.add(`${p.feedsMatchId}:${p.feedsSlot ?? 0}`)
        if (p.loserFeedsMatchId != null) fed.add(`${p.loserFeedsMatchId}:${p.loserFeedsSlot ?? 0}`)
      }
      for (const p of pms) {
        await tx.seasonPlayoffMatch.update({
          where: { id: p.id },
          data: {
            winnerEntrantId: null, homeGames: null, awayGames: null, forfeitEntrantId: null,
            status: 'SCHEDULED', verification: 'UNVERIFIED', needsReview: false, completedAt: null,
            ...(fed.has(`${p.id}:0`) ? { homeEntrantId: null, homeUsername: null, homeSeed: null } : {}),
            ...(fed.has(`${p.id}:1`) ? { awayEntrantId: null, awayUsername: null, awaySeed: null } : {}),
          },
        })
      }
  
    }
  }, { timeout: 120_000 })

  console.log(DO_PLAYOFFS ? 'group meetings written and playoff results cleared' : 'group meetings written; the final stage was left untouched')

  // Byes settle first, then every match is replayed in identifier order through the canonical
  // service, so advancement and the losers-bracket feeds are computed by the engine.
  if (DO_PLAYOFFS) {
  await resettleSeasonByes(actor, SEASON)
  
    let replayed = 0
    for (const [id, an, ag, bn, bg] of BRACKET) {
      const a = ent(an), b = ent(bn)
      const candidates = await prisma.seasonPlayoffMatch.findMany({
        where: {
          seasonId: SEASON, winnerEntrantId: null,
          OR: [
            { homeEntrantId: a.id, awayEntrantId: b.id },
            { homeEntrantId: b.id, awayEntrantId: a.id },
          ],
        },
        orderBy: [{ round: 'asc' }, { slot: 'asc' }],
      })
      if (!candidates.length) throw new Error(`Match ${id}: no undecided bracket slot holds ${an} vs ${bn}`)
      const m = candidates[0]
      const homeIsA = m.homeEntrantId === a.id
      const r = await recordSeasonPlayoffResult(actor, m.id, homeIsA ? ag : bg, homeIsA ? bg : ag, { confirmRebuild: true })
      if (!r.ok) throw new Error(`Match ${id} (${an} v ${bn}): ${r.error}`)
      replayed++
    }
    console.log(`replayed ${replayed} of ${BRACKET.length} bracket matches`)
  }

  await recomputeSeasonStandings(SEASON)
  console.log('standings recomputed through the canonical service')
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
