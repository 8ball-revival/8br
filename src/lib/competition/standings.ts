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
 * - Points: Win = 3, Draw = 1, +1 for completing every scheduled set in the group.
 * - Tiebreakers (deterministic): Points ↓, then head-to-head result between the tied pair,
 *   then win percentage ↓, then username ↑.
 * - `qualifiersPerGroup` marks the top N as qualified.
 */
export function computeStandings(
  roster: readonly { registrationId: number; username: string }[],
  matches: readonly StandingMatchInput[],
  qualifiersPerGroup: number,
  /**
   * How many times each pair meets — 1 for a single round robin, 2 for a double one.
   *
   * Defaults to 1 so every existing caller keeps its exact behaviour; only the completion point
   * depends on it. Wins, draws, games and every tiebreaker are counted from the matches themselves,
   * so a double robin needs no other change here: it simply has twice as many of them.
   */
  meetingsPerPair: 1 | 2 = 1,
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

  /*
   * A full slate is (group size − 1) matches per meeting, and completing it earns a completion point.
   *
   * `meetingsPerPair` is what makes that correct for a DOUBLE round robin, where everybody plays each
   * opponent twice and a full slate is therefore twice as long. Getting this wrong is not cosmetic:
   * with the single-robin slate every player in a double group clears the bar halfway through and
   * collects the completion point for a season they have not finished.
   */
  const fullSlate = Math.max(0, roster.length - 1) * meetingsPerPair
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
    /*
      Points: Win = 3, Draw = 1, plus 1 for completing every scheduled set in the group.

      A win was worth 2 until 2026-08-31. Three widens the gap between winning and drawing, which is
      the point of the change: at 2 a draw was worth half a win, and a player who drew everything
      finished level with one who won half their sets and lost the rest.

      This is the only place the scale is written. The stored `Standing.points` rows carry whatever
      the rule was when they were computed, so a season closed under the old scale keeps its old
      totals until something recomputes it - see the note in the release for which seasons that is.
    */
    points: r.wins * 3 + r.draws + (fullSlate > 0 && r.played >= fullSlate ? 1 : 0),
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
