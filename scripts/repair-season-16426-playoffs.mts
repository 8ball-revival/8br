/**
 * 8BRCAM 2026 Season 1 (id 16426) — rebuild the losers bracket to the shape the competition
 * actually played, and replay every final-stage match from the fixed Challonge record.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────────────────────────
 * The winners bracket was right; the losers bracket was a different tournament. The Season was
 * generated as a 32-slot double elimination, whose losers round one pairs WINNERS-ROUND-ONE LOSERS
 * AGAINST EACH OTHER. Challonge pairs each winners-round-one loser against a WINNERS-ROUND-TWO
 * loser — so Adambuddy, who Challonge has eliminated by _Tarantula_69, was instead handed a walkover
 * by a losers tie nobody could reach. Replaying results into that shape would have produced correct
 * scores in the wrong matches.
 *
 * ── The shape being built ────────────────────────────────────────────────────────────────────────
 * 38 matches for 20 entrants, which is exactly 2n-2 with no bracket reset:
 *
 *   WB  R1  1  2  3  4                  (seeds 13-20; seeds 1-12 enter on byes, which are KEPT as
 *   WB  R2  5..12                        explicit round-one positions rather than collapsed away)
 *   WB  R3  21 22 23 24
 *   WB  R4  31 32
 *   WB  F   36
 *   LB  R1  13 14 15 16                 WB R2 loser vs WB R1 loser
 *   LB  R2  17 18 19 20                 LB R1 winner vs WB R2 loser
 *   LB  R3  25 26 27 28                 LB R2 winner vs WB R3 loser
 *   LB  R4  29 30                       LB R3 winners
 *   LB  R5  33 34                       LB R4 winner vs WB R4 loser
 *   LB  R6  35                          LB R5 winners
 *   LB  F   37                          LB R6 winner vs WB final loser
 *   GF      38                          sixohtwo 9-1 Travis, won from the winners' side
 *
 * ── What it does not do ──────────────────────────────────────────────────────────────────────────
 * Decide anything. Every result comes from the source, and advancement is computed by the bracket
 * engine as each result is recorded — this script never writes a winner into a later round itself.
 * The winners bracket rows, their seeds and their entry positions are left exactly as they are.
 *
 * Run:  ... scripts/repair-season-16426-playoffs.mts --dry-run
 *       ... scripts/repair-season-16426-playoffs.mts --apply
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { recordSeasonPlayoffResult, resettleSeasonByes } from '../src/lib/seasons/playoffs.ts'

const SEASON = 16426
const APPLY = process.argv.includes('--apply')
assertLocalDatabase('repair Season 16426 playoffs')
const actor = { userId: 0, username: 'season-16426-repair' }
const DERRICK = '\u{1F48E} (Derrick)'

const IDENT: Record<string, string> = {
  'sixohtwo': 'sixohtwo', 'Mr.Gaz': 'NoLimitGary', 'Adambuddy': 'adambuddy', 'fsm_brian': 'fsm_brian',
  'neo': 'Starkiller', 'JC': 'IrateMusicfool', 'jabronni16': 'i.am_the_zodiac', 'mynameiseskimo': 'eskimo',
  'Travis': 'Travis', 'Iantunstall': 'Iantunstall', '_Tarantula_69': 'FreakyLilspider', 'o_aig_o': 'o_aig_o',
  'l_Mr_CC_l': 'l_Mr_CC_l', 'S_U_K_I_O_O': 'S_U_K_I_O_O', [DERRICK]: '\u{1F48E}', 'Black_Jesus': 'Black_Jesus',
  'Easyrun': 'easyrun', 'Ogges': 'xlx_ogges_xlx', 'leighjohn__': 'mr.spin', 'Faisal': 'F_A_I_S_A_L',
}

/** Challonge identifier → [home, homeScore, away, awayScore]. Home/away follow the source's own order. */
const MATCHES: Record<number, [string, number, string, number]> = {
  1: ['mynameiseskimo', 7, 'fsm_brian', 5],
  2: ['jabronni16', 7, 'o_aig_o', 0],
  3: ['_Tarantula_69', 2, 'Faisal', 7],
  4: ['Mr.Gaz', 9, 'Black_Jesus', 7],
  5: ['JC', 4, 'leighjohn__', 7],
  // Recorded as legitimate 10-0 results on instruction; neither is a forfeit. Only a source result
  // of 1-0 is a forfeit, and the final stage contains none.
  6: ['l_Mr_CC_l', 10, 'Adambuddy', 0],
  7: ['Iantunstall', 7, 'Ogges', 4],
  8: ['S_U_K_I_O_O', 7, DERRICK, 5],
  9: ['sixohtwo', 7, 'mynameiseskimo', 3],
  10: ['neo', 7, 'jabronni16', 1],
  11: ['Easyrun', 7, 'Faisal', 2],
  12: ['Travis', 10, 'Mr.Gaz', 0],
  13: ['JC', 7, 'Black_Jesus', 1],
  14: ['Adambuddy', 0, '_Tarantula_69', 7],
  15: ['Ogges', 7, 'o_aig_o', 0],
  16: [DERRICK, 7, 'fsm_brian', 3],
  17: ['mynameiseskimo', 8, 'JC', 6],
  18: ['jabronni16', 7, '_Tarantula_69', 4],
  19: ['Faisal', 9, 'Ogges', 7],
  20: ['Mr.Gaz', 0, DERRICK, 7],
  21: ['sixohtwo', 9, 'leighjohn__', 7],
  22: ['neo', 6, 'l_Mr_CC_l', 8],
  23: ['Easyrun', 10, 'Iantunstall', 8],
  24: ['Travis', 7, 'S_U_K_I_O_O', 3],
  25: ['leighjohn__', 7, 'Faisal', 3],
  26: ['neo', 0, DERRICK, 7],
  27: ['Iantunstall', 0, 'mynameiseskimo', 7],
  28: ['S_U_K_I_O_O', 7, 'jabronni16', 0],
  29: [DERRICK, 5, 'leighjohn__', 7],
  30: ['S_U_K_I_O_O', 7, 'mynameiseskimo', 0],
  31: ['sixohtwo', 9, 'l_Mr_CC_l', 3],
  32: ['Easyrun', 9, 'Travis', 4],
  33: ['l_Mr_CC_l', 9, 'S_U_K_I_O_O', 4],
  34: ['Travis', 9, 'leighjohn__', 7],
  35: ['Travis', 10, 'l_Mr_CC_l', 8],
  36: ['sixohtwo', 10, 'Easyrun', 8],
  37: ['Easyrun', 5, 'Travis', 9],
  38: ['sixohtwo', 9, 'Travis', 1],
}

/**
 * The source's own seeding, 1-20.
 *
 * The stored seeds are NOT these. This Season was seeded from the single-round-robin standings that
 * turned out to be wrong, so its numbering differs — although every pairing is identical, because
 * the qualification order it produced happened to place the same players opposite each other. The
 * numbering is corrected here so the bracket agrees with the source in what it shows as well as in
 * what it played.
 */
const SEEDS: Record<string, number> = {
  'sixohtwo': 1, 'Easyrun': 2, 'Travis': 3, 'neo': 4, 'l_Mr_CC_l': 5, 'S_U_K_I_O_O': 6,
  'Iantunstall': 7, 'JC': 8, 'leighjohn__': 9, 'Ogges': 10, [DERRICK]: 11, 'Adambuddy': 12,
  'jabronni16': 13, 'Mr.Gaz': 14, '_Tarantula_69': 15, 'mynameiseskimo': 16, 'fsm_brian': 17,
  'Faisal': 18, 'Black_Jesus': 19, 'o_aig_o': 20,
}

/** Losers-bracket rows to create: identifier → [round, slot, label]. LB rounds are stored 100+n. */
const LB_ROWS: Record<number, [number, number, string]> = {
  13: [101, 0, 'Losers R1 · M1'], 14: [101, 1, 'Losers R1 · M2'],
  15: [101, 2, 'Losers R1 · M3'], 16: [101, 3, 'Losers R1 · M4'],
  17: [102, 0, 'Losers R2 · M1'], 18: [102, 1, 'Losers R2 · M2'],
  19: [102, 2, 'Losers R2 · M3'], 20: [102, 3, 'Losers R2 · M4'],
  25: [103, 0, 'Losers R3 · M1'], 26: [103, 1, 'Losers R3 · M2'],
  27: [103, 2, 'Losers R3 · M3'], 28: [103, 3, 'Losers R3 · M4'],
  29: [104, 0, 'Losers R4 · M1'], 30: [104, 1, 'Losers R4 · M2'],
  33: [105, 0, 'Losers R5 · M1'], 34: [105, 1, 'Losers R5 · M2'],
  35: [106, 0, 'Losers R6'],
  37: [107, 0, 'Losers Final'],
}

/** Where each match sends its winner, and (winners bracket only) its loser: id → [matchId, slot]. */
const WINNER_TO: Record<number, [number, 0 | 1]> = {
  1: [9, 1], 2: [10, 1], 3: [11, 1], 4: [12, 1],
  5: [21, 1], 6: [22, 1], 7: [23, 1], 8: [24, 1],
  9: [21, 0], 10: [22, 0], 11: [23, 0], 12: [24, 0],
  21: [31, 0], 22: [31, 1], 23: [32, 0], 24: [32, 1],
  31: [36, 0], 32: [36, 1], 36: [38, 0],
  13: [17, 1], 14: [18, 1], 15: [19, 1], 16: [20, 1],
  17: [27, 1], 18: [28, 1], 19: [25, 1], 20: [26, 1],
  25: [29, 1], 26: [29, 0], 27: [30, 1], 28: [30, 0],
  29: [34, 1], 30: [33, 1], 33: [35, 1], 34: [35, 0],
  35: [37, 1], 37: [38, 1],
}
const LOSER_TO: Record<number, [number, 0 | 1]> = {
  1: [16, 1], 2: [15, 1], 3: [14, 1], 4: [13, 1],
  5: [13, 0], 6: [14, 0], 7: [15, 0], 8: [16, 0],
  9: [17, 0], 10: [18, 0], 11: [19, 0], 12: [20, 0],
  21: [25, 0], 22: [26, 0], 23: [27, 0], 24: [28, 0],
  31: [33, 0], 32: [34, 0], 36: [37, 0],
}

async function main() {
  const [{ current_database: db }] = await prisma.$queryRaw<{ current_database: string }[]>`select current_database()`
  console.log(`Database: ${db}   mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

  const entrants = await prisma.seasonEntrant.findMany({ where: { seasonId: SEASON }, select: { id: true, username: true, displayName: true, cueverseId: true } })
  const byCid = new Map(entrants.map((e) => [e.cueverseId ?? '', e]))
  const ent = (n: string) => {
    const e = byCid.get(IDENT[n])
    if (!e) throw new Error(`no entrant for ${n} (${IDENT[n]})`)
    return e
  }
  const label = (e: { username: string; displayName: string | null }) => e.displayName?.trim() || e.username

  const rows = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: SEASON }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
  const wb = rows.filter((r) => r.section === 'WB')
  const lb = rows.filter((r) => r.section === 'LB')
  const gf = rows.filter((r) => r.section === 'GF')

  console.log(`current: ${wb.length} winners rows, ${lb.length} losers rows, ${gf.length} grand final`)
  console.log(`target : ${wb.length} winners rows (unchanged), ${Object.keys(LB_ROWS).length} losers rows, 1 grand final\n`)

  /*
   * Map each winners-bracket identifier onto the row that already holds that pairing.
   *
   * The winners bracket is correct and stays; only its loser feeds are rewired. Matching on the
   * PAIR rather than on a computed slot means this cannot silently bind to the wrong row if the
   * generated ordering ever differs from what is assumed here.
   */
  const dbOf = new Map<number, number>()

  // Round one is seated, so its four real ties can be matched on the pairing itself.
  for (const id of [1, 2, 3, 4]) {
    const [a, , b] = MATCHES[id]
    const ea = ent(a), eb = ent(b)
    const hit = wb.filter((m) => m.round === 1
      && ((m.homeEntrantId === ea.id && m.awayEntrantId === eb.id) || (m.homeEntrantId === eb.id && m.awayEntrantId === ea.id)))
    if (hit.length !== 1) throw new Error(`winners match ${id} (${a} v ${b}) matched ${hit.length} rows`)
    dbOf.set(id, hit[0].id)
  }

  /*
   * Everything above round one is found by FOLLOWING THE FEEDS, not by looking at who is sitting in
   * it. A later tie may be empty — the winners final was never played — so matching on participants
   * cannot find it, and guessing a slot ordering would bind silently to the wrong row. Each match is
   * therefore identified as "the tie both of its sources feed into", and the two sources must agree.
   */
  /*
   * A bye position is found by WHO is in it, not by its seed number.
   *
   * The stored seeds are not Challonge's: this Season was seeded from the single-round-robin
   * standings that turned out to be wrong, so its numbering differs even though every pairing is
   * the same. Keying on the entrant is therefore both unambiguous and independent of the numbering,
   * which is corrected to the source further down.
   */
  const byeSeat = (name: string) => {
    const e = ent(name)
    const hit = wb.filter((m) => m.round === 1
      && ((m.homeEntrantId === e.id && m.awayEntrantId == null) || (m.awayEntrantId === e.id && m.homeEntrantId == null)))
    if (hit.length !== 1) throw new Error(`${name} has ${hit.length} round-one bye positions`)
    return hit[0].id
  }
  /** Sources of each winners tie: a player who entered on a bye, or an earlier match identifier. */
  const SOURCES: Record<number, [{ bye?: string; match?: number }, { bye?: string; match?: number }]> = {
    5: [{ bye: 'JC' }, { bye: 'leighjohn__' }], 6: [{ bye: 'l_Mr_CC_l' }, { bye: 'Adambuddy' }],
    7: [{ bye: 'Iantunstall' }, { bye: 'Ogges' }], 8: [{ bye: 'S_U_K_I_O_O' }, { bye: DERRICK }],
    9: [{ bye: 'sixohtwo' }, { match: 1 }], 10: [{ bye: 'neo' }, { match: 2 }],
    11: [{ bye: 'Easyrun' }, { match: 3 }], 12: [{ bye: 'Travis' }, { match: 4 }],
    21: [{ match: 9 }, { match: 5 }], 22: [{ match: 10 }, { match: 6 }],
    23: [{ match: 11 }, { match: 7 }], 24: [{ match: 12 }, { match: 8 }],
    31: [{ match: 21 }, { match: 22 }], 32: [{ match: 23 }, { match: 24 }],
    36: [{ match: 31 }, { match: 32 }],
  }
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const id of [5, 6, 7, 8, 9, 10, 11, 12, 21, 22, 23, 24, 31, 32, 36]) {
    const targets = SOURCES[id].map((s) => {
      const src = s.bye != null ? byeSeat(s.bye) : dbOf.get(s.match!)
      if (src == null) throw new Error(`match ${id}: source not mapped yet`)
      const feeds = byId.get(src)!.feedsMatchId
      if (feeds == null) throw new Error(`match ${id}: source ${src} feeds nowhere`)
      return feeds
    })
    if (targets[0] !== targets[1]) throw new Error(`match ${id}: its two sources feed different ties (${targets.join(' vs ')})`)
    dbOf.set(id, targets[0])
  }
  console.log(`mapped ${dbOf.size} winners-bracket matches onto their existing rows, by following the feeds`)

  console.log('\n── losers bracket: the shape being replaced ──')
  console.log(`  was: ${lb.length} rows over rounds ${[...new Set(lb.map((r) => r.round - 100))].join(', ')}`)
  console.log('       WB round-one losers paired against EACH OTHER, leaving unreachable ties')
  console.log(`  now: 18 rows over rounds 1-7, WB round-one losers paired against WB round-two losers`)
  for (const [idStr, [rd, slot, lbl]] of Object.entries(LB_ROWS)) {
    const id = Number(idStr)
    const [a, ag, b, bg] = MATCHES[id]
    console.log(`       M${String(id).padEnd(2)} → LB${rd - 100} slot ${slot}  ${lbl.padEnd(16)} ${a} ${ag}-${bg} ${b}`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await prisma.$disconnect()
    return
  }

  await prisma.$transaction(async (tx) => {
    // Out with the generated losers bracket, in with the one that was played.
    await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId: SEASON, section: 'LB' } })

    const created = new Map<number, number>()
    for (const [idStr, [rd, slot, lbl]] of Object.entries(LB_ROWS)) {
      const row = await tx.seasonPlayoffMatch.create({
        data: { seasonId: SEASON, section: 'LB', round: rd, slot, label: lbl, published: true },
      })
      created.set(Number(idStr), row.id)
    }
    for (const [k, v] of created) dbOf.set(k, v)
    dbOf.set(38, gf[0].id)

    // Clear every result, and empty every seat that an earlier round feeds. Winners round one is an
    // entry round, so its seeded and bye positions stay exactly as generated.
    const fedKeys = new Set<string>()
    for (const [id, [target, slot]] of Object.entries(WINNER_TO)) fedKeys.add(`${dbOf.get(Number(target))}:${slot}`)
    for (const [id, [target, slot]] of Object.entries(LOSER_TO)) fedKeys.add(`${dbOf.get(Number(target))}:${slot}`)
    for (const m of [...wb, ...gf]) {
      await tx.seasonPlayoffMatch.update({
        where: { id: m.id },
        data: {
          winnerEntrantId: null, homeGames: null, awayGames: null, forfeitEntrantId: null,
          status: 'SCHEDULED', verification: 'UNVERIFIED', needsReview: false, completedAt: null,
          ...(fedKeys.has(`${m.id}:0`) ? { homeEntrantId: null, homeUsername: null, homeSeed: null } : {}),
          ...(fedKeys.has(`${m.id}:1`) ? { awayEntrantId: null, awayUsername: null, awaySeed: null } : {}),
        },
      })
    }

    // Rewire every feed to the new topology.
    const allIds = new Set([...Object.keys(WINNER_TO), ...Object.keys(LOSER_TO)].map(Number))
    for (const id of allIds) {
      const w = WINNER_TO[id], l = LOSER_TO[id]
      await tx.seasonPlayoffMatch.update({
        where: { id: dbOf.get(id)! },
        data: {
          feedsMatchId: w ? dbOf.get(w[0])! : null, feedsSlot: w ? w[1] : null,
          loserFeedsMatchId: l ? dbOf.get(l[0])! : null, loserFeedsSlot: l ? l[1] : null,
        },
      })
    }
    // Winners round-one BYE matches send nobody down: they have no loser to send.
    await tx.seasonPlayoffMatch.updateMany({
      where: { seasonId: SEASON, section: 'WB', round: 1, id: { notIn: [1, 2, 3, 4].map((i) => dbOf.get(i)!) } },
      data: { loserFeedsMatchId: null, loserFeedsSlot: null },
    })

    /*
     * Correct the seeding to the source, on the entrant and on the round-one positions it is read
     * from. Only round one needs writing: every later round is seated by the engine, which carries
     * the seed along with the player it advances.
     */
    for (const [name, seed] of Object.entries(SEEDS)) {
      await tx.seasonEntrant.update({ where: { id: ent(name).id }, data: { playoffSeed: seed } })
    }
    const r1 = await tx.seasonPlayoffMatch.findMany({ where: { seasonId: SEASON, section: 'WB', round: 1 } })
    const seedOfEntrant = new Map(Object.entries(SEEDS).map(([n, s]) => [ent(n).id, s]))
    for (const m of r1) {
      await tx.seasonPlayoffMatch.update({
        where: { id: m.id },
        data: {
          ...(m.homeEntrantId != null ? { homeSeed: seedOfEntrant.get(m.homeEntrantId) ?? null } : {}),
          ...(m.awayEntrantId != null ? { awaySeed: seedOfEntrant.get(m.awayEntrantId) ?? null } : {}),
        },
      })
    }
  }, { timeout: 120_000 })
  console.log('\nlosers bracket rebuilt and every feed rewired')

  await resettleSeasonByes(actor, SEASON)

  let done = 0
  for (const id of Object.keys(MATCHES).map(Number).sort((a, b) => a - b)) {
    const [a, ag, b, bg] = MATCHES[id]
    const ea = ent(a), eb = ent(b)
    const target = dbOf.get(id)
    if (target == null) throw new Error(`no row mapped for match ${id}`)
    const m = await prisma.seasonPlayoffMatch.findUnique({ where: { id: target } })
    if (!m) throw new Error(`row ${target} vanished`)
    const seated = new Set([m.homeEntrantId, m.awayEntrantId])
    if (!seated.has(ea.id) || !seated.has(eb.id)) {
      throw new Error(`match ${id}: the engine seated ${m.homeUsername} v ${m.awayUsername}, source says ${a} v ${b}`)
    }
    const homeIsA = m.homeEntrantId === ea.id
    const r = await recordSeasonPlayoffResult(actor, m.id, homeIsA ? ag : bg, homeIsA ? bg : ag, { confirmRebuild: true })
    if (!r.ok) throw new Error(`match ${id} (${a} v ${b}): ${r.error}`)
    done++
  }
  console.log(`replayed ${done} of ${Object.keys(MATCHES).length} matches; every pairing matched what the engine seated`)
  void label
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
