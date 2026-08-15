/**
 * WCC tournament view shapes. The historical fixture data was removed in the reset;
 * tournaments now come from the DB snapshot (see @/lib/tournaments/service). These shared
 * types describe the public tournament/bracket view model.
 */

export interface TournamentCompetitor {
  name: string
  handle?: string
  /** Team-format: the roster behind the team name, so the Ladder credits members, not the team. */
  members?: { name: string; handle?: string }[]
}

/** One competitor slot inside a bracket match. */
export interface BracketSlot {
  name?: string
  handle?: string
  /** 1v1 slots: the CueVerse ID used to link the name to the player's public profile
   *  (`/players/{slug}`), the same target the Rankings ladder uses. Present whenever the
   *  slot maps to a real registrant, even when it equals the displayed name. */
  slug?: string
  seed?: number
  score?: number
  /** Team-format: the roster + supporting data for the team-details popover. The bracket row shows
   *  ONLY the team name; members/record/avgRating power the hover/focus/click card. */
  members?: { name: string; handle?: string; slug?: string; rating?: number | null; captain?: boolean }[]
  record?: string // team's W–L in THIS tournament, e.g. "2-0"
  avgRating?: number | null // team average of member Ladder ratings (captured at close)
}

export interface BracketMatch {
  a?: BracketSlot
  b?: BracketSlot
  winner?: 'a' | 'b'
  note?: string // e.g. "Walkover", "Forfeit"
  /** Race length for this specific match (Group Stage + Playoffs: 7 early, 9 semis/final). */
  raceLength?: number
}

export interface BracketRound {
  name: string // e.g. "Quarterfinals", "Semifinals", "Final"
  matches: BracketMatch[]
}

/** Team-format (e.g. 5v5) support: a tie is a set of individual player matches. */
export interface TiePlayer {
  name: string
  handle?: string
  captain?: boolean
}

export interface TieMatch {
  home: TiePlayer
  away: TiePlayer
  homeScore?: string // number as string, or "W"/"DQ"; omit both for an unplayed match
  awayScore?: string
  note?: string
}

export interface TeamTie {
  round: string // "Semi Final", "Final"
  home: string // team name
  away: string
  homeWins: number
  awayWins: number
  winner: 'home' | 'away'
  matches: TieMatch[]
}

export interface TournamentView {
  number: number
  name: string
  format: string // category for the badge: Prize, 2v2, 6oh2, dbt, …
  year?: number
  date?: string // exact start date (ISO) when known — enables the true rolling window
  status: 'completed' | 'live'
  entrants?: number
  champion?: TournamentCompetitor
  runnerUp?: TournamentCompetitor
  finalScore?: string
  currentRound?: string // for live cups, e.g. "Semifinals"
  bracket?: BracketRound[] // real round-by-round results when available (single-elim)
  teamTies?: TeamTie[] // team-format cups (5v5, 2v2): per-tie individual match logs
  // Double-elimination cups: winners + losers brackets and the grand final.
  winnersBracket?: BracketRound[]
  losersBracket?: BracketRound[]
  grandFinal?: BracketRound[]
  thirdPlace?: TournamentCompetitor
}


/** No pre-seeded tournaments — WCC starts empty. Tournaments come from the DB snapshot
 *  (see @/lib/tournaments/service). These fixture types remain the shared view shape. */
const CUPS: TournamentView[] = []
export function getTournaments(): TournamentView[] {
  return CUPS
}

export function getTournament(number: number): TournamentView | undefined {
  return CUPS.find((c) => c.number === number)
}

function roundName(matchesInRound: number): string {
  if (matchesInRound === 1) return 'Final'
  if (matchesInRound === 2) return 'Semifinals'
  if (matchesInRound === 4) return 'Quarterfinals'
  return `Round of ${matchesInRound * 2}`
}

/**
 * An empty single-elim bracket shell sized to `entrants` (rounded up to the next
 * power of two). Used to render the template when real results aren't in yet.
 */
export function emptyBracket(entrants: number): BracketRound[] {
  let size = 2
  while (size < entrants) size *= 2
  const rounds: BracketRound[] = []
  for (let m = size / 2; m >= 1; m = m / 2) {
    rounds.push({ name: roundName(m), matches: Array.from({ length: m }, () => ({}) as BracketMatch) })
  }
  return rounds
}

/** The bracket to render for a tournament: real data if present, else a sized shell. */
export function tournamentBracket(cup: TournamentView): BracketRound[] | null {
  if (cup.bracket && cup.bracket.length) return cup.bracket
  if (cup.entrants && cup.entrants >= 2) return emptyBracket(cup.entrants)
  return null
}
