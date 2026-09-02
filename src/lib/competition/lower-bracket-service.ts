import 'server-only'

/**
 * Persisting a lower-bracket routing edit.
 *
 * The decisions all live in `lower-bracket-edit.ts`, which is pure. This module reads the bracket,
 * asks that engine what a proposed edit would do, and writes the answer — once, atomically, with an
 * audit entry in the same transaction.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────────────────────────
 * It does not regenerate the bracket, clear a score, reopen a match, recompute a winner or touch the
 * rating ledger. A routing edit changes where players GO; every result already recorded stays
 * exactly as it was, and that is re-checked against the stored rows inside the transaction rather
 * than assumed from the engine's answer.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { recordAudit } from './audit'
import { assertCompetitionUnlocked } from './service'
import {
  deadLowerMatches, isLocked, lowerBracketView, matchName, strandedLowerSlots, swapLowerSlots,
  type LowerRoundView, type RoutableMatch, type SlotRef, type StrandedSlot,
} from './lower-bracket-edit'

export interface Actor { userId: number; username: string }

/** Columns the engine needs, and nothing else. */
const ROUTE_SELECT = {
  id: true, section: true, round: true, slot: true, label: true,
  homeRegistrationId: true, awayRegistrationId: true,
  homeUsername: true, awayUsername: true, homeSeed: true, awaySeed: true,
  homeGames: true, awayGames: true, status: true,
  winnerRegistrationId: true, forfeitRegistrationId: true,
  feedsMatchId: true, feedsSlot: true, loserFeedsMatchId: true, loserFeedsSlot: true,
} as const

async function readBracket(
  client: Prisma.TransactionClient | typeof prisma,
  tournamentId: number,
): Promise<RoutableMatch[]> {
  const rows = await client.playoffMatch.findMany({
    where: { tournamentId },
    select: ROUTE_SELECT,
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })
  return rows.map((r) => ({ ...r, status: String(r.status) }))
}

/** The losers bracket, ready to draw. */
export async function getLowerBracket(tournamentId: number): Promise<LowerRoundView[]> {
  return lowerBracketView(await readBracket(prisma, tournamentId))
}

/**
 * The WHOLE bracket, for the editor.
 *
 * More than the losers bracket, because a losers slot is described by the winners-bracket match
 * that feeds it — an editor holding only the LB rows could not name a single source, and could not
 * preview a swap without asking the server between every click.
 *
 * Returns an empty array for a bracket with no losers section, which is how a single-elimination
 * Tournament ends up rendering no editor at all rather than an empty one.
 */
export async function getRoutableBracket(tournamentId: number): Promise<RoutableMatch[]> {
  const all = await readBracket(prisma, tournamentId)
  return all.some((m) => m.section === 'LB') ? all : []
}

export type SwapPair = [SlotRef, SlotRef]

export interface SaveResult {
  ok: boolean
  error?: string
  /** How many matches had a field rewritten. */
  changed?: number
}

/**
 * Apply a list of same-round losers-bracket swaps in one transaction.
 *
 * Applied in order against a running copy, so a second swap sees the first one's result and the
 * whole list is validated as a single outcome rather than as independent edits that happen to be
 * legal alone. Any refusal aborts everything — a partially applied routing is a broken bracket.
 */
export async function saveLowerBracketRouting(
  actor: Actor,
  tournamentId: number,
  swaps: readonly SwapPair[],
  reason?: string,
): Promise<SaveResult> {
  if (swaps.length === 0) return { ok: true, changed: 0 }
  await assertCompetitionUnlocked(prisma, tournamentId)

  return prisma.$transaction(async (tx) => {
    const before = await readBracket(tx, tournamentId)
    if (before.length === 0) return { ok: false, error: 'This Tournament has no bracket.' }

    let working = before
    for (const [a, b] of swaps) {
      const step = swapLowerSlots(working, a, b)
      if (!step.ok) return { ok: false, error: step.error }
      working = step.preview
    }

    /*
      Re-derive the writes from before → after rather than concatenating each step's updates.

      Two swaps can touch the same field, and replaying a stale intermediate write would undo the
      later one. Comparing the two ends of the edit produces exactly the fields that actually differ.
    */
    const beforeById = new Map(before.map((m) => [m.id, m]))
    const writes: { id: number; data: Record<string, number | string | null> }[] = []
    for (const m of working) {
      const was = beforeById.get(m.id)
      if (!was) continue
      const data: Record<string, number | string | null> = {}
      const diff = <K extends keyof RoutableMatch>(k: K) => {
        if (m[k] !== was[k]) data[k as string] = m[k] as number | string | null
      }
      diff('feedsMatchId'); diff('feedsSlot')
      diff('loserFeedsMatchId'); diff('loserFeedsSlot')
      diff('homeRegistrationId'); diff('homeUsername'); diff('homeSeed')
      diff('awayRegistrationId'); diff('awayUsername'); diff('awaySeed')
      if (Object.keys(data).length > 0) writes.push({ id: m.id, data })
    }

    /*
      A last guard against the engine and the database disagreeing — on SEATS only.

      The engine was handed a snapshot; between that read and this write a result could have landed,
      so the rows about to be written are re-read here, inside the transaction.

      But only the ones whose PLAYERS are being moved. A completed match having its outgoing route
      changed is the entire point of this feature - "the loser of Winners R2 M1 now goes somewhere
      else" does not touch that match's result, its players or its score, and refusing it made the
      tool useless exactly where it was needed: every reroute of a played round was rejected with
      "Winners R2 M1 has a result now". Its own engine allows it, and this contradicted the engine.

      Writing a SEAT into a played match is a different thing entirely, and still refused.
    */
    const SEAT_COLUMNS = [
      'homeRegistrationId', 'homeUsername', 'homeSeed',
      'awayRegistrationId', 'awayUsername', 'awaySeed',
    ]
    const reseated = writes
      .filter((w) => Object.keys(w.data).some((k) => SEAT_COLUMNS.includes(k)))
      .map((w) => w.id)
    if (reseated.length > 0) {
      const nowLocked = (await tx.playoffMatch.findMany({
        where: { id: { in: reseated } },
        select: ROUTE_SELECT,
      })).map((r) => ({ ...r, status: String(r.status) })).filter(isLocked)
      if (nowLocked.length > 0) {
        return { ok: false, error: `${matchName(nowLocked[0])} has a result now, so the bracket was not changed.` }
      }
    }

    for (const w of writes) {
      await tx.playoffMatch.update({ where: { id: w.id }, data: w.data })
    }

    await recordAudit(actor, {
      action: 'tournament.playoff.lower_bracket_reroute',
      entity: 'tournament',
      entityId: tournamentId,
      oldValue: { routes: routeSnapshot(before) },
      newValue: { routes: routeSnapshot(working) },
      reason: reason ?? 'Lower bracket routing edited to match the original bracket',
    }, tx)

    return { ok: true, changed: writes.length }
  })
}

/** Just the routing, so an audit entry records the change and not the whole bracket. */
function routeSnapshot(ms: readonly RoutableMatch[]) {
  return ms
    .filter((m) => m.feedsMatchId != null || m.loserFeedsMatchId != null)
    .map((m) => ({
      match: matchName(m),
      id: m.id,
      winnerTo: m.feedsMatchId == null ? null : `${m.feedsMatchId}:${m.feedsSlot}`,
      loserTo: m.loserFeedsMatchId == null ? null : `${m.loserFeedsMatchId}:${m.loserFeedsSlot}`,
    }))
}

/**
 * Settle losers-bracket seats that are waiting on a loser that cannot exist.
 *
 * See `strandedLowerSlots` for how a bracket acquires one. The repair is the one the draw would
 * have made for itself had the byes been where they are now: mark the dead seat a Bye, and let the
 * waiting player walk over.
 *
 * ── Why it advances by hand rather than calling verifyPlayoffMatch ──────────────────────────────
 * A walkover has no result. `verifyPlayoffMatch` refuses a match with no winner recorded, and
 * recording a fabricated score to satisfy it would put a scoreline in the record for a match nobody
 * played. So the match is marked a walkover directly — no games, no forfeit, a winner and a
 * completion — and the winner is advanced through the SAME routing columns everything else uses.
 *
 * Idempotent: a seat already marked Bye, or a match already holding a result, is skipped. Running
 * it twice changes nothing the second time.
 */
export async function resolveStrandedLowerSlots(
  actor: Actor,
  tournamentId: number,
): Promise<{ ok: boolean; error?: string; settled: number; detail: string[] }> {
  await assertCompetitionUnlocked(prisma, tournamentId)

  return prisma.$transaction(async (tx) => {
    const detail: string[] = []

    /*
      Settling changes what else is settleable, so this runs to a fixed point.

      Recording a dead match marks the seat below it dead in turn, which usually turns THAT match
      into an ordinary walkover for whoever is waiting in its other seat - and settling that one can
      stand up the next. Each pass re-reads, so every pass reasons about what is actually stored
      rather than about a snapshot taken before its own writes.

      The bound is a backstop, not a limit: each pass settles at least one match and a bracket has
      finitely many, so it exists only so that a routing loop cannot spin here for ever.
    */
    for (let pass = 0; pass < 32; pass++) {
      const before = await readBracket(tx, tournamentId)
      const dead = deadLowerMatches(before)
      const stranded = strandedLowerSlots(before)
      if (dead.length === 0 && stranded.length === 0) break

      /*
        A match nobody can reach is recorded as played by nobody.

        No winner, because there is no winner: fabricating one would put a player into the next
        round who never won anything. What passes down instead is the emptiness itself - the seat
        below is marked a Bye - which is exactly what the draw would have contained had the byes
        been known when it was laid out.
      */
      for (const d of dead) {
        const live = await tx.playoffMatch.findUniqueOrThrow({ where: { id: d.matchId }, select: ROUTE_SELECT })
        if (isLocked({ ...live, status: String(live.status) })) continue

        await tx.playoffMatch.update({
          where: { id: d.matchId },
          data: {
            homeRegistrationId: null, homeUsername: 'Bye', homeSeed: null,
            awayRegistrationId: null, awayUsername: 'Bye', awaySeed: null,
            status: 'COMPLETED',
            winnerRegistrationId: null,
            completedAt: new Date(),
          },
        })

        const m = before.find((x) => x.id === d.matchId)!
        if (m.feedsMatchId != null && m.feedsSlot != null) {
          const down = await tx.playoffMatch.findUnique({ where: { id: m.feedsMatchId }, select: ROUTE_SELECT })
          if (down && isLocked({ ...down, status: String(down.status) })) {
            detail.push(`${matchName(m)}: recorded as unplayable, but ${matchName({ ...down, status: String(down.status) })} already has a result — the seat below was left alone.`)
          } else {
            const seat = m.feedsSlot === 0
              ? { homeRegistrationId: null, homeUsername: 'Bye', homeSeed: null }
              : { awayRegistrationId: null, awayUsername: 'Bye', awaySeed: null }
            await tx.playoffMatch.update({ where: { id: m.feedsMatchId }, data: seat })
          }
        }
        detail.push(`${matchName(m)}: ${d.reason}`)
      }

      if (stranded.length === 0) continue
      await settlePass(tx, before, stranded, detail)
    }

    if (detail.length === 0) return { ok: true, settled: 0, detail: [] }
    await recordAudit(actor, {
      action: 'tournament.playoff.resolve_walkovers',
      entity: 'tournament',
      entityId: tournamentId,
      newValue: { settled: detail.length, matches: detail },
      reason: 'Losers-bracket seats that no player can reach settled as byes',
    }, tx)

    return { ok: true, settled: detail.length, detail }
  })
}

/** One pass of walking waiting players over. Split out so the loop above can repeat it. */
async function settlePass(
  tx: Prisma.TransactionClient,
  before: readonly RoutableMatch[],
  stranded: readonly StrandedSlot[],
  detail: string[],
): Promise<void> {
    for (const s of stranded) {
      const m = before.find((x) => x.id === s.matchId)!
      // Re-checked inside the transaction: a result may have landed since the read above.
      const live = await tx.playoffMatch.findUniqueOrThrow({ where: { id: s.matchId }, select: ROUTE_SELECT })
      if (isLocked({ ...live, status: String(live.status) })) continue

      const byeSeat = s.emptySlot === 0
        ? { homeRegistrationId: null, homeUsername: 'Bye', homeSeed: null }
        : { awayRegistrationId: null, awayUsername: 'Bye', awaySeed: null }

      await tx.playoffMatch.update({
        where: { id: s.matchId },
        data: {
          ...byeSeat,
          status: 'COMPLETED',
          winnerRegistrationId: s.waiting.registrationId,
          completedAt: new Date(),
        },
      })

      /*
        Advance the walkover winner exactly where this match's own routing sends its winner - but
        never into a match that has already been played.

        Results are being entered by hand while this runs. Seating somebody into a match that
        already holds a score would rewrite a played match, which is the one thing no repair is
        allowed to do; if the downstream seat is already settled the walkover is recorded and the
        advancement is left alone for a human to look at.
      */
      if (m.feedsMatchId != null && m.feedsSlot != null) {
        const down = await tx.playoffMatch.findUnique({ where: { id: m.feedsMatchId }, select: ROUTE_SELECT })
        if (down && isLocked({ ...down, status: String(down.status) })) {
          detail.push(`${matchName(m)}: walkover recorded, but ${matchName({ ...down, status: String(down.status) })} already has a result — advancement left for review.`)
          continue
        }
        const seat = m.feedsSlot === 0
          ? { homeRegistrationId: s.waiting.registrationId, homeUsername: s.waiting.username, homeSeed: s.waiting.seed }
          : { awayRegistrationId: s.waiting.registrationId, awayUsername: s.waiting.username, awaySeed: s.waiting.seed }
        await tx.playoffMatch.update({ where: { id: m.feedsMatchId }, data: seat })
      }

      detail.push(`${matchName(m)}: ${s.waiting.username ?? 'player'} advances — ${s.reason}`)
    }
}
