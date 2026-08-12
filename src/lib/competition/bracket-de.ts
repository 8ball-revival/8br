/**
 * Pure DOUBLE-ELIMINATION bracket construction from seeded qualifiers.
 *
 * Structure (standard double-elim with a single grand final):
 *  - Winners Bracket (WB): a single-elim tree; the WB loser of each match drops to the LB.
 *  - Losers Bracket (LB): alternating consolidation/drop rounds. WB round-1 losers pair up in
 *    LB round 1; each later WB round's losers drop into a specific LB "drop" round against LB
 *    survivors. Losing in the LB eliminates a player (their 2nd loss).
 *  - Grand Final (GF): WB champion vs LB champion, one match, winner takes the title.
 *
 * Byes (qualifiers < bracketSize) auto-advance in both brackets, so a match against an absent
 * opponent is pre-decided and its (non-existent) loser never drops.
 *
 * Reuses the single-elim seed placement so WB seeding matches the single-elim bracket exactly.
 */
import { seedOrder, type Qualifier, type BracketSlot } from './bracket'

export type Section = 'WB' | 'LB' | 'GF'

export interface DEMatch {
  index: number
  section: Section
  round: number // round within the section (1-based)
  slot: number // 0-based within the section-round
  label: string
  home: BracketSlot
  away: BracketSlot
  /** Where the WINNER advances (global index), or null for the grand final. */
  feedsIndex: number | null
  feedsSlot: number | null
  /** Where the LOSER drops (global index), or null (eliminated / single-elim). */
  loserFeedsIndex: number | null
  loserFeedsSlot: number | null
}

export interface DEPlan {
  bracketSize: number
  wbRounds: number
  lbRounds: number
  matches: DEMatch[]
}

const emptySlot = (): BracketSlot => ({ registrationId: null, username: null, seed: null })
const byeSlot = (): BracketSlot => ({ registrationId: null, username: 'Bye', seed: null })
const toSlot = (q: Qualifier | null): BracketSlot =>
  q ? { registrationId: q.registrationId, username: q.username, seed: q.seed } : emptySlot()
const isReal = (s: BracketSlot) => s.registrationId !== null

/** A permanently-empty (walkover) slot — its opponent advances without playing. */
export function isByeSlot(s: { registrationId: number | null; username: string | null }): boolean {
  return s.registrationId === null && s.username === 'Bye'
}
function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** Build a double-elimination plan. Deterministic. */
export function planDoubleElim(qualifiers: readonly Qualifier[]): DEPlan {
  if (qualifiers.length < 2) throw new Error('Need at least 2 qualifiers for a bracket')
  const ordered = qualifiers.slice().sort((a, b) => a.seed - b.seed)
  const bracketSize = nextPow2(ordered.length)
  const k = Math.log2(bracketSize) // WB rounds

  const matches: DEMatch[] = []
  const mk = (section: Section, round: number, slot: number, label: string): DEMatch => {
    const m: DEMatch = {
      index: matches.length,
      section,
      round,
      slot,
      label,
      home: emptySlot(),
      away: emptySlot(),
      feedsIndex: null,
      feedsSlot: null,
      loserFeedsIndex: null,
      loserFeedsSlot: null,
    }
    matches.push(m)
    return m
  }

  // ---- Winners Bracket (indices per [round][slot]) ----
  const wb: DEMatch[][] = []
  for (let r = 1; r <= k; r++) {
    const count = bracketSize / Math.pow(2, r)
    const row: DEMatch[] = []
    for (let s = 0; s < count; s++) row.push(mk('WB', r, s, wbLabel(r, k, s)))
    wb.push(row)
  }

  // ---- Losers Bracket ----
  // Round counts: [N/4, N/4, N/8, N/8, …, 1, 1]. lbRounds = 2(k-1) for k>=2, else 0.
  const lb: DEMatch[][] = []
  const lbRounds = k >= 2 ? 2 * (k - 1) : 0
  for (let j = 1; j <= lbRounds; j++) {
    const count = lbRoundCount(j, k, bracketSize)
    const row: DEMatch[] = []
    for (let s = 0; s < count; s++) row.push(mk('LB', j, s, `Losers R${j} · M${s + 1}`))
    lb.push(row)
  }

  // ---- Grand Final (only exists when there is a losers bracket, i.e. ≥4 slots) ----
  const gf = lbRounds > 0 ? mk('GF', 1, 0, 'Grand Final') : null

  // ---- Wiring: WB winners advance within WB ----
  for (let r = 1; r < k; r++) {
    for (let s = 0; s < wb[r - 1].length; s++) {
      const m = wb[r - 1][s]
      m.feedsIndex = wb[r][Math.floor(s / 2)].index
      m.feedsSlot = s % 2 === 0 ? 0 : 1
    }
  }
  // WB final winner → GF home (or, with no GF, the WB final IS the title decider).
  if (gf) {
    wb[k - 1][0].feedsIndex = gf.index
    wb[k - 1][0].feedsSlot = 0
  } else {
    wb[k - 1][0].label = 'Final'
  }

  // ---- Wiring: WB losers drop to LB ----
  if (k >= 2 && gf) {
    // WB round 1 losers pair up into LB round 1.
    for (let s = 0; s < wb[0].length; s++) {
      wb[0][s].loserFeedsIndex = lb[0][Math.floor(s / 2)].index
      wb[0][s].loserFeedsSlot = s % 2 === 0 ? 0 : 1
    }
    // WB round r>=2 losers drop into LB round 2(r-1), slot 1 (survivor is slot 0).
    for (let r = 2; r <= k; r++) {
      const lbRound = 2 * (r - 1)
      for (let s = 0; s < wb[r - 1].length; s++) {
        wb[r - 1][s].loserFeedsIndex = lb[lbRound - 1][s].index
        wb[r - 1][s].loserFeedsSlot = 1
      }
    }
    // ---- Wiring: LB winners advance within LB ----
    for (let j = 1; j < lbRounds; j++) {
      const cur = lb[j - 1]
      const nextCountSame = lb[j].length === cur.length
      for (let s = 0; s < cur.length; s++) {
        if (nextCountSame) {
          cur[s].feedsIndex = lb[j][s].index
          cur[s].feedsSlot = 0 // survivor into slot 0; WB drop fills slot 1
        } else {
          cur[s].feedsIndex = lb[j][Math.floor(s / 2)].index
          cur[s].feedsSlot = s % 2 === 0 ? 0 : 1
        }
      }
    }
    // LB champion → GF away
    lb[lbRounds - 1][0].feedsIndex = gf.index
    lb[lbRounds - 1][0].feedsSlot = 1
  }

  // ---- Seat WB round 1 by seed (same placement as single-elim) ----
  const order = seedOrder(bracketSize)
  const bySeedPos: (Qualifier | null)[] = order.map((seedNum) => ordered[seedNum - 1] ?? null)
  for (let s = 0; s < wb[0].length; s++) {
    wb[0][s].home = toSlot(bySeedPos[s * 2])
    wb[0][s].away = toSlot(bySeedPos[s * 2 + 1])
  }

  // ---- Auto-advance byes (a match with exactly one real player is pre-decided) ----
  resolveByes(matches)

  return { bracketSize, wbRounds: k, lbRounds, matches }
}

/**
 * Propagate byes through the whole bracket at plan time. A slot is settled as 'real' (holds a
 * player) or 'bye' (permanently empty — no feeder will ever fill it); an unsettled slot is
 * awaiting a real match result. A match with one 'real' + one 'bye' auto-advances the real player
 * (and its bye "loser" drops nothing → that LB slot becomes a 'bye'); a phantom match (both 'bye')
 * feeds byes onward. Playable matches (both 'real') are left for the actual tournament to decide.
 */
function resolveByes(matches: DEMatch[]): void {
  type SlotState = 'real' | 'bye'
  const state = new Map<string, SlotState>()
  const key = (i: number, slot: number) => `${i}:${slot}`

  // Seed initial 'real' states from seated slots (only WB round 1 is seated at plan time).
  for (const m of matches) {
    if (isReal(m.home)) state.set(key(m.index, 0), 'real')
    if (isReal(m.away)) state.set(key(m.index, 1), 'real')
  }
  // A slot with NO feeder and no seated player is a permanent bye.
  const fed = new Set<string>()
  for (const m of matches) {
    if (m.feedsIndex !== null) fed.add(key(m.feedsIndex, m.feedsSlot!))
    if (m.loserFeedsIndex !== null) fed.add(key(m.loserFeedsIndex, m.loserFeedsSlot!))
  }
  for (const m of matches) {
    for (const slot of [0, 1]) {
      const kk = key(m.index, slot)
      if (!state.has(kk) && !fed.has(kk)) state.set(kk, 'bye')
    }
  }

  const setTarget = (idx: number, slot: number, val: BracketSlot, st: SlotState) => {
    const t = matches[idx]
    if (slot === 0) t.home = val
    else t.away = val
    state.set(key(idx, slot), st)
  }

  const processed = new Set<number>()
  let changed = true
  while (changed) {
    changed = false
    for (const m of matches) {
      if (processed.has(m.index)) continue
      const sh = state.get(key(m.index, 0))
      const sa = state.get(key(m.index, 1))
      if (!sh || !sa) continue // not both settled yet
      if (sh === 'real' && sa === 'real') continue // playable — leave for the actual result
      processed.add(m.index)
      changed = true
      if (sh === 'bye' && sa === 'bye') {
        if (m.feedsIndex !== null) setTarget(m.feedsIndex, m.feedsSlot!, byeSlot(), 'bye')
        if (m.loserFeedsIndex !== null) setTarget(m.loserFeedsIndex, m.loserFeedsSlot!, byeSlot(), 'bye')
      } else {
        const winner = sh === 'real' ? m.home : m.away
        if (m.feedsIndex !== null) setTarget(m.feedsIndex, m.feedsSlot!, winner, 'real')
        // the bye "loser" drops nothing → its LB target becomes a bye
        if (m.loserFeedsIndex !== null) setTarget(m.loserFeedsIndex, m.loserFeedsSlot!, byeSlot(), 'bye')
      }
    }
  }
}

// Round labels for the winners bracket (mirrors single-elim naming toward the WB final).
function wbLabel(round: number, totalRounds: number, slot: number): string {
  const fromEnd = totalRounds - round
  if (fromEnd === 0) return 'Winners Final'
  if (fromEnd === 1) return `Winners Semifinal ${slot + 1}`
  if (fromEnd === 2) return `Winners Quarterfinal ${slot + 1}`
  return `Winners R${round} · M${slot + 1}`
}

// LB round match counts: [N/4, N/4, N/8, N/8, …, 1, 1].
function lbRoundCount(j: number, k: number, bracketSize: number): number {
  const level = Math.ceil(j / 2) // 1,1,2,2,3,3,…
  return bracketSize / Math.pow(2, level + 1)
}
