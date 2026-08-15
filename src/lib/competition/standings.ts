/** Pure standings computation from group results (deterministic, tiebroken). */

export interface StandingMatchInput {
  homeRegistrationId: number
  awayRegistrationId: number
  homeUsername: string
  awayUsername: string
  homeGames: number
  awayGames: number
  /** Winner of the match, or `null` for a Group Stage 5–5 draw. */
  winnerRegistrationId: number | null
  /** Only VERIFIED, completed matches should be passed in (draws included). */
}

export interface StandingRowComputed {
  registrationId: number
  username: string
  played: number
  wins: number
  losses: number
  draws: number
  gamesWon: number
  gamesLost: number
  gameDiff: number
  points: number
  rank: number
  qualified: boolean
}

interface Acc {
  registrationId: number
  username: string
  played: number
  wins: number
  losses: number
  draws: number
  gamesWon: number
  gamesLost: number
}

/**
 * Compute ranked standings for one group.
 * - `roster` seeds a row for every player so 0-game players still appear.
 * - Points: Win = 2, Draw = 1, +1 for completing every scheduled set in the group.
 * - Tiebreakers (deterministic): Points ↓, then head-to-head result between the tied pair,
 *   then win percentage ↓, then username ↑.
 * - `qualifiersPerGroup` marks the top N as qualified.
 */
export function computeStandings(
  roster: readonly { registrationId: number; username: string }[],
  matches: readonly StandingMatchInput[],
  qualifiersPerGroup: number,
): StandingRowComputed[] {
  const acc = new Map<number, Acc>()
  for (const p of roster) {
    acc.set(p.registrationId, {
      registrationId: p.registrationId,
      username: p.username,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      gamesWon: 0,
      gamesLost: 0,
    })
  }

  const ensure = (id: number, username: string): Acc => {
    let row = acc.get(id)
    if (!row) {
      row = { registrationId: id, username, played: 0, wins: 0, losses: 0, draws: 0, gamesWon: 0, gamesLost: 0 }
      acc.set(id, row)
    }
    return row
  }

  // head-to-head winner lookup: "min-max" pair key → winnerRegistrationId
  const h2h = new Map<string, number>()

  for (const m of matches) {
    const home = ensure(m.homeRegistrationId, m.homeUsername)
    const away = ensure(m.awayRegistrationId, m.awayUsername)
    home.played++
    away.played++
    home.gamesWon += m.homeGames
    home.gamesLost += m.awayGames
    away.gamesWon += m.awayGames
    away.gamesLost += m.homeGames
    if (m.winnerRegistrationId == null) {
      // Group Stage 5–5 draw: no win or loss for either side (game stats still count). The wins /
      // points / tiebreaker formulas are unchanged — a draw simply adds no match win.
      home.draws++
      away.draws++
    } else if (m.winnerRegistrationId === m.homeRegistrationId) {
      home.wins++
      away.losses++
      h2h.set(pairKey(m.homeRegistrationId, m.awayRegistrationId), m.winnerRegistrationId)
    } else {
      away.wins++
      home.losses++
      h2h.set(pairKey(m.homeRegistrationId, m.awayRegistrationId), m.winnerRegistrationId)
    }
  }

  // A full round-robin slate is (group size − 1) matches; completing it earns a completion point.
  const fullSlate = Math.max(0, roster.length - 1)
  const rows: StandingRowComputed[] = [...acc.values()].map((r) => ({
    registrationId: r.registrationId,
    username: r.username,
    played: r.played,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    gamesWon: r.gamesWon,
    gamesLost: r.gamesLost,
    gameDiff: r.gamesWon - r.gamesLost,
    // Points: Win = 2, Draw = 1, plus 1 for completing every scheduled set in the group.
    points: r.wins * 2 + r.draws + (fullSlate > 0 && r.played >= fullSlate ? 1 : 0),
    rank: 0,
    qualified: false,
  }))

  // Game win percentage (used only to break a points + head-to-head tie).
  const winRate = (r: StandingRowComputed) => { const t = r.gamesWon + r.gamesLost; return t ? r.gamesWon / t : 0 }
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    // Tie on points → head-to-head result between these two first…
    const winner = h2h.get(pairKey(a.registrationId, b.registrationId))
    if (winner === a.registrationId) return -1
    if (winner === b.registrationId) return 1
    // …then win percentage; finally the player name for a fully deterministic order.
    const dw = winRate(b) - winRate(a)
    if (Math.abs(dw) > 1e-9) return dw
    return a.username.toLowerCase() < b.username.toLowerCase() ? -1 : 1
  })

  rows.forEach((row, i) => {
    row.rank = i + 1
    row.qualified = i < qualifiersPerGroup
  })
  return rows
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}
