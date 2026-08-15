import 'server-only'
import { secureShuffle } from './secure-random'

/**
 * Balanced-random roster generation for RANDOM-draw team tournaments.
 *
 * Objective: generally mix stronger and weaker players so teams are roughly balanced, WITHOUT making
 * exact teammate combinations predictable. This is pure logic over already-loaded entrants; the DB
 * work (loading ratings/positions, creating teams, naming, seeding) lives in the caller.
 *
 * The randomness is cryptographically secure and unbiased (see `secure-random.ts`). There is NO
 * deterministic highest-plus-lowest pairing: rank 1 does not always receive the bottom entrant.
 */

export interface RandomEntrant {
  /** The solo Registration id this entrant registered under. */
  registrationId: number
  playerId: string | null
  name: string
  handle: string | null
  /** Current all-time Ladder Elo (defaults to the start rating for unranked players). */
  rating: number
  /** Whether the player has any rated history. Unranked players sink to the lowest band. */
  ranked: boolean
  /** True when the player currently occupies overall Ladder positions 1–5 (top-five protection). */
  topFive: boolean
}

export interface GeneratedRoster {
  /** Members in display order (index 0 = captain = highest-rated member of the team). */
  members: RandomEntrant[]
}

/** Validate the entrant count forms complete teams and at least two of them. Pure — mirrors the
 *  close-registration gate so the engine never produces partial teams. */
export function validateRandomCount(entrantCount: number, teamSize: number): { ok: true; numTeams: number } | { ok: false; error: string } {
  if (teamSize < 1) return { ok: false, error: 'Invalid team size.' }
  if (entrantCount < teamSize * 2) {
    const need = teamSize * 2 - entrantCount
    return { ok: false, error: `Random-draw teams of ${teamSize} need at least ${teamSize * 2} players (two teams) — you have ${entrantCount}. Add ${need} more before generating.` }
  }
  const remainder = entrantCount % teamSize
  if (remainder !== 0) {
    const add = teamSize - remainder
    return {
      ok: false,
      error: `Random-draw teams of ${teamSize} need the player count to be an exact multiple of ${teamSize}. You have ${entrantCount}. Add ${add} more player${add === 1 ? '' : 's'} (to ${entrantCount + add}) or remove ${remainder} (to ${entrantCount - remainder}) before generating — no player is ever dropped.`,
    }
  }
  return { ok: true, numTeams: entrantCount / teamSize }
}

/**
 * Produce balanced-random rosters.
 *
 * 1. Sort entrants by current Ladder rating (highest → lowest); unranked players are placed in the
 *    lowest group with a randomized order.
 * 2. Divide the ordered list into `teamSize` rating bands, each holding one player per team.
 * 3. Securely shuffle each band, then independently assign one player from each band to each team.
 * 4. Enforce top-five separation (≤1 top-five per team when possible; otherwise spread as evenly as
 *    mathematically possible with randomized, minimal collisions).
 */
export function planBalancedRosters(entrants: readonly RandomEntrant[], teamSize: number): GeneratedRoster[] {
  const check = validateRandomCount(entrants.length, teamSize)
  if (!check.ok) throw new Error(check.error)
  const numTeams = check.numTeams

  // 1) Rated players high→low with a RANDOM tie-break (shuffle first, then stable sort by rating so
  //    equal ratings keep their shuffled order). Unranked players sink to the bottom, shuffled.
  const rated = secureShuffle(entrants.filter((e) => e.ranked)).sort((a, b) => b.rating - a.rating)
  const unrated = secureShuffle(entrants.filter((e) => !e.ranked))
  const ordered = [...rated, ...unrated]

  // 2 + 3) Bands of one-player-per-team; each band independently shuffled, then dealt across teams.
  const teams: RandomEntrant[][] = Array.from({ length: numTeams }, () => [])
  for (let band = 0; band < teamSize; band++) {
    const slice = ordered.slice(band * numTeams, (band + 1) * numTeams)
    const shuffled = secureShuffle(slice)
    for (let t = 0; t < numTeams; t++) teams[t].push(shuffled[t])
  }

  // 4) Top-five separation.
  separateTopFive(teams, numTeams)

  // Order each roster by rating (captain = strongest) for a stable, sensible display.
  return teams.map((members) => ({ members: [...members].sort((a, b) => b.rating - a.rating) }))
}

/**
 * Rebalance so no team carries more top-five players than mathematically necessary.
 *  - When teams ≥ registered top-five players: at most one per team (zero collisions).
 *  - When teams < top-five players: spread as evenly as possible so the number of teams with two or
 *    more is the pigeonhole minimum. Which teams absorb the unavoidable extra is randomized.
 * Repairs by swapping a surplus top-five member with a non-top-five member of a team that has room,
 * which always exists because `maxPerTeam = ceil(k / numTeams) ≤ teamSize`.
 */
function separateTopFive(teams: RandomEntrant[][], numTeams: number): void {
  const total = teams.reduce((s, t) => s + t.filter((m) => m.topFive).length, 0)
  if (total <= 1) return
  const maxPerTeam = Math.ceil(total / numTeams)

  const excess = () => teams.reduce((s, t) => s + Math.max(0, t.filter((m) => m.topFive).length - maxPerTeam), 0)

  let guard = total * teams.length + 8 // strictly-decreasing excess bounds this; guard is a backstop
  while (excess() > 0 && guard-- > 0) {
    const donorIdx = teams.findIndex((t) => t.filter((m) => m.topFive).length > maxPerTeam)
    if (donorIdx === -1) break
    const donor = teams[donorIdx]
    // Randomly choose which surplus top-five leaves, and a random recipient with room + a swappable
    // non-top-five member, so unavoidable collisions are distributed unpredictably.
    const surplus = secureShuffle(donor.filter((m) => m.topFive))[0]
    const recipients = secureShuffle(
      teams
        .map((t, i) => ({ t, i }))
        .filter(({ t, i }) => i !== donorIdx && t.filter((m) => m.topFive).length < maxPerTeam && t.some((m) => !m.topFive)),
    )
    if (!recipients.length) break
    const { t: recip } = recipients[0]
    const giveBack = secureShuffle(recip.filter((m) => !m.topFive))[0]
    // Swap the two players between the teams.
    donor[donor.indexOf(surplus)] = giveBack
    recip[recip.indexOf(giveBack)] = surplus
  }
}
