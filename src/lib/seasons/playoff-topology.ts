import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

/**
 * Which bracket positions a person may fill, and which the bracket fills for them.
 *
 * ── Read the graph, never the round number ───────────────────────────────────────────────────────
 * "Round 1 is editable" is true for a single-elimination bracket and wrong for everything else. A
 * double-elimination losers' bracket takes entrants in later rounds, a grand final takes none at
 * all, and a hand-built historical bracket may seat somebody anywhere. So the rule is structural:
 * a position that some match FEEDS is decided by play; a position nothing feeds is where players
 * enter, whatever round it happens to sit in.
 *
 * This matters because directly assigning a fed position is not a harmless mistake. The slot is
 * overwritten the moment its feeder resolves, so the placement silently disappears — and in the
 * meantime the bracket shows a player in a tie they never qualified for.
 *
 * ── Ported, not copied ───────────────────────────────────────────────────────────────────────────
 * The classification comes from the shelved `manual-playoff-placement` work, which got this part
 * right. What came with it there — a separate placement state machine and its own start check — did
 * not survive: readiness now answers the conditions the current Creator workflow actually gates on,
 * and reads the same seeding service everything else does.
 */

export type Side = 'home' | 'away'

export const slotKey = (matchId: number, side: Side) => `${matchId}:${side}`

/** `feedsSlot` is 0 for the home side and 1 for the away side — see `placeInto` in playoffs.ts. */
const sideOfFeedSlot = (n: number | null): Side => (n === 1 ? 'away' : 'home')

export interface EntrySlot {
  matchId: number
  side: Side
  section: string | null
  round: number
  slot: number
  label: string | null
  entrantId: number | null
  entrantName: string | null
  seed: number | null
}

export interface DerivedSlot {
  matchId: number
  side: Side
  /** The match whose result fills this position. */
  sourceMatchId: number
  sourceKind: 'winner' | 'loser'
}

export interface BracketTopology {
  entrySlots: EntrySlot[]
  derived: DerivedSlot[]
  /** Fast membership test over `${matchId}:${side}`. */
  entryKeys: Set<string>
  /** Total matches, so a caller can tell "no bracket" from "no entry slots". */
  matches: number
}

type Db = Prisma.TransactionClient | typeof prisma

/** One query, then pure graph work. Safe inside a transaction, which is where Start re-reads it. */
export async function bracketTopology(seasonId: number, db: Db = prisma): Promise<BracketTopology> {
  const matches = await db.seasonPlayoffMatch.findMany({
    where: { seasonId },
    select: {
      id: true, section: true, round: true, slot: true, label: true,
      homeEntrantId: true, awayEntrantId: true,
      homeUsername: true, awayUsername: true,
      homeSeed: true, awaySeed: true,
      feedsMatchId: true, feedsSlot: true,
      loserFeedsMatchId: true, loserFeedsSlot: true,
    },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })

  const derived: DerivedSlot[] = []
  const derivedKeys = new Set<string>()
  for (const m of matches) {
    if (m.feedsMatchId != null) {
      const side = sideOfFeedSlot(m.feedsSlot)
      derived.push({ matchId: m.feedsMatchId, side, sourceMatchId: m.id, sourceKind: 'winner' })
      derivedKeys.add(slotKey(m.feedsMatchId, side))
    }
    if (m.loserFeedsMatchId != null) {
      const side = sideOfFeedSlot(m.loserFeedsSlot)
      derived.push({ matchId: m.loserFeedsMatchId, side, sourceMatchId: m.id, sourceKind: 'loser' })
      derivedKeys.add(slotKey(m.loserFeedsMatchId, side))
    }
  }

  const entrySlots: EntrySlot[] = []
  const entryKeys = new Set<string>()
  for (const m of matches) {
    for (const side of ['home', 'away'] as const) {
      const key = slotKey(m.id, side)
      if (derivedKeys.has(key)) continue
      entryKeys.add(key)
      entrySlots.push({
        matchId: m.id, side,
        section: m.section, round: m.round, slot: m.slot, label: m.label,
        entrantId: side === 'home' ? m.homeEntrantId : m.awayEntrantId,
        entrantName: side === 'home' ? m.homeUsername : m.awayUsername,
        seed: side === 'home' ? m.homeSeed : m.awaySeed,
      })
    }
  }

  return { entrySlots, derived, entryKeys, matches: matches.length }
}

/** Whether this position may be filled by hand. */
export async function isEntrySlot(seasonId: number, matchId: number, side: Side, db: Db = prisma): Promise<boolean> {
  return (await bracketTopology(seasonId, db)).entryKeys.has(slotKey(matchId, side))
}

/**
 * Every reason Start Playoffs is not ready, at once.
 *
 * ── Every reason, not the first one ──────────────────────────────────────────────────────────────
 * Returning as soon as something is wrong means fixing one problem to be told about the next, which
 * for a forty-player bracket is a long afternoon. The list is complete so the whole repair can be
 * planned from one reading.
 *
 * ── Recomputed inside the transaction ────────────────────────────────────────────────────────────
 * The client calls this to explain itself, and `startSeasonPlayoffs` calls it again with the
 * transaction's own client before it publishes anything. Nothing about the first answer is trusted:
 * between the page rendering and the button being pressed, another administrator may have changed
 * the selection, and the check that matters is the one holding the lock.
 */
export interface StartReadiness {
  ok: boolean
  /** Human-readable, one per unmet condition. Empty when ready. */
  problems: string[]
  included: number
  placed: number
  unplaced: number
  /** Entry slots with nobody in them — byes, once the playoffs start. */
  byes: number
  entrySlots: number
  doubleElim: boolean
}

export async function startReadiness(seasonId: number, db: Db = prisma): Promise<StartReadiness> {
  const [season, topology, entrants] = await Promise.all([
    db.season.findUnique({ where: { id: seasonId }, select: { playoffDoubleElim: true } }),
    bracketTopology(seasonId, db),
    db.seasonEntrant.findMany({
      where: { seasonId },
      select: { id: true, displayName: true, username: true, playoffIncluded: true, kickedOut: true },
    }),
  ])

  const problems: string[] = []
  const nameOf = (id: number) => {
    const e = entrants.find((x) => x.id === id)
    return e ? (e.displayName?.trim() || e.username) : `entrant ${id}`
  }

  const included = entrants.filter((e) => e.playoffIncluded && !e.kickedOut)
  const includedIds = new Set(included.map((e) => e.id))

  if (topology.matches === 0) {
    problems.push('No bracket has been generated yet.')
  }
  if (included.length < 2) {
    problems.push('Select at least two participants.')
  }

  // Where everybody actually sits, counted across ENTRY slots only: an occupant of a fed slot is a
  // different fault, reported separately below.
  const placements = new Map<number, number>()
  for (const s of topology.entrySlots) {
    if (s.entrantId != null) placements.set(s.entrantId, (placements.get(s.entrantId) ?? 0) + 1)
  }

  const duplicates = [...placements.entries()].filter(([, n]) => n > 1).map(([id]) => nameOf(id))
  if (duplicates.length) {
    problems.push(`Placed in more than one position: ${duplicates.join(', ')}.`)
  }

  const unplaced = included.filter((e) => !placements.has(e.id))
  if (unplaced.length) {
    problems.push(
      `${unplaced.length} selected participant${unplaced.length === 1 ? ' has' : 's have'} no bracket position: `
      + `${unplaced.slice(0, 5).map((e) => e.displayName?.trim() || e.username).join(', ')}`
      + `${unplaced.length > 5 ? `, and ${unplaced.length - 5} more` : ''}.`,
    )
  }

  const strangers = [...placements.keys()].filter((id) => !includedIds.has(id))
  if (strangers.length) {
    problems.push(`In the bracket but not selected: ${strangers.map(nameOf).join(', ')}.`)
  }

  /*
   * A player sitting in a position the bracket fills for them.
   *
   * Nothing in Creator can produce this — `setSeasonBracketSlot` refuses a fed slot — but an import,
   * a hand-edited row, or a bracket regenerated around existing data can. Publishing it would show a
   * player in a tie they never qualified for, until the feeder resolved and overwrote them.
   */
  const derivedOccupied: string[] = []
  const byId = new Map<number, { homeEntrantId: number | null; awayEntrantId: number | null }>()
  for (const s of topology.entrySlots) byId.set(s.matchId, byId.get(s.matchId) ?? { homeEntrantId: null, awayEntrantId: null })
  const rows = await db.seasonPlayoffMatch.findMany({
    where: { seasonId },
    select: { id: true, label: true, homeEntrantId: true, awayEntrantId: true },
  })
  for (const r of rows) {
    for (const side of ['home', 'away'] as const) {
      if (topology.entryKeys.has(slotKey(r.id, side))) continue
      const occupant = side === 'home' ? r.homeEntrantId : r.awayEntrantId
      if (occupant != null) derivedOccupied.push(`${nameOf(occupant)} in ${r.label ?? `match ${r.id}`}`)
    }
  }
  if (derivedOccupied.length) {
    problems.push(`Placed into a position decided by play: ${derivedOccupied.join(', ')}.`)
  }

  const placed = [...placements.keys()].filter((id) => includedIds.has(id)).length
  const byes = topology.entrySlots.filter((s) => s.entrantId == null).length

  /*
   * The bracket must be big enough, and not so big it is mostly empty.
   *
   * Entry slots below the field means somebody cannot be seated at all. More than double means the
   * generated size no longer matches the selection — usually because participants were unticked
   * after generating — and half the bracket would be a walkover.
   */
  if (topology.matches > 0 && included.length >= 2) {
    if (topology.entrySlots.length < included.length) {
      problems.push(
        `The bracket has ${topology.entrySlots.length} entry positions for ${included.length} participants. `
        + 'Regenerate it at a larger size.',
      )
    } else if (topology.entrySlots.length >= included.length * 2) {
      problems.push(
        `The bracket has ${topology.entrySlots.length} entry positions for only ${included.length} participants. `
        + 'Regenerate it to match the selection.',
      )
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    included: included.length,
    placed,
    unplaced: unplaced.length,
    byes,
    entrySlots: topology.entrySlots.length,
    doubleElim: !!season?.playoffDoubleElim,
  }
}

/** The bracket sizes offered. Anything else is a typo, not a preference. */
export const BRACKET_SIZES = [2, 4, 8, 16, 32, 64, 128] as const
export type BracketSize = (typeof BRACKET_SIZES)[number]

/** The smallest offered size that seats everybody. */
export function smallestBracketFor(players: number): BracketSize | null {
  return BRACKET_SIZES.find((s) => s >= players) ?? null
}
