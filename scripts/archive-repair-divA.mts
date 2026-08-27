/**
 * Unlock a proven set of Division A archive Seasons so the reconstruction can rebuild them.
 *
 * ── The problem this exists for ─────────────────────────────────────────────────────────────────
 * The archive reconstruction improves a Season by walking it back to registration, entering the
 * players the BRACKET seats that the group table never listed, rebuilding the group stage from the
 * manifest, and seating and scoring the playoff from the archived page. Every tool that does this
 * refuses a Season that has contributed a result — completed, champion recorded, ranking applied,
 * ledger rows present — and that refusal is correct: a competitive record is not something a script
 * should be able to overwrite on its way past.
 *
 * These forty-four Seasons were completed by an OLDER import, under different rules, and then the
 * reconstruction that would have corrected them was reversed on 23 August. So they sit in exactly
 * the state their own repair tooling refuses, holding champions and ratings derived from a group
 * stage the archive does not support.
 *
 * ── What this does, and what it deliberately is not ─────────────────────────────────────────────
 * It clears the completion gates for an EXPLICIT ALLOWLIST of Seasons, so the canonical archive
 * services can rebuild them and re-complete them by their own rules. It is not a lifecycle bypass:
 * it changes no guard, exposes no flag, and names every Season it may touch in its own source. A
 * Season not in the list cannot be unlocked by passing an argument, because there is no argument
 * that adds one.
 *
 * The allowlist is not "every Season that fails an audit". It is every Season whose ARCHIVED PAGE
 * can seat and decide a bracket (`page=full`), because a Season unlocked without a page to rebuild
 * its playoff from would lose the champion it has and gain nothing — strictly worse than leaving it
 * alone. Seasons whose page is placement-only, unusable, or carries `tbd` placeholders are excluded
 * for that reason and reported, not silently skipped.
 *
 * ── The ledger ──────────────────────────────────────────────────────────────────────────────────
 * Ratings are path-dependent, so this does not delete some rows and leave the rest. It clears the
 * ledger for the unlocked Seasons and then rebuilds the WHOLE ledger once through the canonical
 * service, which replays every still-completed competition in its own chronological order. A
 * repaired Season re-enters that timeline where its history puts it, not at the end.
 *
 * ── REHEARSAL RESULT, 26 August 2026: NOT APPLIED ──────────────────────────────────────────────
 * Rehearsed twice against a clone of the local database. It must not be run against real data as it
 * stands, and the reason is worth keeping next to the code.
 *
 * Unlocking works exactly as intended: 27 Seasons cleared, ledger rebuilt deterministically. What
 * does not work is the rebuild afterwards. The reconstruction is ITERATIVE -- each playoff-import
 * pass seats what it can and then stops on handles the bracket names that resolve to no entrant,
 * and clearing those is identity work that was done interactively, with the owner, across roughly
 * twenty commits. Running the whole documented chain end to end re-completed 14 of 27 Seasons and
 * left 13 in playoff setup with no champion at all.
 *
 * Measured against the archive, the full chain moved the audit from 340 failing checks to 338 --
 * thirteen Seasons better, twelve worse -- while stranding those thirteen. The identity scripts on
 * their own, which strand nobody, moved it from 340 to 344.
 *
 * So the honest summary is that this tool removes the blocker it was written for and the work behind
 * the blocker is not mechanical. Re-completing the remaining Seasons needs identity decisions the
 * sources do not contain, which is the same long tail the reconstruction's own notes describe as
 * "a judgement about how much the old import should be re-litigated".
 *
 * Usage:
 *   tsx scripts/archive-repair-divA.mts --dry-run
 *   tsx scripts/archive-repair-divA.mts --apply [--season ID]
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { recordAudit } from '../src/lib/competition/audit.ts'
import { rebuildRatingLedger } from '../src/lib/stats/ledger.ts'

assertLocalDatabase()

const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const ONLY = ARGS.includes('--season') ? Number(ARGS[ARGS.indexOf('--season') + 1]) : null
if (!APPLY && !ARGS.includes('--dry-run')) throw new Error('pass --dry-run or --apply')

const ACTOR = { userId: 2, username: 'archive-repair' }
const REPORT = 'reports/archive-repair-divA.json'

/*
 * ── The allowlist ───────────────────────────────────────────────────────────────────────────────
 * Written out rather than derived, so that what this tool may touch is reviewable without running
 * it. Each id is a Division A archive Season whose page is `full`: the reconstruction can seat its
 * bracket, decide it, and complete the Season again.
 *
 * Derivation, for the record (reports/archive-repair-inventory.json):
 *   - 15 with a full page and participants-only placement   2008 S1-S5, 2009 S1-S3, 2010 S1/S3/S4,
 *                                                            2011 S2-S5
 *   - 11 with a full page and exact placement                2012 S1-S5, 2013 S1-S5, 2014 S1
 *   -  1 playoff-only Season                                 2009 S5A
 *
 * Excluded on purpose: 2006 S1A/S2A and 2007 S3A-S6A (page placement-only or unusable, so no
 * playoff could be rebuilt), and 2009 S4A, 2009 S6A, 2010 S2A, 2011 S1A (page carries literal `tbd`
 * in round-one positions; a missing player cannot be settled from the advancement).
 */
const ALLOWLIST: readonly number[] = [
  // 2008 — full page, participants-only placement
  5455, 5457, 5459, 5461, 5463,
  // 2009 — full page (S4/S6 excluded for tbd; S5 is the playoff-only Season, below)
  5465, 5467, 5469,
  // 2010 — full page (S2 excluded for tbd)
  5477, 5481, 5483,
  // 2011 — full page (S1 excluded for tbd)
  5487, 5489, 5491, 5493,
  // 2012-2014 — full page, exact placement
  5495, 5497, 5499, 5501, 5503,
  5505, 5507, 5509, 5511, 5513,
  5515,
  // 2009 S5A — a complete playoff page and no group stage at all
  5473,
]

/**
 * 2009 S5A is the one Season the archive gives a full bracket and NO group stage: no groups, no
 * group matches, no standings. Its 8 groups, 168 matches and 56 standings are unsupported by any
 * source and are removed rather than rebuilt.
 */
const PLAYOFF_ONLY = 5473

interface Outcome {
  seasonId: number
  label: string
  action: 'unlocked' | 'refused' | 'already-unlocked' | 'skipped'
  refusals: string[]
  before: Record<string, unknown>
  removed: Record<string, number>
}

const targets = await prisma.season.findMany({
  where: { id: { in: ONLY ? [ONLY] : [...ALLOWLIST] } },
  select: {
    id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true,
    lifecycleState: true, championName: true, championHandle: true, championPlayerId: true,
    runnerUpName: true, runnerUpHandle: true, finalScore: true, completedAt: true,
    ladderAppliedAt: true, reconstruction: true,
  },
  orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
})

if (ONLY && !ALLOWLIST.includes(ONLY)) {
  throw new Error(`Season ${ONLY} is not in the allowlist. This tool cannot be pointed at a Season it does not name.`)
}

const outcomes: Outcome[] = []

for (const s of targets) {
  const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`
  const out: Outcome = { seasonId: s.id, label, action: 'refused', refusals: [], before: {}, removed: {} }

  const ledger = await prisma.ratingLedger.count({ where: { seasonId: s.id } })
  const [entrants, groups, standings, matches, playoff] = await Promise.all([
    prisma.seasonEntrant.count({ where: { seasonId: s.id } }),
    prisma.seasonGroup.count({ where: { seasonId: s.id } }),
    prisma.seasonStanding.count({ where: { seasonId: s.id } }),
    prisma.seasonMatch.count({ where: { seasonId: s.id } }),
    prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id } }),
  ])
  out.before = {
    lifecycleState: String(s.lifecycleState), champion: s.championName,
    ladderApplied: Boolean(s.ladderAppliedAt), ledger, entrants, groups, standings, matches, playoff,
  }

  // ── Preconditions. Anything unexpected refuses rather than adapts. ────────────────────────────
  if (!s.archiveTemplateKey) out.refusals.push('not an archive-linked Season')
  if (s.division !== 'A') out.refusals.push(`division ${s.division}, expected A`)
  if (!s.reconstruction) out.refusals.push('not a reconstruction')

  /*
   * Idempotence. A Season already unlocked is not an error and is not unlocked twice -- a rerun
   * after an interrupted pass has to be safe, and re-clearing an already-clear Season would let a
   * genuine surprise (a Season somebody re-completed by hand) pass unnoticed.
   */
  const alreadyClear = String(s.lifecycleState) !== 'COMPLETED' && !s.championName && !s.ladderAppliedAt && ledger === 0
  if (alreadyClear) {
    out.action = 'already-unlocked'
    outcomes.push(out)
    continue
  }

  if (String(s.lifecycleState) !== 'COMPLETED') {
    out.refusals.push(`expected COMPLETED, found ${s.lifecycleState} with champion=${s.championName ?? '-'} ledger=${ledger}`)
  }

  if (out.refusals.length > 0) {
    outcomes.push(out)
    console.log(`${label}: REFUSED — ${out.refusals.join('; ')}`)
    continue
  }

  out.removed = {
    ratingLedgerRows: ledger,
    ...(s.id === PLAYOFF_ONLY ? { groups, standings, groupMatches: matches } : {}),
  }

  if (!APPLY) {
    out.action = 'unlocked'
    outcomes.push(out)
    console.log(`${label} (${s.id}): would clear champion ${s.championName}, ladder stamp, ${ledger} ledger row(s)`
      + (s.id === PLAYOFF_ONLY ? `, and remove ${groups} unsupported group(s), ${matches} group match(es), ${standings} standing(s)` : ''))
    continue
  }

  /*
   * One transaction per Season: a Season is either unlocked or untouched, never half-cleared with
   * its champion gone and its ledger still standing.
   */
  await prisma.$transaction(async (tx) => {
    await tx.ratingLedger.deleteMany({ where: { seasonId: s.id } })

    if (s.id === PLAYOFF_ONLY) {
      /*
       * The unsupported group stage goes, in dependency order. These rows are not an incomplete
       * version of the truth -- the archive records no group stage for this Season at all, so they
       * describe a competition that did not happen, and they currently feed the Rankings.
       */
      const groupIds = (await tx.seasonGroup.findMany({ where: { seasonId: s.id }, select: { id: true } })).map((g) => g.id)
      await tx.seasonMatch.deleteMany({ where: { seasonId: s.id } })
      await tx.seasonStanding.deleteMany({ where: { seasonId: s.id } })
      await tx.seasonGroupPlayer.deleteMany({ where: { groupId: { in: groupIds } } })
      await tx.seasonGroup.deleteMany({ where: { seasonId: s.id } })
    }

    await tx.season.update({
      where: { id: s.id },
      data: {
        lifecycleState: 'PLAYOFF_SETUP',
        championName: null, championHandle: null, championPlayerId: null,
        runnerUpName: null, runnerUpHandle: null, finalScore: null,
        completedAt: null, ladderAppliedAt: null,
      },
    })

    await recordAudit(
      ACTOR,
      {
        action: 'season.archive.repair.unlock',
        entity: 'Season',
        entityId: s.id,
        oldValue: out.before,
        newValue: { lifecycleState: 'PLAYOFF_SETUP', champion: null, ladderApplied: false, ledger: 0 },
        reason: 'archive repair: cleared the completion gates so the canonical reconstruction can rebuild this Season',
      },
      tx,
    )
  })

  out.action = 'unlocked'
  outcomes.push(out)
  console.log(`${label} (${s.id}): unlocked`)
}

// ── The ledger, rebuilt once and deterministically ──────────────────────────────────────────────
let ledgerAfter: number | null = null
if (APPLY && outcomes.some((o) => o.action === 'unlocked')) {
  /*
   * A full replay rather than a patch. The canonical service orders the timeline itself and selects
   * only still-completed competitions, so the unlocked Seasons drop out and everything else keeps
   * the position its own history gives it.
   */
  console.log('\nrebuilding the rating ledger (full deterministic replay)…')
  const res = await prisma.$transaction(async (tx) => rebuildRatingLedger(tx), { timeout: 600_000 })
  ledgerAfter = await prisma.ratingLedger.count()
  console.log(`  ${res.tournaments} tournament(s), ${res.seasons} season(s), ${res.entries} ledger entr(ies)`)
}

mkdirSync('reports', { recursive: true })
const report = {
  mode: APPLY ? 'apply' : 'dry-run',
  allowlistSize: ALLOWLIST.length,
  considered: targets.length,
  unlocked: outcomes.filter((o) => o.action === 'unlocked').length,
  alreadyUnlocked: outcomes.filter((o) => o.action === 'already-unlocked').length,
  refused: outcomes.filter((o) => o.action === 'refused').length,
  ledgerRowsAfterRebuild: ledgerAfter,
  outcomes,
}
writeFileSync(REPORT, JSON.stringify(report, null, 2))

console.log(`\n${JSON.stringify({
  mode: report.mode, considered: report.considered, unlocked: report.unlocked,
  alreadyUnlocked: report.alreadyUnlocked, refused: report.refused,
  ledgerRowsAfterRebuild: report.ledgerRowsAfterRebuild,
}, null, 2)}`)
console.log(`report: ${REPORT}`)

await prisma.$disconnect()
if (report.refused > 0) process.exitCode = 1
