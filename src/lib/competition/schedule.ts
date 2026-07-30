/** Deterministic round-robin scheduling (circle method). */

export interface SchedulePlayer {
  registrationId: number
  username: string
}

export interface ScheduledMatch {
  round: number
  home: SchedulePlayer
  away: SchedulePlayer
}

/**
 * Single round-robin: every player meets every other exactly once. Uses the
 * circle method with a bye for odd counts. Order is deterministic given the input
 * order (callers pass players already ordered by in-group seed).
 */
export function roundRobin(players: readonly SchedulePlayer[]): ScheduledMatch[] {
  const list = players.slice()
  const bye: SchedulePlayer | null = list.length % 2 === 1 ? { registrationId: -1, username: '(bye)' } : null
  if (bye) list.push(bye)

  const n = list.length
  const rounds = n - 1
  const half = n / 2
  const matches: ScheduledMatch[] = []

  // Fixed first player; rotate the rest.
  let rotation = list.slice()
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const home = rotation[i]
      const away = rotation[n - 1 - i]
      if (home.registrationId !== -1 && away.registrationId !== -1) {
        // Alternate home/away by round for fairness, deterministically.
        const [h, a] = r % 2 === 0 ? [home, away] : [away, home]
        matches.push({ round: r + 1, home: h, away: a })
      }
    }
    // rotate: keep first fixed, move last into position 1
    rotation = [rotation[0], rotation[n - 1], ...rotation.slice(1, n - 1)]
  }
  return matches
}
