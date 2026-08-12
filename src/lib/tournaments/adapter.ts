// Pure DB→fixture-shape reconstruction for cups. NO 'server-only' and only a
// type-only import of the Cup shapes, so this module is safe to run from a plain
// `tsx` script (the snapshot generator) as well as inside Next — no dev server, no
// path-alias runtime dependency.
import type { Cup, BracketRound, BracketMatch, BracketSlot, TeamTie, TieMatch } from './fixtures'

export type CupBracketRow = {
  bracketKind: string
  roundName: string
  roundOrder: number
  matchOrder: number
  aPresent: boolean
  aName: string | null
  aHandle: string | null
  aSeed: number | null
  aScore: number | null
  bPresent: boolean
  bName: string | null
  bHandle: string | null
  bSeed: number | null
  bScore: number | null
  winner: string | null
  note: string | null
}
export type CupTieMatchRow = {
  matchOrder: number
  homeName: string
  homeHandle: string | null
  homeCaptain: boolean
  awayName: string
  awayHandle: string | null
  awayCaptain: boolean
  homeScore: string | null
  awayScore: string | null
  note: string | null
}
export type CupTeamTieRow = { round: string; roundOrder: number; homeTeam: string; awayTeam: string; homeWins: number; awayWins: number; winner: string; matches: CupTieMatchRow[] }
export type CompRow = {
  cupNumber: number | null
  name: string
  cupFormatBadge: string | null
  cupStatus: string | null
  cupYear: number | null
  cupDate: string | null
  entrantsCount: number | null
  currentRound: string | null
  finalScore: string | null
  championName: string | null
  championHandle: string | null
  runnerUpName: string | null
  runnerUpHandle: string | null
  thirdPlaceName: string | null
  thirdPlaceHandle: string | null
  cupBracketMatches: CupBracketRow[]
  cupTeamTies: CupTeamTieRow[]
}

const slotFromRow = (present: boolean, name: string | null, handle: string | null, seed: number | null, score: number | null): BracketSlot | undefined => {
  if (!present) return undefined
  const s: BracketSlot = {}
  if (name != null) s.name = name
  if (handle != null) s.handle = handle
  if (seed != null) s.seed = seed
  if (score != null) s.score = score
  return s
}

function roundsFrom(rows: CupBracketRow[], kind: string): BracketRound[] {
  const inKind = rows.filter((r) => r.bracketKind === kind).sort((a, b) => a.roundOrder - b.roundOrder || a.matchOrder - b.matchOrder)
  const byRound = new Map<number, CupBracketRow[]>()
  for (const r of inKind) { if (!byRound.has(r.roundOrder)) byRound.set(r.roundOrder, []); byRound.get(r.roundOrder)!.push(r) }
  const out: BracketRound[] = []
  for (const ro of [...byRound.keys()].sort((a, b) => a - b)) {
    const rs = byRound.get(ro)!
    out.push({
      name: rs[0].roundName,
      matches: rs.map((r) => {
        const m: BracketMatch = {}
        const a = slotFromRow(r.aPresent, r.aName, r.aHandle, r.aSeed, r.aScore)
        const b = slotFromRow(r.bPresent, r.bName, r.bHandle, r.bSeed, r.bScore)
        if (a !== undefined) m.a = a
        if (b !== undefined) m.b = b
        if (r.winner != null) m.winner = r.winner as 'a' | 'b'
        if (r.note != null) m.note = r.note
        return m
      }),
    })
  }
  return out
}

/** Reconstruct the exact `Cup[]` shape from unified-competition DB rows (cups only),
 *  ordered by cup number. Absent fields are omitted (never emitted as null). */
export function cupsFromCompRows(comps: CompRow[]): Cup[] {
  return [...comps]
    .sort((a, b) => (a.cupNumber ?? 0) - (b.cupNumber ?? 0))
    .map((comp) => {
      const cup: Cup = { number: comp.cupNumber!, name: comp.name, format: comp.cupFormatBadge!, status: comp.cupStatus as 'completed' | 'live' }
      if (comp.cupYear != null) cup.year = comp.cupYear
      if (comp.cupDate != null) cup.date = comp.cupDate
      if (comp.entrantsCount != null) cup.entrants = comp.entrantsCount
      if (comp.currentRound != null) cup.currentRound = comp.currentRound
      if (comp.finalScore != null) cup.finalScore = comp.finalScore
      if (comp.championName != null) cup.champion = { name: comp.championName, ...(comp.championHandle != null ? { handle: comp.championHandle } : {}) }
      if (comp.runnerUpName != null) cup.runnerUp = { name: comp.runnerUpName, ...(comp.runnerUpHandle != null ? { handle: comp.runnerUpHandle } : {}) }
      if (comp.thirdPlaceName != null) cup.thirdPlace = { name: comp.thirdPlaceName, ...(comp.thirdPlaceHandle != null ? { handle: comp.thirdPlaceHandle } : {}) }

      const rows = comp.cupBracketMatches
      const main = roundsFrom(rows, 'MAIN'); if (main.length) cup.bracket = main
      const wb = roundsFrom(rows, 'WINNERS'); if (wb.length) cup.winnersBracket = wb
      const lb = roundsFrom(rows, 'LOSERS'); if (lb.length) cup.losersBracket = lb
      const gf = roundsFrom(rows, 'GRAND_FINAL'); if (gf.length) cup.grandFinal = gf

      if (comp.cupTeamTies.length) {
        cup.teamTies = [...comp.cupTeamTies].sort((a, b) => a.roundOrder - b.roundOrder).map((tie): TeamTie => ({
          round: tie.round, home: tie.homeTeam, away: tie.awayTeam, homeWins: tie.homeWins, awayWins: tie.awayWins, winner: tie.winner as 'home' | 'away',
          matches: [...tie.matches].sort((a, b) => a.matchOrder - b.matchOrder).map((tm): TieMatch => ({
            home: { name: tm.homeName, ...(tm.homeHandle != null ? { handle: tm.homeHandle } : {}), ...(tm.homeCaptain ? { captain: true } : {}) },
            away: { name: tm.awayName, ...(tm.awayHandle != null ? { handle: tm.awayHandle } : {}), ...(tm.awayCaptain ? { captain: true } : {}) },
            ...(tm.homeScore != null ? { homeScore: tm.homeScore } : {}),
            ...(tm.awayScore != null ? { awayScore: tm.awayScore } : {}),
            ...(tm.note != null ? { note: tm.note } : {}),
          })),
        }))
      }
      return cup
    })
}
