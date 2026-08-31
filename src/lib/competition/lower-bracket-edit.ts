/**
 * Editing the LOWER bracket's feed routes on a published double-elimination bracket.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────────────────────
 * Challonge and 8BR both build a legal double-elimination bracket, and they disagree about which
 * losers-bracket slot a given dropper lands in. Neither is wrong; they are two conventions. When a
 * Tournament was originally played on Challonge, reproducing it here means bending 8BR's routing to
 * match — by hand, on a bracket that is already part-played, without disturbing a single result.
 *
 * ── What is actually edited ─────────────────────────────────────────────────────────────────────
 * Not the displayed names. A match stores where its winner and its loser GO:
 *
 *     feedsMatchId / feedsSlot            the winner's destination
 *     loserFeedsMatchId / loserFeedsSlot  the loser's destination  (double-elim only)
 *
 * so a losers-bracket slot has no pointer of its own — it is described by whichever match points AT
 * it. Editing a slot therefore means rewriting an UPSTREAM match's route, which is what makes the
 * change stick for players who have not arrived yet: `verifyPlayoffMatch` reads these columns at the
 * moment a result is confirmed, so a future winner advances by the routing saved here.
 *
 * Swapping two slots swaps the two routes pointing at them, and carries the seated player across
 * with the route. A player already sitting in a slot got there because an upstream match finished;
 * moving the route without moving the player would leave them contradicting their own source.
 *
 * ── What is refused ─────────────────────────────────────────────────────────────────────────────
 * Everything that could change something that already happened. A match with a result is LOCKED:
 * its players, score, winner, round and slots are immovable, and no route may be redirected INTO or
 * OUT OF a locked match, because either would rewrite a match that has been played.
 *
 * A completed match may still be redirected AS A SOURCE — its result does not change, only where
 * the person it produced goes next, and only when that destination has not been played.
 *
 * This module is pure. It reads a bracket, answers questions about it, and returns the updates a
 * caller should write; it performs no IO and decides nothing about permissions.
 */

/** The columns this engine reads. A superset of what `PlayoffMatch` exposes to the UI. */
export interface RoutableMatch {
  id: number
  section: string | null
  round: number
  slot: number
  label: string | null
  homeRegistrationId: number | null
  awayRegistrationId: number | null
  homeUsername: string | null
  awayUsername: string | null
  homeSeed: number | null
  awaySeed: number | null
  homeGames: number | null
  awayGames: number | null
  status: string
  winnerRegistrationId: number | null
  forfeitRegistrationId: number | null
  feedsMatchId: number | null
  feedsSlot: number | null
  loserFeedsMatchId: number | null
  loserFeedsSlot: number | null
}

/** Which of a source match's two outputs a route carries. */
export type FeedKind = 'WINNER' | 'LOSER'

/** One side of one match: slot 0 is home, slot 1 is away. */
export interface SlotRef { matchId: number; slot: number }

/** A route: the winner or loser of `sourceMatchId` goes somewhere. */
export interface FeedRef { sourceMatchId: number; kind: FeedKind }

/** A player sitting in a slot, or an empty slot. */
export interface Occupant {
  registrationId: number | null
  username: string | null
  seed: number | null
}

/** One editable slot, as the editor draws it. */
export interface LowerSlotView {
  matchId: number
  slot: number
  /** "Loser of Winners R2 M3", or null when nothing feeds this slot. */
  sourceLabel: string | null
  source: FeedRef | null
  occupant: Occupant
  /** Whether this slot may take part in a swap, and if not, why. */
  editable: boolean
  reason: string | null
}

/** One losers-bracket match, as the editor draws it. */
export interface LowerMatchView {
  matchId: number
  round: number
  slot: number
  label: string
  locked: boolean
  slots: [LowerSlotView, LowerSlotView]
}

export interface LowerRoundView {
  round: number
  matches: LowerMatchView[]
}

/** A single field write the caller should persist. */
export interface RouteUpdate {
  matchId: number
  data: Record<string, number | string | null>
}

export type EditResult =
  | { ok: true; updates: RouteUpdate[]; preview: RoutableMatch[] }
  | { ok: false; error: string }

export const LOWER = 'LB'
const WINNERS = 'WB'

/*
  A match is locked once it holds a result of any kind.

  Deliberately broad. The brief's rule is "a saved score or forfeit result", and the four non-
  SCHEDULED states all mean something was decided — but a result can also be present with the status
  left behind, so the result columns are checked directly rather than trusted to agree with it. This
  guard only ever refuses edits, so the conservative direction is the safe one: a match wrongly
  treated as locked costs the Owner an edit they must make another way, while one wrongly treated as
  open silently rewrites a played match.
*/
export function isLocked(m: RoutableMatch): boolean {
  return m.status !== 'SCHEDULED'
    || m.winnerRegistrationId !== null
    || m.forfeitRegistrationId !== null
    || m.homeGames !== null
    || m.awayGames !== null
}

const sectionName = (s: string | null): string =>
  s === WINNERS ? 'Winners' : s === LOWER ? 'Losers' : s === 'GF' ? 'Grand Final' : 'Bracket'

/** "Winners R2 M3" — a match named the way a bracket reader would point at it. */
export function matchName(m: RoutableMatch): string {
  if (m.section === 'GF') return 'Grand Final'
  return `${sectionName(m.section)} R${m.round} M${m.slot + 1}`
}

/** "Loser of Winners R2 M3" — where the player arriving in a slot comes from. */
export function sourceLabel(source: RoutableMatch, kind: FeedKind): string {
  return `${kind === 'WINNER' ? 'Winner' : 'Loser'} of ${matchName(source)}`
}

/**
 * Every route in the bracket, keyed by the slot it points at.
 *
 * Built by inverting the forward pointers, because a slot cannot name its own source. A slot with
 * two routes into it is a corrupt bracket rather than an ambiguity, so the map keeps the first and
 * `findDuplicateTargets` reports the rest.
 */
export function routesByTarget(matches: readonly RoutableMatch[]): Map<string, FeedRef> {
  const out = new Map<string, FeedRef>()
  for (const m of matches) {
    if (m.feedsMatchId != null && m.feedsSlot != null) {
      const k = slotKey({ matchId: m.feedsMatchId, slot: m.feedsSlot })
      if (!out.has(k)) out.set(k, { sourceMatchId: m.id, kind: 'WINNER' })
    }
    if (m.loserFeedsMatchId != null && m.loserFeedsSlot != null) {
      const k = slotKey({ matchId: m.loserFeedsMatchId, slot: m.loserFeedsSlot })
      if (!out.has(k)) out.set(k, { sourceMatchId: m.id, kind: 'LOSER' })
    }
  }
  return out
}

export const slotKey = (r: SlotRef): string => `${r.matchId}:${r.slot}`

const occupantOf = (m: RoutableMatch, slot: number): Occupant => (slot === 0
  ? { registrationId: m.homeRegistrationId, username: m.homeUsername, seed: m.homeSeed }
  : { registrationId: m.awayRegistrationId, username: m.awayUsername, seed: m.awaySeed })

const seatData = (slot: number, o: Occupant): Record<string, number | string | null> => (slot === 0
  ? { homeRegistrationId: o.registrationId, homeUsername: o.username, homeSeed: o.seed }
  : { awayRegistrationId: o.registrationId, awayUsername: o.username, awaySeed: o.seed })

/**
 * The losers bracket as the editor draws it: rounds, matches, and where each slot's player comes
 * from. Winners-bracket and grand-final matches are read (they are sources) but never listed here,
 * because they are not editable.
 */
export function lowerBracketView(matches: readonly RoutableMatch[]): LowerRoundView[] {
  const byId = new Map(matches.map((m) => [m.id, m]))
  const routes = routesByTarget(matches)
  const lb = matches.filter((m) => m.section === LOWER)

  const rounds = new Map<number, LowerMatchView[]>()
  for (const m of lb.slice().sort((a, b) => a.round - b.round || a.slot - b.slot)) {
    const locked = isLocked(m)
    const view = (slot: number): LowerSlotView => {
      const source = routes.get(slotKey({ matchId: m.id, slot })) ?? null
      const src = source ? byId.get(source.sourceMatchId) : undefined
      const reason = locked
        ? 'This match has a result and cannot be changed.'
        : !source
          ? 'Nothing feeds this slot, so there is no route to move.'
          : null
      return {
        matchId: m.id,
        slot,
        source,
        sourceLabel: source && src ? sourceLabel(src, source.kind) : null,
        occupant: occupantOf(m, slot),
        editable: reason === null,
        reason,
      }
    }
    const list = rounds.get(m.round) ?? []
    list.push({
      matchId: m.id,
      round: m.round,
      slot: m.slot,
      label: m.label?.trim() || matchName(m),
      locked,
      slots: [view(0), view(1)],
    })
    rounds.set(m.round, list)
  }

  return [...rounds.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, ms]) => ({ round, matches: ms }))
}

/** Apply one route write to a copy of a match, leaving everything else alone. */
function withRoute(m: RoutableMatch, kind: FeedKind, target: SlotRef): RoutableMatch {
  return kind === 'WINNER'
    ? { ...m, feedsMatchId: target.matchId, feedsSlot: target.slot }
    : { ...m, loserFeedsMatchId: target.matchId, loserFeedsSlot: target.slot }
}

const routeData = (kind: FeedKind, t: SlotRef): Record<string, number | null> => (kind === 'WINNER'
  ? { feedsMatchId: t.matchId, feedsSlot: t.slot }
  : { loserFeedsMatchId: t.matchId, loserFeedsSlot: t.slot })

/**
 * Swap the two routes feeding two slots in the same losers-bracket round, carrying each seated
 * player across with their route.
 *
 * Returns the field writes to persist and the bracket as it would then read, so a caller can show
 * the resulting matchups before committing to them.
 */
export function swapLowerSlots(
  matches: readonly RoutableMatch[],
  a: SlotRef,
  b: SlotRef,
): EditResult {
  const byId = new Map(matches.map((m) => [m.id, m]))
  const ma = byId.get(a.matchId)
  const mb = byId.get(b.matchId)

  if (!ma || !mb) return { ok: false, error: 'That match is not part of this bracket.' }
  if (a.slot !== 0 && a.slot !== 1) return { ok: false, error: 'A match has two slots.' }
  if (b.slot !== 0 && b.slot !== 1) return { ok: false, error: 'A match has two slots.' }
  if (slotKey(a) === slotKey(b)) return { ok: false, error: 'Pick two different slots to swap.' }

  if (ma.section !== LOWER || mb.section !== LOWER) {
    return { ok: false, error: 'Only the losers bracket can be edited. The winners bracket and the grand final are fixed.' }
  }
  // Cross-round moves would change how many matches a player must win to reach the final, which is
  // a different bracket rather than a different routing.
  if (ma.round !== mb.round) {
    return { ok: false, error: 'Both slots must be in the same losers-bracket round.' }
  }
  if (isLocked(ma)) return { ok: false, error: `${matchName(ma)} already has a result and cannot be changed.` }
  if (isLocked(mb)) return { ok: false, error: `${matchName(mb)} already has a result and cannot be changed.` }

  const routes = routesByTarget(matches)
  const ra = routes.get(slotKey(a))
  const rb = routes.get(slotKey(b))
  if (!ra || !rb) return { ok: false, error: 'One of those slots has no feed to move.' }
  if (ra.sourceMatchId === rb.sourceMatchId && ra.kind === rb.kind) {
    return { ok: false, error: 'Those two slots are fed by the same route.' }
  }

  const sa = byId.get(ra.sourceMatchId)
  const sb = byId.get(rb.sourceMatchId)
  if (!sa || !sb) return { ok: false, error: 'A feed points at a match that is not in this bracket.' }

  // The seated players travel with their routes.
  const occA = occupantOf(ma, a.slot)
  const occB = occupantOf(mb, b.slot)

  const next = matches.map((m) => {
    let out = m
    if (m.id === sa.id) out = withRoute(out, ra.kind, b)
    if (m.id === sb.id) out = withRoute(out, rb.kind, a)
    return out
  }).map((m) => {
    if (m.id === ma.id && m.id === mb.id) {
      // Both slots of one match: swap its two occupants in a single pass.
      const seated = { ...m, ...seatData(a.slot, occB), ...seatData(b.slot, occA) }
      return seated as RoutableMatch
    }
    if (m.id === ma.id) return { ...m, ...seatData(a.slot, occB) } as RoutableMatch
    if (m.id === mb.id) return { ...m, ...seatData(b.slot, occA) } as RoutableMatch
    return m
  })

  const problem = validateRouting(next, matches)
  if (problem) return { ok: false, error: problem }

  const updates: RouteUpdate[] = []
  const push = (matchId: number, data: Record<string, number | string | null>) => {
    const found = updates.find((u) => u.matchId === matchId)
    if (found) Object.assign(found.data, data)
    else updates.push({ matchId, data })
  }
  push(sa.id, routeData(ra.kind, b))
  push(sb.id, routeData(rb.kind, a))
  push(ma.id, seatData(a.slot, occB))
  push(mb.id, seatData(b.slot, occA))

  return { ok: true, updates, preview: next }
}

/**
 * Everything that must still be true of a bracket after an edit.
 *
 * Checked against the WHOLE bracket rather than the two slots that moved, because the failures worth
 * catching are the ones a local check cannot see: a route that now lands on top of another, a player
 * seated in two live matches at once, a loop that would leave the bracket unable to finish.
 *
 * `before` is the bracket as it was, used only to prove nothing already-played moved.
 */
export function validateRouting(
  after: readonly RoutableMatch[],
  before: readonly RoutableMatch[],
): string | null {
  const byId = new Map(after.map((m) => [m.id, m]))
  const wasById = new Map(before.map((m) => [m.id, m]))

  // ── Nothing that has been played may have moved ───────────────────────────────────────────────
  for (const m of after) {
    const was = wasById.get(m.id)
    if (!was || !isLocked(was)) continue
    const sameResult = m.status === was.status
      && m.homeGames === was.homeGames && m.awayGames === was.awayGames
      && m.winnerRegistrationId === was.winnerRegistrationId
      && m.forfeitRegistrationId === was.forfeitRegistrationId
      && m.homeRegistrationId === was.homeRegistrationId
      && m.awayRegistrationId === was.awayRegistrationId
      && m.round === was.round && m.slot === was.slot && m.section === was.section
    if (!sameResult) return `${matchName(was)} has a result, so it cannot be changed.`
  }

  // ── No route may point into a match that has already been played ──────────────────────────────
  const routeTargets: { from: RoutableMatch; kind: FeedKind; target: SlotRef }[] = []
  for (const m of after) {
    if (m.feedsMatchId != null && m.feedsSlot != null) {
      routeTargets.push({ from: m, kind: 'WINNER', target: { matchId: m.feedsMatchId, slot: m.feedsSlot } })
    }
    if (m.loserFeedsMatchId != null && m.loserFeedsSlot != null) {
      routeTargets.push({ from: m, kind: 'LOSER', target: { matchId: m.loserFeedsMatchId, slot: m.loserFeedsSlot } })
    }
  }

  for (const r of routeTargets) {
    const target = byId.get(r.target.matchId)
    if (!target) return `${matchName(r.from)} feeds a match that does not exist.`
    if (r.target.slot !== 0 && r.target.slot !== 1) return `${matchName(r.from)} feeds a slot that does not exist.`
    if (r.from.id === r.target.matchId) return `${matchName(r.from)} cannot feed itself.`

    // A route into a played match is only acceptable if it was already there: the played match got
    // its players from somewhere, and that history is not ours to rewrite.
    const wasFrom = wasById.get(r.from.id)
    const unchanged = wasFrom && (r.kind === 'WINNER'
      ? wasFrom.feedsMatchId === r.target.matchId && wasFrom.feedsSlot === r.target.slot
      : wasFrom.loserFeedsMatchId === r.target.matchId && wasFrom.loserFeedsSlot === r.target.slot)
    if (isLocked(target) && !unchanged) {
      return `${matchName(target)} has a result, so nothing new can be routed into it.`
    }
  }

  // ── One route per slot: two arrivals in one seat loses a player ───────────────────────────────
  const seen = new Map<string, RoutableMatch>()
  for (const r of routeTargets) {
    const k = slotKey(r.target)
    const clash = seen.get(k)
    if (clash) {
      const t = byId.get(r.target.matchId)
      return `${matchName(r.from)} and ${matchName(clash)} would both feed the same slot in ${t ? matchName(t) : 'a match'}.`
    }
    seen.set(k, r.from)
  }

  // ── Every route that existed still exists ────────────────────────────────────────────────────
  const countRoutes = (ms: readonly RoutableMatch[]) => ms.reduce((n, m) =>
    n + (m.feedsMatchId != null ? 1 : 0) + (m.loserFeedsMatchId != null ? 1 : 0), 0)
  if (countRoutes(after) !== countRoutes(before)) {
    return 'That edit would add or remove a feed, which would leave a player with nowhere to go.'
  }

  // ── Nobody may sit in two live seats at once ─────────────────────────────────────────────────
  const seats = new Map<number, RoutableMatch>()
  for (const m of after) {
    if (isLocked(m)) continue
    for (const slot of [0, 1]) {
      const o = occupantOf(m, slot)
      if (o.registrationId == null) continue
      const other = seats.get(o.registrationId)
      if (other && other.id !== m.id) {
        return `${o.username ?? 'A player'} would be waiting in both ${matchName(other)} and ${matchName(m)}.`
      }
      if (other && other.id === m.id) {
        return `${o.username ?? 'A player'} would be playing themselves in ${matchName(m)}.`
      }
      seats.set(o.registrationId, m)
    }
  }

  // ── The bracket must still be able to finish ─────────────────────────────────────────────────
  const cycle = findCycle(after)
  if (cycle) return `That edit would send ${cycle} back into itself, so the bracket could never finish.`

  return null
}

/**
 * A match that can reach itself by following feeds.
 *
 * A bracket is a DAG: every route moves a player strictly forward. A cycle means somebody advances
 * into a match they have already been routed out of, and the tournament has no last match. Returned
 * as a name so the refusal can say which one.
 */
function findCycle(matches: readonly RoutableMatch[]): string | null {
  const byId = new Map(matches.map((m) => [m.id, m]))
  const state = new Map<number, 0 | 1 | 2>() // unvisited | on the current path | done

  const walk = (id: number): number | null => {
    const mark = state.get(id) ?? 0
    if (mark === 1) return id
    if (mark === 2) return null
    state.set(id, 1)
    const m = byId.get(id)
    for (const next of [m?.feedsMatchId, m?.loserFeedsMatchId]) {
      if (next == null || !byId.has(next)) continue
      const hit = walk(next)
      if (hit != null) return hit
    }
    state.set(id, 2)
    return null
  }

  for (const m of matches) {
    const hit = walk(m.id)
    if (hit != null) return matchName(byId.get(hit) ?? m)
  }
  return null
}

/** Whether this bracket is one the lower-bracket editor can open at all. */
export function isEditableDoubleElim(matches: readonly RoutableMatch[]): boolean {
  return matches.some((m) => m.section === LOWER)
}
