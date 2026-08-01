/**
 * Cups data (dev fixture). Variety competitions — prize events, 2v2, and special
 * formats — kept separate from league Seasons. Filled in one cup at a time.
 * Swap getCups()/getCup() for a real Payload/Prisma query later; components stay.
 */

export interface CupCompetitor {
  name: string
  handle?: string
}

/** One competitor slot inside a bracket match. */
export interface BracketSlot {
  name?: string
  handle?: string
  seed?: number
  score?: number
}

export interface BracketMatch {
  a?: BracketSlot
  b?: BracketSlot
  winner?: 'a' | 'b'
  note?: string // e.g. "Walkover", "Forfeit"
}

export interface BracketRound {
  name: string // e.g. "Quarterfinals", "Semifinals", "Final"
  matches: BracketMatch[]
}

export interface Cup {
  number: number
  name: string
  format: string // category for the badge: Prize, 2v2, 6oh2, dbt, …
  year?: number
  status: 'completed' | 'live'
  entrants?: number
  champion?: CupCompetitor
  runnerUp?: CupCompetitor
  finalScore?: string
  currentRound?: string // for live cups, e.g. "Semifinals"
  bracket?: BracketRound[] // real round-by-round results when available
}

const CUPS: Cup[] = [
  {
    number: 1,
    name: 'Prize',
    format: 'Prize',
    year: 2006,
    status: 'completed',
    champion: { name: 'Conor', handle: 'xlx_nub_xlx' },
    // entrants / bracket pending — add when we have them.
  },
  {
    number: 11,
    name: 'The Creampuff Classic',
    format: 'Knockout',
    year: 2026,
    status: 'live',
    currentRound: 'Semi Finals',
    entrants: 32,
    // Transcribed from the score7.io bracket screenshot. Semis in progress:
    // Starkiller (top) and GØĐⱠłKɆ.÷ (bottom) through; two QFs still pending.
    bracket: [
      {
        name: 'Round 1',
        matches: [
          { a: { name: 'W T F', seed: 1 }, b: { name: 'Bye', seed: 2 }, winner: 'a' },
          { a: { name: 'Cam', seed: 3, score: 8 }, b: { name: 'Ogges', seed: 4, score: 10 }, winner: 'b' },
          { a: { name: 'Starkiller', seed: 5 }, b: { name: 'Bye', seed: 6 }, winner: 'a' },
          { a: { name: 'Luke', seed: 7 }, b: { name: 'Bye', seed: 8 }, winner: 'a' },
          { a: { name: 'eskimo', seed: 9 }, b: { name: 'Bye', seed: 10 }, winner: 'a' },
          { a: { name: 'Missy♥', seed: 11, score: 7 }, b: { name: 'HuStLeR', seed: 12, score: 4 }, winner: 'a' },
          { a: { name: 'Faisal', seed: 13 }, b: { name: 'Bye', seed: 14 }, winner: 'a' },
          { a: { name: 'Thomas', seed: 15, score: 5 }, b: { name: 'ugur', seed: 16, score: 7 }, winner: 'b' },
          { a: { name: 'Cue', seed: 17 }, b: { name: 'Bye', seed: 18 }, winner: 'a' },
          { a: { name: 'sixohtwo', seed: 19, score: 7 }, b: { name: 'Xx Koty xX', seed: 20, score: 2 }, winner: 'a' },
          { a: { name: 'Bricycle', seed: 21 }, b: { name: 'Bye', seed: 22 }, winner: 'a' },
          { a: { name: 'Travis', seed: 23, score: 7 }, b: { name: 'James', seed: 24, score: 2 }, winner: 'a' },
          { a: { name: 'Nakz_', seed: 25 }, b: { name: 'Bye', seed: 26 }, winner: 'a' },
          { a: { name: 'LJ', seed: 27, score: 2 }, b: { name: 'xlx_CC_xlx', seed: 28, score: 7 }, winner: 'b' },
          { a: { name: '-NOOB-', seed: 29 }, b: { name: 'Bye', seed: 30 }, winner: 'a' },
          { a: { name: 'GØĐⱠłKɆ.÷', seed: 31, score: 7 }, b: { name: 'banned', seed: 32, score: 0 }, winner: 'a' },
        ],
      },
      {
        name: 'Round 2',
        matches: [
          { a: { name: 'W T F' }, b: { name: 'Ogges' }, winner: 'b', note: 'Walkover' },
          { a: { name: 'Starkiller', score: 7 }, b: { name: 'Luke', score: 3 }, winner: 'a' },
          { a: { name: 'eskimo', score: 3 }, b: { name: 'Missy♥', score: 7 }, winner: 'b' },
          { a: { name: 'Faisal', score: 7 }, b: { name: 'ugur', score: 5 }, winner: 'a' },
          { a: { name: 'Cue', score: 4 }, b: { name: 'sixohtwo', score: 7 }, winner: 'b' },
          { a: { name: 'Bricycle', score: 7 }, b: { name: 'Travis', score: 4 }, winner: 'a' },
          { a: { name: 'Nakz_', score: 1 }, b: { name: 'xlx_CC_xlx', score: 7 }, winner: 'b' },
          { a: { name: '-NOOB-', score: 4 }, b: { name: 'GØĐⱠłKɆ.÷', score: 7 }, winner: 'b' },
        ],
      },
      {
        name: 'Quarter Finals',
        matches: [
          { a: { name: 'Ogges', score: 3 }, b: { name: 'Starkiller', score: 7 }, winner: 'b' },
          { a: { name: 'Missy♥' }, b: { name: 'Faisal' } },
          { a: { name: 'sixohtwo', score: 7 }, b: { name: 'Bricycle', score: 2 }, winner: 'a' },
          { a: { name: 'xlx_CC_xlx', score: 0 }, b: { name: 'GØĐⱠłKɆ.÷', score: 7 }, winner: 'b', note: 'Forfeit' },
        ],
      },
      {
        name: 'Semi Finals',
        matches: [
          { a: { name: 'Starkiller' }, b: {} },
          { a: { name: 'sixohtwo' }, b: { name: 'GØĐⱠłKɆ.÷' } },
        ],
      },
      {
        name: 'Finals',
        matches: [{}],
      },
    ],
  },
]

export function getCups(): Cup[] {
  return CUPS
}

export function getCup(number: number): Cup | undefined {
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

/** The bracket to render for a cup: real data if present, else a sized shell. */
export function cupBracket(cup: Cup): BracketRound[] | null {
  if (cup.bracket && cup.bracket.length) return cup.bracket
  if (cup.entrants && cup.entrants >= 2) return emptyBracket(cup.entrants)
  return null
}
