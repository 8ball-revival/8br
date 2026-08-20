import 'server-only'
import { revalidatePath } from 'next/cache'

import { invalidateRankings } from '@/lib/stats/invalidate-rankings'

import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { transitionSeasonState } from '@/lib/seasons/lifecycle'
import { seasonChampion } from '@/lib/seasons/playoffs'
import { seasonCloseSummary } from '@/lib/seasons/close'

/**
 * Correcting a completed competition.
 *
 * A finished Season is evidence. Sometimes the evidence is wrong — a score entered from a bad
 * screenshot, a champion recorded against the wrong handle — and the record has to be corrected
 * without pretending it was never published. That is what this file is: reopen, correct, complete
 * again, with the ranking contribution withdrawn for exactly as long as the record is untrustworthy.
 *
 * ── Why there is no reversal arithmetic ──────────────────────────────────────────────────────────
 * The obvious implementation subtracts the Season's contribution on reopen and adds the corrected
 * one back on completion. It is also the one that goes wrong: a retry subtracts twice, a partial
 * failure leaves half a withdrawal, and Elo is sequential so a subtraction in the middle of a chain
 * is not even well defined.
 *
 * This does none of that. `rebuildRatingLedger` replays EVERY still-completed competition from the
 * start, in historical order, and writes the whole ledger. So:
 *
 *   reopen      → the Season is no longer COMPLETED → the replay omits it → contribution gone
 *   recomplete  → it is COMPLETED again → the replay includes it → contribution applied
 *
 * Both are the same operation, and running either one twice produces the same ledger as running it
 * once. Idempotence is a property of the rebuild, not a flag somebody has to remember to check.
 *
 * The ledger is DERIVED. Rebuilding it destroys no competition data: entrants, groups, matches,
 * scores, standings, bracket topology, placements and champions are all canonical and untouched.
 *
 * ── One eligibility rule ─────────────────────────────────────────────────────────────────────────
 * "Reopened" is expressed with the canonical fields from the lifecycle checkpoint — lifecycle plus
 * `reopenedAt` — so Archives, Live and the Rankings all see the change through the rule they
 * already share. There is no second notion of eligibility here.
 */

export type CorrectionKind = 'season' | 'tournament'

export interface CorrectionResult {
  ok: boolean
  error?: string
  /** Set when the request was a no-op because the record was already in the requested state. */
  alreadyDone?: boolean
}

// ── Review ───────────────────────────────────────────────────────────────────────────────────────

export interface CompletionReview {
  kind: CorrectionKind
  id: number
  title: string
  competition: string
  year: number | null
  number: number | null
  division: string | null
  format: string
  entrants: number
  champion: string | null
  runnerUp: string | null
  finalScore: string | null
  /** Matches whose results will feed the Rankings. */
  eligibleMatches: number
  /** Matches deliberately excluded: byes, administrative advancements, forfeits, no-contests. */
  excludedMatches: number
  /** The championship this completion awards, when it awards one. */
  award: 'SC' | 'TC' | null
  completeness: 'full' | 'partial'
  completedAt: string | null
  finalisedAt: string | null
  reopenedAt: string | null
  /** Ledger rows this record currently contributes. Zero while reopened. */
  ledgerRows: number
  /** Blocking problems — completion is refused while any of these stand. */
  errors: string[]
  /** Non-blocking, but the operator should see them before confirming. */
  warnings: string[]
}

/**
 * Everything a reader needs before completing, recompleting, or deciding to reopen.
 *
 * Read-only and side-effect free by construction: it opens no transaction, writes no audit row and
 * changes no state. Opening a completed record in Creator must cost nothing, and this is the query
 * that page runs.
 */
export async function completionReview(kind: CorrectionKind, id: number): Promise<CompletionReview | null> {
  if (kind === 'tournament') return tournamentReview(id)
  return seasonReview(id)
}

async function seasonReview(id: number): Promise<CompletionReview | null> {
  const s = await prisma.season.findUnique({
    where: { id },
    select: {
      id: true, number: true, competitionYear: true, subtitle: true, division: true,
      lifecycleState: true, ladderAppliedAt: true, reopenedAt: true, completedAt: true,
      dataCompleteness: true, entrantsCount: true, playoffDoubleElim: true,
      championName: true, championHandle: true, runnerUpName: true, runnerUpHandle: true,
      finalScore: true,
      competitionSeries: { select: { name: true } },
      _count: { select: { groups: true, playoffMatches: true, ratingLedger: true } },
    },
  })
  if (!s) return null

  const summary = await seasonCloseSummary(id).catch(() => null)
  const champ = await seasonChampion(id).catch(() => null)

  const errors: string[] = []
  const warnings: string[] = []

  // The champion is what a completion asserts, so its absence is the one blocking error.
  const championName = champ?.championName ?? s.championName ?? null
  if (!championName) {
    errors.push('No champion — the playoff bracket has not produced one, so there is nothing to complete.')
  }
  if (summary && !summary.canClose) {
    errors.push('The Season cannot be completed in its current state — the close summary reports it is not ready.')
  }
  if (s.dataCompleteness === 'partial') {
    warnings.push('Recorded as Partial Historical Data. Only verified results will count towards the Rankings; the gaps stay gaps.')
  }
  if (summary && summary.forfeits > 0) {
    warnings.push(`${summary.forfeits} forfeit(s) count as matches played but contribute no games and move no rating.`)
  }
  if (summary && summary.noContestGroupMatches > 0) {
    warnings.push(`${summary.noContestGroupMatches} match(es) recorded as no contest. They are excluded from the Rankings entirely.`)
  }
  if (summary && summary.kickedOut > 0) {
    warnings.push(`${summary.kickedOut} entrant(s) were removed from the Season.`)
  }

  const eligible = summary?.rankingEligibleMatches ?? 0
  // Deliberately EXCLUDED, and countable: a no-contest never happened, a forfeit is an official
  // result with no frames, and a kicked-out entrant's matches are voided. None of them feed a
  // rating, and the operator should see how many before confirming.
  const excluded = (summary?.noContestGroupMatches ?? 0) + (summary?.forfeits ?? 0)

  return {
    kind: 'season',
    id: s.id,
    title: s.subtitle?.trim() || `${s.competitionSeries?.name ?? 'Season'} Season ${s.number}`,
    competition: s.competitionSeries?.name ?? 'Competition',
    year: s.competitionYear,
    number: s.number,
    division: s.division,
    format: s._count.groups > 0 && s._count.playoffMatches > 0
      ? (s.playoffDoubleElim ? 'Groups → Double elimination' : 'Groups → Playoffs')
      : s._count.groups > 0 ? 'Groups only' : 'Bracket only',
    entrants: s.entrantsCount,
    champion: championName,
    runnerUp: champ?.runnerUpName ?? s.runnerUpHandle ?? s.runnerUpName ?? null,
    finalScore: champ?.finalScore ?? s.finalScore ?? null,
    eligibleMatches: eligible,
    excludedMatches: excluded,
    award: 'SC',
    completeness: s.dataCompleteness === 'partial' ? 'partial' : 'full',
    completedAt: s.completedAt?.toISOString() ?? null,
    finalisedAt: s.ladderAppliedAt?.toISOString() ?? null,
    reopenedAt: s.reopenedAt?.toISOString() ?? null,
    ledgerRows: s._count.ratingLedger,
    errors,
    warnings,
  }
}

async function tournamentReview(id: number): Promise<CompletionReview | null> {
  const t = await prisma.tournament.findUnique({
    where: { id },
    select: {
      id: true, name: true, number: true, competitionYear: true, lifecycleState: true, status: true,
      archivedAt: true, ladderAppliedAt: true, reopenedAt: true, dataCompleteness: true,
      entrantsCount: true, formatSummary: true, championHandle: true, championName: true,
      runnerUpHandle: true, runnerUpName: true, finalScore: true,
      _count: { select: { ratingLedger: true } },
    },
  })
  if (!t) return null

  const errors: string[] = []
  const champion = t.championHandle ?? t.championName ?? null
  if (!champion) errors.push('No champion recorded, so there is nothing to complete.')

  return {
    kind: 'tournament',
    id: t.id,
    title: t.name,
    competition: 'Cup',
    year: t.competitionYear,
    number: null,
    division: null,
    format: t.formatSummary,
    entrants: t.entrantsCount ?? 0,
    champion,
    runnerUp: t.runnerUpHandle ?? t.runnerUpName ?? null,
    finalScore: t.finalScore ?? null,
    eligibleMatches: t._count.ratingLedger,
    excludedMatches: 0,
    award: 'TC',
    completeness: t.dataCompleteness === 'partial' ? 'partial' : 'full',
    completedAt: t.archivedAt?.toISOString() ?? null,
    finalisedAt: t.ladderAppliedAt?.toISOString() ?? null,
    reopenedAt: t.reopenedAt?.toISOString() ?? null,
    ledgerRows: t._count.ratingLedger,
    errors,
    warnings: t.dataCompleteness === 'partial'
      ? ['Recorded as Partial Historical Data. Only verified results count towards the Rankings.']
      : [],
  }
}

// ── Reopen ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Take a completed record out of the record so it can be corrected.
 *
 * Nothing is deleted. The Season keeps its entrants, groups, results, standings, bracket topology,
 * placements, champion, dates, description and audit history; what changes is its lifecycle, a
 * `reopenedAt` stamp, and — as a consequence of those — whether the replay counts it.
 *
 * Idempotent: a second call while already reopened returns `alreadyDone` rather than reopening
 * again, so a double-submitted form or a retried request cannot compound.
 */
export async function reopenForCorrection(
  actor: Actor,
  kind: CorrectionKind,
  id: number,
  reason?: string,
): Promise<CorrectionResult> {
  if (kind === 'tournament') return reopenTournament(actor, id, reason)

  const s = await prisma.season.findUnique({
    where: { id },
    select: { lifecycleState: true, ladderAppliedAt: true, reopenedAt: true, _count: { select: { playoffMatches: true } } },
  })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.reopenedAt) return { ok: true, alreadyDone: true }
  if (s.lifecycleState !== 'COMPLETED') {
    return { ok: false, error: 'Only a completed Season can be reopened for corrections.' }
  }
  if (!s.ladderAppliedAt) {
    return {
      ok: false,
      error: 'This Season was never finalised into the Rankings, so there is nothing to withdraw. Complete it instead.',
    }
  }

  // Back to the phase whose results are being corrected. A Season with a bracket returns to live
  // playoffs; a groups-only Season returns to its closed group stage.
  const target = s._count.playoffMatches > 0 ? 'PLAYOFFS_LIVE' as const : 'GROUPS_CLOSED' as const

  await prisma.$transaction(async (tx) => {
    // Re-read INSIDE the transaction. Between the check above and here another request could have
    // reopened it, and a second reopen would write a second audit row for one event.
    const fresh = await tx.season.findUnique({ where: { id }, select: { lifecycleState: true, reopenedAt: true } })
    if (!fresh || fresh.reopenedAt || fresh.lifecycleState !== 'COMPLETED') {
      throw new AlreadyDone()
    }

    await tx.season.update({ where: { id }, data: { reopenedAt: new Date() } })

    await recordAudit(actor, {
      action: 'season.reopen_for_correction',
      entity: 'Season',
      entityId: id,
      oldValue: { state: 'COMPLETED', archived: true, contributesToRankings: true },
      newValue: { state: target, archived: false, contributesToRankings: false },
      reason,
    }, tx)

    // Withdraws the contribution: the replay selects only still-COMPLETED competitions.
    const t = await transitionSeasonState(actor, id, target, { tx, reason })
    if (!t.ok) throw new Error(t.error)
  }).catch((e) => {
    if (e instanceof AlreadyDone) return
    throw e
  })

  invalidate(id, 'season')
  return { ok: true }
}

async function reopenTournament(actor: Actor, id: number, reason?: string): Promise<CorrectionResult> {
  const t = await prisma.tournament.findUnique({
    where: { id },
    select: { lifecycleState: true, archivedAt: true, reopenedAt: true },
  })
  if (!t) return { ok: false, error: 'Cup not found.' }
  if (t.reopenedAt) return { ok: true, alreadyDone: true }
  if (String(t.lifecycleState) !== 'COMPLETED') {
    return { ok: false, error: 'Only a completed Cup can be reopened for corrections.' }
  }

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.tournament.findUnique({ where: { id }, select: { lifecycleState: true, reopenedAt: true } })
    if (!fresh || fresh.reopenedAt || String(fresh.lifecycleState) !== 'COMPLETED') throw new AlreadyDone()

    await tx.tournament.update({
      where: { id },
      data: { reopenedAt: new Date(), lifecycleState: 'IN_PROGRESS' },
    })
    await recordAudit(actor, {
      action: 'tournament.reopen_for_correction',
      entity: 'Cup',
      entityId: id,
      oldValue: { state: 'COMPLETED', archived: true, contributesToRankings: true },
      newValue: { state: 'IN_PROGRESS', archived: false, contributesToRankings: false },
      reason,
    }, tx)
    const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
    await rebuildRatingLedger(tx)
  }).catch((e) => {
    if (e instanceof AlreadyDone) return
    throw e
  })

  invalidate(id, 'tournament')
  return { ok: true }
}

// ── Recomplete ───────────────────────────────────────────────────────────────────────────────────

/**
 * Put a corrected record back into the record.
 *
 * Uses the SAME replay as the original completion, so the corrected contribution is applied by
 * exactly the mechanism that applied the original one — there is no second completion path that
 * could drift from the first.
 *
 * The finalisation stamp is PRESERVED rather than reissued. The replay orders its timeline by that
 * stamp, so reissuing it would move the Season to the end of history and silently re-rate everyone
 * who played after it. A correction changes the corrected Season; it does not reorder the past.
 */
export async function recomplete(
  actor: Actor,
  kind: CorrectionKind,
  id: number,
  reason?: string,
): Promise<CorrectionResult> {
  const review = await completionReview(kind, id)
  if (!review) return { ok: false, error: `${kind === 'season' ? 'Season' : 'Cup'} not found.` }
  if (!review.reopenedAt) return { ok: true, alreadyDone: true }
  if (review.errors.length > 0) {
    return { ok: false, error: review.errors.join(' ') }
  }

  if (kind === 'tournament') {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.tournament.findUnique({ where: { id }, select: { reopenedAt: true } })
      if (!fresh?.reopenedAt) throw new AlreadyDone()
      await tx.tournament.update({
        where: { id },
        data: { reopenedAt: null, lifecycleState: 'COMPLETED', archivedAt: new Date() },
      })
      await recordAudit(actor, {
        action: 'tournament.recomplete', entity: 'Cup', entityId: id,
        oldValue: { state: 'IN_PROGRESS', archived: false },
        newValue: { state: 'COMPLETED', archived: true, champion: review.champion, eligibleMatches: review.eligibleMatches },
        reason,
      }, tx)
      const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
      await rebuildRatingLedger(tx)
    }).catch((e) => { if (!(e instanceof AlreadyDone)) throw e })
    invalidate(id, 'tournament')
    return { ok: true }
  }

  const champ = await seasonChampion(id)
  if (!champ) return { ok: false, error: 'The playoff bracket does not produce a champion.' }
  const champEnt = await prisma.seasonEntrant.findUnique({
    where: { id: champ.championId }, select: { playerId: true, cueverseId: true },
  })

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.season.findUnique({
      where: { id }, select: { reopenedAt: true, ladderAppliedAt: true, lifecycleState: true },
    })
    if (!fresh?.reopenedAt) throw new AlreadyDone()

    await tx.season.update({
      where: { id },
      data: {
        championName: champ.championName,
        championHandle: champEnt?.cueverseId ?? null,
        championPlayerId: champEnt?.playerId ?? null,
        runnerUpName: champ.runnerUpName,
        finalScore: champ.finalScore,
        // Preserved, never reissued — see the note above.
        ladderAppliedAt: fresh.ladderAppliedAt ?? new Date(),
        reopenedAt: null,
      },
    })

    await recordAudit(actor, {
      action: 'season.recomplete',
      entity: 'Season',
      entityId: id,
      oldValue: { state: fresh.lifecycleState, archived: false, contributesToRankings: false },
      newValue: {
        state: 'COMPLETED', archived: true, contributesToRankings: true,
        champion: champ.championName, runnerUp: champ.runnerUpName,
        finalScore: champ.finalScore, eligibleMatches: review.eligibleMatches,
      },
      reason,
    }, tx)

    const t = await transitionSeasonState(actor, id, 'COMPLETED', { tx, reason })
    if (!t.ok) throw new Error(t.error)

    // Reapplies the corrected contribution — the same replay the original completion ran.
    const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
    await rebuildRatingLedger(tx)
  }).catch((e) => { if (!(e instanceof AlreadyDone)) throw e })

  invalidate(id, 'season')
  return { ok: true }
}

// ── Plumbing ─────────────────────────────────────────────────────────────────────────────────────

/** Thrown inside a transaction when a concurrent request already did the work. Not an error. */
class AlreadyDone extends Error {}

/**
 * Refresh what a reader could be looking at.
 *
 * The listings are the surfaces that change: the record joins or leaves Archives, and the Rankings
 * gain or lose its results. The Creator pages are `force-dynamic` and need no help.
 */
function invalidate(id: number, kind: CorrectionKind) {
  // Wrapped because this service is also callable outside a request — from a script, a fixture, or
  // a data repair. `revalidatePath` needs Next's request store and throws without it, and a cache
  // hint failing must never fail the correction it is a hint about. The correction is already
  // committed by the time this runs.
  try {
    revalidatePath('/seasons')
    revalidatePath('/cups')
    revalidatePath('/creator')
    // The Rankings need their cached AGGREGATE dropped, not just the page re-rendered — see
    // invalidateRankings. Revalidating the path alone re-reads the same stale rows.
    invalidateRankings()
    revalidatePath(kind === 'season' ? `/seasons/${id}` : `/cups/${id}`)
  } catch {
    // Not in a request. Nothing is cached here, so there is nothing to invalidate.
  }
}
