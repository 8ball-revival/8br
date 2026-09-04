/**
 * Restore the group-stage results for 8BRCAM Season 2, 2012, Division A, Group G.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────────────────────────
 * Every one of Group G's 21 fixtures was NO_CONTEST with no scores, so the board read 0/21 sets and
 * every player sat on zero points. Groups A-F in the same season are intact. The gap is in the
 * ORIGINAL scrape, not something the site lost afterwards: `archive/cueverse-prime/data/csv/
 * group_matches.csv` has rows for `2012-s2-A-GA` through `-GF` and none at all for `-GG`, and the
 * same emptiness is present in a database copy taken before any recent work.
 *
 * ── Where the scores come from ───────────────────────────────────────────────────────────────────
 * The archived 8brcam.com group table, which the owner supplied as a screenshot. The archived page
 * itself builds its tables client-side, so the HTML behind the Wayback URL carries no data to parse.
 *
 * Transcribing a screenshot into historical records needs more than care, so it is checked three
 * ways and every one of them has to agree before this writes anything:
 *
 *   1. MIRROR. A cross-table states each result twice, once from each side. All 20 played cells are
 *      compared against their opposite cell; a single mistyped digit breaks the pair.
 *   2. POINTS. The archive prints each player's points and W-L-D. Those are recomputed from the
 *      transcribed cells under the season's own rule — 3 for a win, 1 for a draw, plus 1 for
 *      completing every set — and must match the published figures exactly.
 *   3. ROSTER. The seven players are checked against `group_standings.csv`, which DOES have Group G
 *      rows even though the matches are missing.
 *
 * ── The seventh player ───────────────────────────────────────────────────────────────────────────
 * The archive names him Luis and the live board names him Neo, which looks like a mismatch and is
 * not: archive player P1316 carries `Luis`, `el_drunken` and `Neo` among his aliases, the live
 * entrant `Starkiller` displays as `Neo`, and the owner confirmed the three are one person. Every
 * other seat matches by name.
 *
 * ── What it writes ───────────────────────────────────────────────────────────────────────────────
 * Only `season_match` rows for this one group: 20 fixtures move NO_CONTEST -> COMPLETED with their
 * games and winner, and the 21st stays NO_CONTEST because it was never played — Pita and Dan show
 * 0-0 in the archive and both players' records account for five matches, not six.
 *
 * Standings are then recomputed by the application's own engine rather than written here, so the
 * points on the board are derived by the same code as every other group.
 *
 *   node ... scripts/repair-2012-s2-group-g.mts            # dry run: verify and report, write nothing
 *   node ... scripts/repair-2012-s2-group-g.mts --apply    # apply
 */
import { PrismaClient } from '@prisma/client'

const SEASON_ID = 5497
const GROUP_CODE = 'G'
const apply = process.argv.includes('--apply')
const prisma = new PrismaClient()

/** Archive display name -> the live entrant's username. Confirmed seat by seat. */
const SEAT: Record<string, string> = {
  Kevin: 'sixohtwo',
  Omar: 'lvlr.l3rutal_king',
  Jason: 'british_pool_wizard',
  Pita: 'azn_pride_luva',
  Dan: 'dwaechte',
  Luis: 'Starkiller',
  Ben: 'fhm_champion',
}

/**
 * The archive cross-table, row by row, exactly as printed.
 *
 * Kept in its original shape rather than pre-reduced to a fixture list: this is what a reader can
 * hold against the screenshot, and the mirror check below only means something because both halves
 * are written out independently.
 */
const COLUMNS = ['Kevin', 'Omar', 'Jason', 'Pita', 'Dan', 'Luis', 'Ben'] as const
const TABLE: Record<string, (string | null)[]> = {
  //        Kevin   Omar    Jason   Pita    Dan     Luis    Ben
  Kevin: [null, '4-6', '6-4', '7-3', '6-4', '1-9', '6-4'],
  Omar: ['6-4', null, '7-3', '6-4', '6-4', '4-6', '1-9'],
  Jason: ['4-6', '3-7', null, '6-4', '2-8', '5-5', '5-5'],
  Pita: ['3-7', '4-6', '4-6', null, '0-0', '6-4', '1-9'],
  Dan: ['4-6', '4-6', '8-2', '0-0', null, '4-6', '5-5'],
  Luis: ['9-1', '6-4', '5-5', '4-6', '6-4', null, '5-5'],
  Ben: ['4-6', '9-1', '5-5', '9-1', '5-5', '5-5', null],
}

/** The published standings, used to prove the transcription rather than to write anything. */
const PUBLISHED: Record<string, { pts: number; w: number; l: number; d: number }> = {
  Kevin: { pts: 13, w: 4, l: 2, d: 0 },
  Omar: { pts: 13, w: 4, l: 2, d: 0 },
  Jason: { pts: 6, w: 1, l: 3, d: 2 },
  Pita: { pts: 3, w: 1, l: 4, d: 0 },
  Dan: { pts: 4, w: 1, l: 3, d: 1 },
  Luis: { pts: 12, w: 3, l: 1, d: 2 },
  Ben: { pts: 10, w: 2, l: 1, d: 3 },
}

/** A 0-0 is the archive's way of printing a fixture nobody played. */
const NOT_PLAYED = '0-0'

const parse = (cell: string) => {
  const [a, b] = cell.split('-').map(Number)
  return { a, b }
}

let failures = 0
function must(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok   ${label}`)
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}

async function main() {
  console.log('Check 1 — the cross-table states every result twice, and the two agree')
  const fixtures: { home: string; away: string; hg: number; ag: number; played: boolean }[] = []
  for (let i = 0; i < COLUMNS.length; i += 1) {
    for (let j = i + 1; j < COLUMNS.length; j += 1) {
      const home = COLUMNS[i]
      const away = COLUMNS[j]
      const cell = TABLE[home][j]
      const mirror = TABLE[away][i]
      if (cell == null || mirror == null) { must(`${home} v ${away}: both cells present`, false); continue }
      const f = parse(cell)
      const m = parse(mirror)
      must(`${home} ${cell} ${away} mirrors ${mirror}`, f.a === m.b && f.b === m.a, `${cell} vs ${mirror}`)
      fixtures.push({ home, away, hg: f.a, ag: f.b, played: cell !== NOT_PLAYED })
    }
  }
  must('the table describes 21 fixtures', fixtures.length === 21, `${fixtures.length}`)
  const played = fixtures.filter((f) => f.played)
  must('...of which 20 were played', played.length === 20, `${played.length}`)

  console.log('\nCheck 2 — the transcription reproduces the published points and records')
  for (const name of COLUMNS) {
    let w = 0; let l = 0; let d = 0; let complete = true
    for (let j = 0; j < COLUMNS.length; j += 1) {
      const cell = TABLE[name][j]
      if (cell == null) continue
      if (cell === NOT_PLAYED) { complete = false; continue }
      const { a, b } = parse(cell)
      if (a > b) w += 1
      else if (a < b) l += 1
      else d += 1
    }
    /* The season's own rule, printed in the board's legend: 3 a win, 1 a draw, 1 for a full slate. */
    const pts = w * 3 + d + (complete ? 1 : 0)
    const exp = PUBLISHED[name]
    must(`${name}: ${w}-${l}-${d}, ${pts} pts`,
      w === exp.w && l === exp.l && d === exp.d && pts === exp.pts,
      `expected ${exp.w}-${exp.l}-${exp.d}, ${exp.pts} pts`)
  }

  console.log('\nCheck 3 — the roster matches the live group, seat for seat')
  const group = await prisma.seasonGroup.findFirst({
    where: { seasonId: SEASON_ID, code: GROUP_CODE }, select: { id: true },
  })
  if (!group) { must('the group exists', false); return }
  const seats = await prisma.seasonGroupPlayer.findMany({
    where: { groupId: group.id },
    include: { entrant: { select: { id: true, username: true, displayName: true } } },
  })
  const byUsername = new Map(seats.map((s) => [s.entrant.username, s.entrant]))
  must('the live group holds seven players', seats.length === 7, `${seats.length}`)
  for (const [archiveName, username] of Object.entries(SEAT)) {
    const e = byUsername.get(username)
    must(`${archiveName} → ${username}`, e != null,
      e ? '' : `not in the live group (has: ${[...byUsername.keys()].join(', ')})`)
  }

  if (failures > 0) {
    console.log(`\nREFUSING TO WRITE: ${failures} check(s) failed.`)
    return
  }

  console.log('\nAll checks pass. Matching fixtures to rows...')
  const rows = await prisma.seasonMatch.findMany({ where: { groupId: group.id } })
  must('the group holds 21 fixture rows', rows.length === 21, `${rows.length}`)

  const plan: { id: number; hg: number; ag: number; winner: number | null; label: string }[] = []
  for (const f of fixtures) {
    if (!f.played) continue
    const homeId = byUsername.get(SEAT[f.home])!.id
    const awayId = byUsername.get(SEAT[f.away])!.id
    /*
      The stored row may hold the pair in either orientation, so the score is turned to match the row
      rather than the row being rewritten to match the transcription. Writing 6-4 into a row whose
      home player is the one who lost would invert the result silently.
    */
    const row = rows.find((r) =>
      (r.homeEntrantId === homeId && r.awayEntrantId === awayId)
      || (r.homeEntrantId === awayId && r.awayEntrantId === homeId))
    if (!row) { must(`a row exists for ${f.home} v ${f.away}`, false); continue }
    const sameWay = row.homeEntrantId === homeId
    const hg = sameWay ? f.hg : f.ag
    const ag = sameWay ? f.ag : f.hg
    const winner = hg === ag ? null : (hg > ag ? row.homeEntrantId : row.awayEntrantId)
    plan.push({ id: row.id, hg, ag, winner, label: `${row.homeUsername} ${hg}-${ag} ${row.awayUsername}` })
  }
  must('every played fixture found its row', plan.length === 20, `${plan.length}`)
  if (failures > 0) { console.log('\nREFUSING TO WRITE.'); return }

  console.log('\nPlanned writes:')
  for (const w of plan) console.log(`  ${w.label}`)
  const untouched = rows.filter((r) => !plan.some((w) => w.id === r.id))
  console.log(`Left NO_CONTEST (never played): ${untouched.map((r) => `${r.homeUsername} v ${r.awayUsername}`).join(', ')}`)

  if (!apply) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return }

  await prisma.$transaction(async (tx) => {
    for (const w of plan) {
      await tx.seasonMatch.update({
        where: { id: w.id },
        data: { homeGames: w.hg, awayGames: w.ag, winnerEntrantId: w.winner, status: 'COMPLETED' },
      })
    }
  })
  console.log(`\nWrote ${plan.length} results.`)

  /* Standings come from the application's engine, so this group is derived like every other one. */
  const { recomputeSeasonStandings } = await import('../src/lib/seasons/group-stage')
  await recomputeSeasonStandings(SEASON_ID, { revalidateClinches: true })
  console.log('Standings recomputed for the season.')

  const after = await prisma.seasonStanding.findMany({
    where: { groupId: group.id }, orderBy: { rank: 'asc' },
    select: { username: true, points: true, wins: true, losses: true, draws: true, played: true },
  })
  console.log('\nResulting board:')
  for (const r of after) {
    console.log(`  ${r.username.padEnd(22)} ${r.points} pts  ${r.wins}-${r.losses}-${r.draws}  played ${r.played}`)
  }
}

try {
  await main()
} finally {
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}
