/** Pure single-elimination bracket construction from seeded qualifiers. */

export interface Qualifier {
  registrationId: number
  username: string
  /** Overall seed, 1 = best. */
  seed: number
}

export interface BracketSlot {
  registrationId: number | null
  username: string | null
  seed: number | null
}

export interface BracketMatch {
  /** Stable index within the whole bracket (0-based, round-major). */
  index: number
  round: number // 1 = first round
  slot: number // 0-based within the round
  label: string
  home: BracketSlot
  away: BracketSlot
  /** Index of the match the winner advances to (null for the final). */
  feedsIndex: number | null
  /** 0 = winner fills home slot of the next match, 1 = away slot. */
  feedsSlot: number | null
}

export interface BracketPlan {
  rounds: number
  bracketSize: number
  matches: BracketMatch[]
}

export interface GroupQualifiers {
  groupOrdinal: number // 0 = Group A
  /** Qualified players in group-rank order (rank 1 first). */
  players: { registrationId: number; username: string }[]
}

/**
 * Seed qualifiers across groups into one overall order: all group winners first
 * (by group A, B, …), then all runners-up, and so on. This keeps a group's #1
 * seeded above every other group's #2, so top seeds are rewarded and same-group
 * rematches are pushed to later rounds by the bracket seeding. Deterministic.
 */
export function orderQualifiers(groups: readonly GroupQualifiers[]): Qualifier[] {
  const sorted = groups.slice().sort((a, b) => a.groupOrdinal - b.groupOrdinal)
  const maxTier = Math.max(0, ...sorted.map((g) => g.players.length))
  const out: Qualifier[] = []
  let seed = 1
  for (let tier = 0; tier < maxTier; tier++) {
    for (const g of sorted) {
      const p = g.players[tier]
      if (p) out.push({ registrationId: p.registrationId, username: p.username, seed: seed++ })
    }
  }
  return out
}

/**
 * Standard 1-based bracket seed order for a bracket of `size` (power of 2).
 * Doubles the seed list each round (1 vs N, 2 vs N-1, …) so top seeds sit in
 * opposite halves and only meet in the final. Terminates when length reaches size.
 */
export function seedOrder(size: number): number[] {
  let seeds = [1, 2]
  while (seeds.length < size) {
    const n = seeds.length * 2
    const next: number[] = []
    for (const s of seeds) {
      next.push(s)
      next.push(n + 1 - s)
    }
    seeds = next
  }
  return seeds
}

function roundLabel(round: number, totalRounds: number, slot: number): string {
  const fromEnd = totalRounds - round
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return `Semifinal ${slot + 1}`
  if (fromEnd === 2) return `Quarterfinal ${slot + 1}`
  return `Round ${round} · Match ${slot + 1}`
}

/**
 * Build a single-elimination bracket. Qualifiers are placed by seed into a
 * power-of-two bracket (byes fill the remainder); top seeds meet lowest seeds
 * first and are kept apart until later rounds. Returns every match across all
 * rounds with winner-advancement wiring. Deterministic.
 */
export function planBracket(qualifiers: readonly Qualifier[]): BracketPlan {
  if (qualifiers.length < 2) throw new Error('Need at least 2 qualifiers for a bracket')

  const ordered = qualifiers.slice().sort((a, b) => a.seed - b.seed)
  const bracketSize = nextPow2(ordered.length)
  const rounds = Math.log2(bracketSize)

  // Map seed position (1-based) → qualifier or bye.
  const order = seedOrder(bracketSize)
  const bySeedPos: (Qualifier | null)[] = order.map((seedNum) => ordered[seedNum - 1] ?? null)

  const matches: BracketMatch[] = []
  const roundStartIndex: number[] = []
  let idx = 0

  // Build match shells round by round.
  for (let r = 1; r <= rounds; r++) {
    roundStartIndex[r] = idx
    const slots = bracketSize / Math.pow(2, r)
    for (let s = 0; s < slots; s++) {
      matches.push({
        index: idx,
        round: r,
        slot: s,
        label: roundLabel(r, rounds, s),
        home: emptySlot(),
        away: emptySlot(),
        feedsIndex: null,
        feedsSlot: null,
      })
      idx++
    }
  }

  // Wire winner advancement: match s in round r feeds match floor(s/2) in r+1.
  for (let r = 1; r < rounds; r++) {
    const slots = bracketSize / Math.pow(2, r)
    for (let s = 0; s < slots; s++) {
      const m = matches[roundStartIndex[r] + s]
      m.feedsIndex = roundStartIndex[r + 1] + Math.floor(s / 2)
      m.feedsSlot = s % 2 === 0 ? 0 : 1
    }
  }

  // Seat round-1 participants.
  const firstRoundSlots = bracketSize / 2
  for (let s = 0; s < firstRoundSlots; s++) {
    const m = matches[roundStartIndex[1] + s]
    const homeQ = bySeedPos[s * 2]
    const awayQ = bySeedPos[s * 2 + 1]
    m.home = toSlot(homeQ)
    m.away = toSlot(awayQ)
  }

  // Auto-advance byes from round 1 into round 2.
  for (let s = 0; s < firstRoundSlots; s++) {
    const m = matches[roundStartIndex[1] + s]
    const homeBye = m.away.registrationId === null && m.home.registrationId !== null
    const awayBye = m.home.registrationId === null && m.away.registrationId !== null
    if (homeBye || awayBye) {
      const winner = homeBye ? m.home : m.away
      if (m.feedsIndex !== null) {
        const next = matches[m.feedsIndex]
        if (m.feedsSlot === 0) next.home = winner
        else next.away = winner
      }
    }
  }

  return { rounds, bracketSize, matches }
}

function emptySlot(): BracketSlot {
  return { registrationId: null, username: null, seed: null }
}
function toSlot(q: Qualifier | null): BracketSlot {
  return q ? { registrationId: q.registrationId, username: q.username, seed: q.seed } : emptySlot()
}
function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}
