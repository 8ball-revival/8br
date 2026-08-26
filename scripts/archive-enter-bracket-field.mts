/**
 * Enter everyone an archived bracket seats who the Season's participant table never listed.
 *
 * ── Why this exists alongside the single-player tool ─────────────────────────────────────────────
 * `archive-enter-bracket-player.mts` enters one person: it walks the Season back to registration,
 * adds them, and leaves the group stage to be rebuilt. That was right for three people found by
 * hand. It is the wrong shape for two hundred across twenty Seasons, because each call would rewind
 * and rebuild the same Season again — twenty times over, for one Season's worth of names.
 *
 * So this settles a Season's whole field in one rewind: work out everybody the bracket seats who has
 * no entrant row, undo the derived work once, add them all, and hand back to the ordinary importers.
 *
 * ── Why the bracket may name people the group table does not ─────────────────────────────────────
 * The owner's account: players changed their CueVerse ID mid-Season and the admins updated the
 * bracket without going back to the group tables. So the two sources disagree about the roster
 * without either being wrong about what happened — and the bracket, which is a drawing of the draw,
 * is the better record of who actually played the playoff.
 *
 * ── What it will not do ──────────────────────────────────────────────────────────────────────────
 * It refuses any Season that has contributed a result: completed, champion recorded, ranking
 * applied, or carrying a rating-ledger row. Those are records, not drafts. It enters only handles
 * the bracket itself seats, and only ones that already resolve to exactly one Player — it creates
 * nobody and merges nobody.
 *
 * Usage: tsx scripts/archive-enter-bracket-field.mts [--apply] [--season ID]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { parseWayback } from '../src/lib/archive/wayback.ts'
import { resolveCanonical } from '../src/lib/archive/canonical-identity.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { addSeasonEntrant } from '../src/lib/seasons/service.ts'

assertLocalDatabase()

const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const ONLY = ARGS.includes('--season') ? Number(ARGS[ARGS.indexOf('--season') + 1]) : null
const ACTOR = { userId: 2, username: 'archive-import' }
const COVERAGE = 'reports/archive-wayback-playoff-coverage.json'
const OUT = 'reports/archive-bracket-field-entry.json'

interface CoverageRow {
  sourceFile: string; competitionYear: number; seasonNumber: number
  seasonId: number | null; eligible: boolean
}
const coverage = (JSON.parse(readFileSync(COVERAGE, 'utf8')) as CoverageRow[])
  .filter((r) => r.eligible && r.seasonId && (ONLY === null || r.seasonId === ONLY))

interface Outcome {
  season: string; seasonId: number
  refused: string[]
  entered: { handle: string; playerId: string }[]
  unresolved: string[]
  before: number; after: number
}
const outcomes: Outcome[] = []

for (const row of coverage) {
  const label = `${row.competitionYear} S${row.seasonNumber}A`
  const out: Outcome = { season: label, seasonId: row.seasonId!, refused: [], entered: [], unresolved: [], before: 0, after: 0 }
  outcomes.push(out)

  const s = await prisma.season.findUnique({
    where: { id: row.seasonId! },
    select: { id: true, lifecycleState: true, championName: true, ladderAppliedAt: true, reconstruction: true, archiveTemplateKey: true },
  })
  if (!s) { out.refused.push('the Season no longer exists'); continue }
  if (!s.archiveTemplateKey) out.refused.push('not an archive-linked Season')
  if (!s.reconstruction) out.refused.push('not a reconstruction')
  if (String(s.lifecycleState) === 'COMPLETED') out.refused.push('the Season is complete')
  if (s.championName) out.refused.push(`a champion is recorded (${s.championName})`)
  if (s.ladderAppliedAt) out.refused.push('a ranking contribution was applied')
  const ledger = await prisma.ratingLedger.count({ where: { seasonId: row.seasonId! } })
  if (ledger > 0) out.refused.push(`${ledger} rating-ledger row(s) exist`)

  out.before = await prisma.seasonEntrant.count({ where: { seasonId: row.seasonId! } })
  out.after = out.before
  if (out.refused.length > 0) { console.log(`${label}: REFUSED — ${out.refused.join('; ')}`); continue }
  if (!existsSync(row.sourceFile)) { out.refused.push('no bracket source'); continue }

  const bracket = parseWayback(readFileSync(row.sourceFile, 'utf8'), row.sourceFile)
  const handles = [...new Set(
    bracket.matches
      .filter((m) => m.round === 1)
      .flatMap((m) => [m.home, m.away])
      .filter((x): x is NonNullable<typeof x> => Boolean(x) && !x!.bye)
      .map((x) => x.normalizedHandle),
  )]

  /*
   * Resolve the whole field before touching anything.
   *
   * Two spellings on one page can be one Player, so the additions are worked out as a set of Player
   * ids rather than a list of handles — otherwise the same person is added twice and the second add
   * fails, leaving the Season rewound for nothing.
   */
  const wanted = new Map<string, string>() // playerId -> the handle that named them
  for (const h of handles) {
    const id = await resolveCanonical(row.seasonId!, h)
    if (id.resolution !== 'resolved' || !id.playerId) { out.unresolved.push(h); continue }
    if (id.entrantId) continue
    if (!wanted.has(id.playerId)) wanted.set(id.playerId, h)
  }

  if (wanted.size === 0) {
    console.log(`${label}: nothing to enter — the bracket's field is already entered${out.unresolved.length ? ` (${out.unresolved.length} unresolved)` : ''}`)
    continue
  }
  console.log(`${label}: ${wanted.size} to enter${out.unresolved.length ? `, ${out.unresolved.length} unresolved` : ''} — ${[...wanted.values()].slice(0, 6).join(', ')}${wanted.size > 6 ? ' …' : ''}`)
  if (!APPLY) continue

  /*
   * One rewind for the whole field. The bracket and the group stage are both derived from the
   * entrants, so both come down before the field changes, and the recovery transition is the
   * lifecycle's own designed route back rather than a write behind the service's back.
   */
  await prisma.$transaction(async (tx) => {
    await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId: row.seasonId! } })
    await tx.seasonStanding.deleteMany({ where: { seasonId: row.seasonId! } })
    await tx.seasonMatch.deleteMany({ where: { seasonId: row.seasonId! } })
    await tx.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: row.seasonId! } } })
    await tx.seasonGroup.deleteMany({ where: { seasonId: row.seasonId! } })
  }, { timeout: 120_000 })

  const back = await transitionSeasonState(ACTOR, row.seasonId!, 'REGISTRATION_OPEN', {
    recovery: true,
    reason: `archive reconstruction: the archived bracket seats ${wanted.size} player(s) the participant table does not list`,
  })
  if (!back.ok) { out.refused.push(`rewind: ${back.error}`); console.log(`  rewind FAILED: ${back.error}`); continue }

  for (const [playerId, handle] of wanted) {
    const added = await addSeasonEntrant(ACTOR, row.seasonId!, playerId)
    if (added.ok) out.entered.push({ handle, playerId })
    else out.refused.push(`${handle}: ${added.error}`)
  }
  out.after = await prisma.seasonEntrant.count({ where: { seasonId: row.seasonId! } })
  console.log(`  entered ${out.entered.length}/${wanted.size} — ${out.before} → ${out.after} entrant(s)`)
}

mkdirSync('reports', { recursive: true })
writeFileSync(OUT, JSON.stringify(outcomes, null, 2))
const entered = outcomes.reduce((a, o) => a + o.entered.length, 0)
console.log(`\n${outcomes.length} Season(s), ${entered} entrant(s) added${APPLY ? '' : ' — DRY RUN'}`)
console.log(APPLY ? 'now re-run: import-archive-seasons.mts --apply   then   archive-import-playoffs.mts --apply' : '')
await prisma.$disconnect()
