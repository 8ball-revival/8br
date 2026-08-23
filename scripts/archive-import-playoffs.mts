/**
 * Import the playoff results the archived bracket pages record.
 *
 * ── What is imported, and what is refused ────────────────────────────────────────────────────────
 * Only a match the page individually proves: two named participants, a numeric result, and a winner
 * who is the player the next round actually receives. Anything else is left unresolved, which is why
 * a Season can finish this run with most of its playoff filled in and still, correctly, not be
 * complete. A Season is only completed when the chain runs unbroken to a Final that produces the
 * champion the page names.
 *
 * Nothing is written to the playoff tables directly. Every result goes through the same services the
 * Creator's own buttons call, so a reconstructed playoff obeys the same advancement rules, the same
 * downstream-correction handling and the same audit trail as one entered by hand.
 *
 * ── Orientation ──────────────────────────────────────────────────────────────────────────────────
 * The page's left-hand player and the bracket's home slot are not necessarily the same person. The
 * score is therefore matched to the players by identity and only then written, because writing it
 * positionally would silently reverse results whenever the two disagreed.
 *
 * Usage:
 *   tsx scripts/archive-import-playoffs.mts --dry-run [--season ID]
 *   tsx scripts/archive-import-playoffs.mts --apply   [--season ID]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { parseWayback, type WaybackBracket, type WaybackMatch } from '../src/lib/archive/wayback.ts'
import { stripSourceNote } from '../src/lib/archive/manifest.ts'
import { startSeasonPlayoffs, recordSeasonPlayoffResult, generateSeasonBracket, setSeasonBracketSlot, setSeasonPlayoffIncluded } from '../src/lib/seasons/playoffs.ts'
import { addSeasonEntrant } from '../src/lib/seasons/service.ts'
import { closeSeason } from '../src/lib/seasons/close.ts'

assertLocalDatabase()

const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const ONLY = ARGS.includes('--season') ? Number(ARGS[ARGS.indexOf('--season') + 1]) : null
const ACTOR = { userId: 2, username: 'archive-playoffs' }
const COVERAGE = 'reports/archive-wayback-playoff-coverage.json'

interface CoverageRow {
  sourceFile: string; competitionYear: number; seasonNumber: number
  seasonId: number | null; eligible: boolean; blockReason: string | null
  category: string; alreadyCompleted: boolean
}

if (!existsSync(COVERAGE)) throw new Error(`run archive-wayback-coverage.mts first — ${COVERAGE} is missing`)
const coverage = JSON.parse(readFileSync(COVERAGE, 'utf8')) as CoverageRow[]

const RECON = 'reports/archive-playoff-field-reconciliation.json'
if (!existsSync(RECON)) throw new Error('run archive-playoff-reconcile.mts first')
interface ReconRow {
  seasonId: number; safeToReconcile: boolean; reason: string
  manifestOnly: string[]; waybackOnly: string[]
  handles: { handle: string; inBracketEntry: boolean; entrantId: number | null; playerId: string | null; resolution: string }[]
}
const reconciliation = JSON.parse(readFileSync(RECON, 'utf8')) as ReconRow[]

const targets = coverage.filter((r) => r.eligible && r.seasonId && (ONLY === null || r.seasonId === ONLY))
console.log(`${targets.length} eligible Season(s)${APPLY ? '' : ' — DRY RUN'}`)

/** An archive handle resolved to the entrant row that represents that person in this Season. */
async function entrantFor(seasonId: number, handle: string): Promise<number | null> {
  const h = stripSourceNote(handle).toLowerCase()
  const direct = await prisma.seasonEntrant.findFirst({
    where: { seasonId, cueverseId: { equals: h, mode: 'insensitive' } },
    select: { id: true },
  })
  if (direct) return direct.id
  // A merged handle survives as an alias on the account that absorbed it.
  const alias = await prisma.playerAlias.findFirst({
    where: { alias: { equals: stripSourceNote(handle), mode: 'insensitive' } },
    select: { playerId: true },
  })
  if (!alias) return null
  const viaAlias = await prisma.seasonEntrant.findFirst({
    where: { seasonId, playerId: alias.playerId },
    select: { id: true },
  })
  return viaAlias?.id ?? null
}

interface SeasonOutcome {
  seasonId: number
  label: string
  imported: number
  byes: number
  skipped: number
  finalImported: boolean
  completed: boolean
  stoppedAt: string | null
  reseated: number
  deselected: string[]
  selected: string[]
  entered: string[]
  notes: string[]
}

const outcomes: SeasonOutcome[] = []

for (const row of targets) {
  const seasonId = row.seasonId!
  const label = `${row.competitionYear} S${row.seasonNumber}A`
  const out: SeasonOutcome = { seasonId, label, imported: 0, byes: 0, skipped: 0, finalImported: false, completed: false, stoppedAt: null, reseated: 0, deselected: [], selected: [], entered: [], notes: [] }
  outcomes.push(out)

  const bracket: WaybackBracket = parseWayback(readFileSync(row.sourceFile, 'utf8'), row.sourceFile)
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { lifecycleState: true, championName: true, ladderAppliedAt: true },
  })
  if (!season) { out.stoppedAt = 'the Season no longer exists'; continue }
  if (String(season.lifecycleState) === 'COMPLETED') { out.stoppedAt = 'already complete — left untouched'; continue }

  const dbMatches: { id: number; round: number; slot: number; homeEntrantId: number | null; awayEntrantId: number | null; homeGames: number | null; awayGames: number | null; winnerEntrantId: number | null }[] = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId },
    select: { id: true, round: true, slot: true, homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true, winnerEntrantId: true },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })
  /*
   * The selected field, taken from the page when the page proves the whole of it.
   *
   * A qualifier who occupies no entry position on a complete bracket did not enter it, so they are
   * deselected — and only deselected. Their Season entry and every group result they played stay
   * exactly as they are, and nothing records them as having lost or forfeited, because the source
   * does not say that. It says only that they are not in the draw.
   *
   * Somebody the page seats who the manifest never listed is added and selected, because a complete
   * bracket showing them in an entry position is evidence they played.
   */
  const recon = reconciliation.find((r) => r.seasonId === seasonId)
  if (recon?.safeToReconcile && APPLY) {
    for (const handle of recon.manifestOnly) {
      const e = await entrantFor(seasonId, handle)
      if (!e) continue
      const r = await setSeasonPlayoffIncluded(ACTOR, seasonId, e, false)
      if (r.ok) out.deselected.push(handle)
      else out.notes.push(`deselect ${handle}: ${r.error}`)
    }
    for (const handle of recon.waybackOnly) {
      let e = await entrantFor(seasonId, handle)
      if (!e) {
        const hc = recon.handles.find((h) => h.handle === handle)
        if (!hc?.playerId) { out.notes.push(`${handle} has no account to enter`); continue }
        const added = await addSeasonEntrant(ACTOR, seasonId, hc.playerId)
        if (!added.ok) { out.notes.push(`enter ${handle}: ${added.error}`); continue }
        e = await entrantFor(seasonId, handle)
        if (e) out.entered.push(handle)
      }
      if (!e) continue
      const r = await setSeasonPlayoffIncluded(ACTOR, seasonId, e, true)
      if (r.ok) out.selected.push(handle)
      else out.notes.push(`select ${handle}: ${r.error}`)
    }
  } else if (recon && !recon.safeToReconcile) {
    out.notes.push(`field left as selected — ${recon.reason}`)
  }

  /*
   * The draft, drawn from the page rather than from the seeding.
   *
   * These Seasons reached playoff setup with their field selected but no bracket at all, because
   * the season manifest records who took part and not where they were drawn. The archived page
   * does record it, so the bracket is generated at the size the page shows and then seated from
   * the page — every position source-proven, none inferred from group finishing order.
   */
  if (dbMatches.length === 0) {
    if (!APPLY) {
      out.notes.push(`would draw a bracket of ${bracket.bracketSize} and seat round 1 from the page`)
      out.byes = bracket.matches.filter((m) => m.bye).length
      out.imported = bracket.matches.filter((m) => m.proven && !m.bye && m.scoreHome !== null).length
      out.skipped = bracket.matches.length - out.byes - out.imported
      out.finalImported = Boolean(bracket.matches.find((m) => m.advancesTo === null)?.proven)
      continue
    }
    const gen = await generateSeasonBracket(ACTOR, seasonId, { size: bracket.bracketSize })
    if (!gen.ok) { out.stoppedAt = `generate bracket: ${gen.error}`; continue }
    for (const pm of bracket.matches.filter((m) => m.round === 1)) {
      const slot = await prisma.seasonPlayoffMatch.findFirst({
        where: { seasonId, round: 1, slot: pm.position }, select: { id: true },
      })
      if (!slot) continue
      const sides: ['home' | 'away', typeof pm.home][] = [['home', pm.home], ['away', pm.away]]
      for (const [side, player] of sides) {
        // A bye is an empty side. It is never a player and never becomes a result.
        const entrantId = player && !player.bye ? await entrantFor(seasonId, player.rawHandle) : null
        const r = await setSeasonBracketSlot(ACTOR, seasonId, slot.id, side, entrantId)
        if (!r.ok) out.notes.push(`seat R1.${pm.position} ${side}: ${r.error}`)
      }
    }
    dbMatches.push(...await prisma.seasonPlayoffMatch.findMany({
      where: { seasonId },
      select: { id: true, round: true, slot: true, homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true, winnerEntrantId: true },
      orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    }))
  }
  if (dbMatches.length === 0) { out.stoppedAt = 'no bracket could be drawn'; continue }

  /*
   * Bring round 1 into line with the page, writing only where it differs.
   *
   * A bracket drawn before the field was reconciled has a gap where the page seats somebody the
   * manifest never listed. Re-seating unconditionally would work but would also rewrite every slot
   * on every run, so each position is compared first and left alone when it already matches — which
   * is what keeps a repeat run genuinely silent.
   */
  if (APPLY && String((await prisma.season.findUniqueOrThrow({ where: { id: seasonId }, select: { lifecycleState: true } })).lifecycleState) === 'PLAYOFF_SETUP') {
    for (const pm of bracket.matches.filter((m) => m.round === 1)) {
      const slot = await prisma.seasonPlayoffMatch.findFirst({
        where: { seasonId, round: 1, slot: pm.position },
        select: { id: true, homeEntrantId: true, awayEntrantId: true },
      })
      if (!slot) continue
      const sides: ['home' | 'away', typeof pm.home][] = [['home', pm.home], ['away', pm.away]]
      for (const [side, player] of sides) {
        const want = player && !player.bye ? await entrantFor(seasonId, player.rawHandle) : null
        const have = side === 'home' ? slot.homeEntrantId : slot.awayEntrantId
        if (want === have) continue
        const r = await setSeasonBracketSlot(ACTOR, seasonId, slot.id, side, want)
        if (r.ok) out.reseated++
        else out.notes.push(`reseat R1.${pm.position} ${side}: ${r.error}`)
      }
    }
    dbMatches.length = 0
    dbMatches.push(...await prisma.seasonPlayoffMatch.findMany({
      where: { seasonId },
      select: { id: true, round: true, slot: true, homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true, winnerEntrantId: true },
      orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    }))
  }

  /*
   * The database's round 1 must be the bracket the page draws.
   *
   * Importing scores onto a differently seated bracket would attach real results to the wrong
   * people, so the seating is checked before anything is written and the Season is skipped whole if
   * it disagrees.
   */
  let seatingOk = true
  for (const pm of bracket.matches.filter((m) => m.round === 1)) {
    const db = dbMatches.find((d) => d.round === 1 && d.slot === pm.position)
    if (!db) { seatingOk = false; out.notes.push(`round 1 slot ${pm.position} is missing from the bracket`); break }
    for (const [side, player] of [['home', pm.home], ['away', pm.away]] as const) {
      if (!player || player.bye) continue
      const want = await entrantFor(seasonId, player.rawHandle)
      const got = side === 'home' ? db.homeEntrantId : db.awayEntrantId
      if (want && got && want !== got) {
        seatingOk = false
        out.notes.push(`round 1 slot ${pm.position} ${side}: the page has ${player.normalizedHandle}, the bracket has someone else`)
        break
      }
    }
    if (!seatingOk) break
  }
  if (!seatingOk) { out.stoppedAt = 'the generated bracket does not match the page'; continue }

  if (!APPLY) {
    const provable = bracket.matches.filter((m) => m.proven && !m.bye && m.scoreHome !== null)
    out.imported = provable.length
    out.byes = bracket.matches.filter((m) => m.bye).length
    out.skipped = bracket.matches.length - provable.length - out.byes
    out.finalImported = Boolean(bracket.matches.find((m) => m.advancesTo === null)?.proven)
    continue
  }

  // ── Start the playoffs through the canonical service ──────────────────────────────────────────
  if (String(season.lifecycleState) === 'PLAYOFF_SETUP') {
    const s = await startSeasonPlayoffs(ACTOR, seasonId)
    if (!s.ok) { out.stoppedAt = `start playoffs: ${s.error}`; continue }
  }

  /*
   * Results in dependency order.
   *
   * Round by round, position by position, so a later round is only written once the match feeding it
   * has been. The bracket state is re-read each time because recording a result advances the winner,
   * which is what fills in the next round's participants.
   */
  const ordered = [...bracket.matches].sort((a, b) => a.round - b.round || a.position - b.position)
  let stop = false

  for (const pm of ordered) {
    if (stop) break
    if (pm.bye) { out.byes++; continue }
    if (!pm.proven || pm.scoreHome === null || pm.scoreAway === null) {
      out.skipped++
      if (!out.stoppedAt) {
        out.stoppedAt = `R${pm.round} match ${pm.position + 1}: ${pm.rawScore ? `the page prints "${pm.rawScore}"` : 'no result recorded'}`
      }
      continue
    }

    const db = await prisma.seasonPlayoffMatch.findFirst({
      where: { seasonId, round: pm.round, slot: pm.position },
      select: { id: true, homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true },
    })
    if (!db) { out.skipped++; out.notes.push(`R${pm.round}.${pm.position} has no bracket slot`); continue }

    // Never overwrite a result already recorded.
    if (db.homeGames !== null && db.awayGames !== null) { out.notes.push(`R${pm.round}.${pm.position} already scored — left alone`); continue }

    if (!db.homeEntrantId || !db.awayEntrantId) {
      out.skipped++
      if (!out.stoppedAt) out.stoppedAt = `R${pm.round} match ${pm.position + 1}: the bracket has no pair to score`
      continue
    }

    /*
     * The score, matched to the people rather than to the sides.
     *
     * The page's left-hand player is not necessarily the bracket's home slot, and writing the score
     * positionally would reverse the result wherever they differ.
     */
    const pageHome = pm.home ? await entrantFor(seasonId, pm.home.rawHandle) : null
    const pageAway = pm.away ? await entrantFor(seasonId, pm.away.rawHandle) : null
    let homeGames: number, awayGames: number
    if (pageHome === db.homeEntrantId && pageAway === db.awayEntrantId) {
      homeGames = pm.scoreHome; awayGames = pm.scoreAway
    } else if (pageHome === db.awayEntrantId && pageAway === db.homeEntrantId) {
      homeGames = pm.scoreAway; awayGames = pm.scoreHome
    } else {
      out.skipped++
      out.notes.push(`R${pm.round}.${pm.position}: the page's players are not the pair in this slot`)
      if (!out.stoppedAt) out.stoppedAt = `R${pm.round} match ${pm.position + 1}: participants do not match`
      continue
    }

    const r = await recordSeasonPlayoffResult(ACTOR, db.id, homeGames, awayGames, { confirmRebuild: true })
    if (!r.ok) {
      out.notes.push(`R${pm.round}.${pm.position}: ${r.error}`)
      if (!out.stoppedAt) out.stoppedAt = `R${pm.round} match ${pm.position + 1}: ${r.error}`
      stop = pm.round > 1
      continue
    }
    out.imported++
    if (pm.advancesTo === null) out.finalImported = true
  }

  // ── Completion, only on a real Final that produces the recorded champion ──────────────────────
  const finalPm = bracket.matches.find((m) => m.advancesTo === null)
  if (out.finalImported && bracket.validation.category === 'full' && bracket.champion && finalPm) {
    const finalDb = await prisma.seasonPlayoffMatch.findFirst({
      where: { seasonId, round: finalPm.round, slot: finalPm.position },
      select: { winnerEntrantId: true },
    })
    const wantChampion = await entrantFor(seasonId, bracket.champion)
    if (finalDb?.winnerEntrantId && wantChampion && finalDb.winnerEntrantId === wantChampion) {
      const c = await closeSeason(ACTOR, seasonId)
      if (c.ok) out.completed = true
      else out.notes.push(`close: ${c.error}`)
    } else {
      out.notes.push('the Final\'s winner is not the champion the page names — not completed')
    }
  } else if (out.finalImported) {
    out.notes.push('the Final is imported but earlier matches are unproven — left incomplete')
  }
}

mkdirSync('reports', { recursive: true })
writeFileSync('reports/archive-playoff-import.json', JSON.stringify(outcomes, null, 2))

const totals = outcomes.reduce((a, o) => ({
  imported: a.imported + o.imported,
  byes: a.byes + o.byes,
  skipped: a.skipped + o.skipped,
  finals: a.finals + (o.finalImported ? 1 : 0),
  completed: a.completed + (o.completed ? 1 : 0),
}), { imported: 0, byes: 0, skipped: 0, finals: 0, completed: 0 })

console.log('\n' + JSON.stringify({ seasons: outcomes.length, ...totals }, null, 2))
for (const o of outcomes) {
  console.log(`  ${o.label} (${o.seasonId}): imported=${o.imported} byes=${o.byes} skipped=${o.skipped} final=${o.finalImported} completed=${o.completed} field(-${o.deselected.length}/+${o.selected.length}) reseated=${o.reseated}${o.stoppedAt ? ` — stops at ${o.stoppedAt}` : ''}`)
}

await prisma.$disconnect()
