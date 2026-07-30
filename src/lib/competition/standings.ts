/** Pure standings computation from group results (deterministic, tiebroken). */

export interface StandingMatchInput {
  homeRegistrationId: number
  awayRegistrationId: number
  homeUsername: string
  awayUsername: string
  homeGames: number
  awayGames: number
  winnerRegistrationId: number
  /** Only VERIFIED, decided matches should be passed in. */
}

export interface StandingRowComputed {
  registrationId: number
  username: string
  played: number
  wins: number
  losses: number
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
  gamesWon: number
  gamesLost: number
}

/**
 * Compute ranked standings for one group.
 * - `roster` seeds a row for every player so 0-game players still appear.
 * - Tiebreakers (deterministic): wins ↓, game differential ↓, games won ↓,
 *   head-to-head result between the tied pair, then username ↑.
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
      gamesWon: 0,
      gamesLost: 0,
    })
  }

  const ensure = (id: number, username: string): Acc => {
    let row = acc.get(id)
    if (!row) {
      row = { registrationId: id, username, played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0 }
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
    if (m.winnerRegistrationId === m.homeRegistrationId) {
      home.wins++
      away.losses++
    } else {
      away.wins++
      home.losses++
    }
    const key = pairKey(m.homeRegistrationId, m.awayRegistrationId)
    h2h.set(key, m.winnerRegistrationId)
  }

  const rows: StandingRowComputed[] = [...acc.values()].map((r) => ({
    registrationId: r.registrationId,
    username: r.username,
    played: r.played,
    wins: r.wins,
    losses: r.losses,
    gamesWon: r.gamesWon,
    gamesLost: r.gamesLost,
    gameDiff: r.gamesWon - r.gamesLost,
    points: r.wins, // 1 point per match win
    rank: 0,
    qualified: false,
  }))

  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff
    if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon
    // head-to-head between exactly these two
    const winner = h2h.get(pairKey(a.registrationId, b.registrationId))
    if (winner === a.registrationId) return -1
    if (winner === b.registrationId) return 1
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
