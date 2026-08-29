/**
 * Season 16426 — what the corrected bye rule would do to it. READ-ONLY.
 *
 * Reads a JSON snapshot of the bracket (taken with psql, so this process has no connection to
 * production at all) and runs the real `analyseByes` over it, then simulates settlement exactly as
 * the engine does. It writes nothing anywhere. Its whole job is to say, before anything is applied,
 * which ties would be decided, to whom, and which positions would only be renamed.
 *
 * Run:  psql "$PROD" -Atc "<the season_playoff_match query>" > s16426.json
 *       npx tsx --tsconfig scripts/tsconfig.verify.json scripts/dryrun-season-16426.mts s16426.json
 */
import { readFileSync } from 'node:fs'
import { analyseByes, type ByeMatch } from '../src/lib/seasons/playoffs.ts'

interface Row extends ByeMatch {
  section: string | null
  round: number
  slot: number
  label: string | null
  homeUsername: string | null
  awayUsername: string | null
  forfeitEntrantId: number | null
  status: string
  needsReview: boolean
}

const rows: Row[] = JSON.parse(readFileSync(process.argv[2] ?? 's16426.json', 'utf8'))
const byId = new Map(rows.map((r) => [r.id, r]))
const label = (m: Row) => `#${m.id} ${m.section}${m.section === 'LB' ? m.round - 100 : m.round} slot ${m.slot}`
const nameOf = (m: Row, id: number) => (m.homeEntrantId === id ? m.homeUsername : m.awayUsername) ?? String(id)

console.log(`\nSeason 16426 — ${rows.length} ties\n${'='.repeat(78)}`)

// ── What is wrong with it right now ─────────────────────────────────────────────────────────────
const undecided = rows.filter((m) => m.winnerEntrantId == null)
const occupied = undecided.filter((m) => m.homeEntrantId != null || m.awayEntrantId != null)
console.log(`\nBEFORE`)
console.log(`  decided            ${rows.length - undecided.length}`)
console.log(`  undecided          ${undecided.length}  (${occupied.length} holding at least one player)`)
console.log(`  forfeits recorded  ${rows.filter((m) => m.forfeitEntrantId != null).length}`)
console.log(`  flagged for review ${rows.filter((m) => m.needsReview).length}`)

// ── Simulate settlement, exactly as settleByes does ──────────────────────────────────────────────
const decisions: { m: Row; winner: number }[] = []
const renames: { m: Row; side: 'home' | 'away' }[] = []
for (let pass = 0; pass <= rows.length + 2; pass++) {
  const view = analyseByes(rows)
  let changed = false
  for (const m of rows) {
    if (m.winnerEntrantId != null || m.feedsMatchId == null || m.needsReview) continue
    const homeReal = m.homeEntrantId != null
    const awayReal = m.awayEntrantId != null
    const homeBye = !homeReal && view.permanentlyEmpty(m.id, 0)
    const awayBye = !awayReal && view.permanentlyEmpty(m.id, 1)
    if (!((homeReal && awayBye) || (awayReal && homeBye))) continue
    const winner = (m.homeEntrantId ?? m.awayEntrantId)!
    const name = homeReal ? m.homeUsername : m.awayUsername
    m.winnerEntrantId = winner
    if (homeBye && m.homeUsername == null) m.homeUsername = 'Bye'
    if (awayBye && m.awayUsername == null) m.awayUsername = 'Bye'
    const target = byId.get(m.feedsMatchId)!
    if ((m.feedsSlot ?? 0) === 0) { target.homeEntrantId = winner; target.homeUsername = name }
    else { target.awayEntrantId = winner; target.awayUsername = name }
    decisions.push({ m, winner })
    changed = true
  }
  if (changed) continue
  for (const m of rows) {
    if (m.homeEntrantId == null && m.homeUsername == null && view.permanentlyEmpty(m.id, 0)) { m.homeUsername = 'Bye'; renames.push({ m, side: 'home' }) }
    if (m.awayEntrantId == null && m.awayUsername == null && view.permanentlyEmpty(m.id, 1)) { m.awayUsername = 'Bye'; renames.push({ m, side: 'away' }) }
  }
  break
}

console.log(`\nWALKOVERS THAT WOULD BE AWARDED — ${decisions.length}`)
for (const { m, winner } of decisions) {
  console.log(`  ${label(m).padEnd(22)} ${m.homeUsername ?? '(empty)'} v ${m.awayUsername ?? '(empty)'}`)
  console.log(`  ${''.padEnd(22)}   → advances ${nameOf(m, winner)} to #${m.feedsMatchId} slot ${m.feedsSlot ?? 0}; no score, no forfeit`)
}

console.log(`\nPOSITIONS ONLY RENAMED TO "Bye" (no winner, no score) — ${renames.length}`)
for (const { m, side } of renames) console.log(`  ${label(m).padEnd(22)} ${side}`)

// ── What would NOT change ───────────────────────────────────────────────────────────────────────
console.log(`\nUNCHANGED`)
const stillUndecided = rows.filter((m) => m.winnerEntrantId == null)
const view = analyseByes(rows)
const stuck = stillUndecided.filter((m) => !(m.homeEntrantId == null && m.awayEntrantId == null
  && view.permanentlyEmpty(m.id, 0) && view.permanentlyEmpty(m.id, 1)))
console.log(`  every recorded result and forfeit is untouched — settlement skips a decided tie`)
console.log(`  ties left genuinely waiting to be PLAYED: ${stuck.length}`)
for (const m of stuck) {
  const ready = m.homeEntrantId != null && m.awayEntrantId != null
  console.log(`    ${label(m).padEnd(22)} ${m.homeUsername ?? '(empty)'} v ${m.awayUsername ?? '(empty)'}`
    + `  ${ready ? '← ready to score' : '← waiting on a real feeder'}`)
}

const impossible = stillUndecided.filter((m) => !stuck.includes(m))
console.log(`  ties nobody can ever reach (named, never decided): ${impossible.length}`)
