// Pure DB→fixture-shape reconstruction for cups. NO 'server-only' and only a
// type-only import of the TournamentView shapes, so this module is safe to run from a plain
// `tsx` script (the snapshot generator) as well as inside Next — no dev server, no
// path-alias runtime dependency.
import type { TournamentView, BracketRound, BracketMatch, BracketSlot, TournamentCompetitor } from './fixtures'

export type TournamentBracketRow = {
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
export type CompRow = {
  number: number | null
  name: string
  tournamentFormat: string | null
  participantFormat: string | null
  teamSize: number | null
  lifecycleState: string | null
  status: string
  createdAt: Date
  entrantsCount: number | null
  currentRound: string | null
  finalScore: string | null
  championName: string | null
  championHandle: string | null
  runnerUpName: string | null
  runnerUpHandle: string | null
  thirdPlaceName: string | null
  thirdPlaceHandle: string | null
  bracketMatches: TournamentBracketRow[]
  /** Team-format rosters (by team name): Ladder credit + the team-details popover data. */
  teams?: { name: string; members: { name: string; handle: string | null; playerId: string | null; captain: boolean; ratingAtClose: number | null }[] }[]
}

/** Public "format" badge derived from the tournament's structural format. */
function formatBadgeOf(comp: CompRow): string {
  if (comp.participantFormat === 'TEAM') return comp.teamSize ? `${comp.teamSize}v${comp.teamSize}` : 'Team'
  switch (comp.tournamentFormat) {
    case 'DOUBLE_ELIM':
      return 'D/E'
    case 'GROUPS_PLAYOFFS':
      return 'Groups'
    case 'SINGLE_ELIM':
    default:
      return 'S/E'
  }
}

/** Public status ("completed" | "live") derived from the lifecycle/run state. */
function statusOf(comp: CompRow): 'completed' | 'live' {
  return comp.lifecycleState === 'COMPLETED' || comp.status === 'COMPLETED' ? 'completed' : 'live'
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

function roundsFrom(rows: TournamentBracketRow[], kind: string): BracketRound[] {
  const inKind = rows.filter((r) => r.bracketKind === kind).sort((a, b) => a.roundOrder - b.roundOrder || a.matchOrder - b.matchOrder)
  const byRound = new Map<number, TournamentBracketRow[]>()
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

/** Reconstruct the `TournamentView[]` view shape from tournament DB rows, ordered by number.
 *  Absent fields are omitted (never emitted as null). */
export function tournamentsFromCompRows(comps: CompRow[]): TournamentView[] {
  return [...comps]
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((comp) => {
      const cup: TournamentView = { number: comp.number ?? 0, name: comp.name, format: formatBadgeOf(comp), status: statusOf(comp) }
      const year = comp.createdAt.getUTCFullYear()
      if (Number.isFinite(year)) cup.year = year
      if (comp.entrantsCount != null) cup.entrants = comp.entrantsCount
      if (comp.currentRound != null) cup.currentRound = comp.currentRound
      if (comp.finalScore != null) cup.finalScore = comp.finalScore
      if (comp.championName != null) cup.champion = { name: comp.championName, ...(comp.championHandle != null ? { handle: comp.championHandle } : {}) }
      if (comp.runnerUpName != null) cup.runnerUp = { name: comp.runnerUpName, ...(comp.runnerUpHandle != null ? { handle: comp.runnerUpHandle } : {}) }
      if (comp.thirdPlaceName != null) cup.thirdPlace = { name: comp.thirdPlaceName, ...(comp.thirdPlaceHandle != null ? { handle: comp.thirdPlaceHandle } : {}) }

      const rows = comp.bracketMatches
      const main = roundsFrom(rows, 'MAIN'); if (main.length) cup.bracket = main
      const wb = roundsFrom(rows, 'WINNERS'); if (wb.length) cup.winnersBracket = wb
      const lb = roundsFrom(rows, 'LOSERS'); if (lb.length) cup.losersBracket = lb
      const gf = roundsFrom(rows, 'GRAND_FINAL'); if (gf.length) cup.grandFinal = gf

      // TEAM tournaments: attach each team's roster (matched by team name) to the bracket slots +
      // champion/runner-up. Powers BOTH the Ladder (credit individual members, never the team name)
      // and the team-details popover (rosters, ratings captured at close, team record + average).
      if (comp.participantFormat === 'TEAM' && comp.teams?.length) {
        type TeamMem = NonNullable<CompRow['teams']>[number]['members']
        const key = (s: string) => s.trim().toLowerCase()
        const byName = new Map(comp.teams.map((t) => [key(t.name), t.members]))
        const roster = (name?: string | null) => (name ? byName.get(key(name)) : undefined)
        const toMembers = (mem: TeamMem) =>
          mem.map((m) => ({
            name: m.name,
            ...(m.handle ? { handle: m.handle, slug: m.handle } : {}), // CueVerse ID links to the public profile
            ...(m.ratingAtClose != null ? { rating: m.ratingAtClose } : { rating: null }),
            captain: m.captain,
          }))
        // Team average rating (of members whose rating was captured), by team name.
        const avgByName = new Map<string, number | null>()
        for (const t of comp.teams) {
          const rs = t.members.map((m) => m.ratingAtClose).filter((r): r is number => r != null)
          avgByName.set(key(t.name), rs.length ? Math.round(rs.reduce((s, v) => s + v, 0) / rs.length) : null)
        }
        // Team W–L record across every bracket round in this tournament.
        const rec = new Map<string, { w: number; l: number }>()
        const bump = (name: string | undefined, win: boolean) => { if (!name) return; const e = rec.get(key(name)) ?? { w: 0, l: 0 }; if (win) e.w++; else e.l++; rec.set(key(name), e) }
        for (const rounds of [cup.bracket, cup.winnersBracket, cup.losersBracket, cup.grandFinal]) {
          for (const rd of rounds ?? []) for (const m of rd.matches) {
            if (!m.winner) continue
            bump((m.winner === 'a' ? m.a : m.b)?.name, true)
            bump((m.winner === 'a' ? m.b : m.a)?.name, false)
          }
        }
        const attachSlot = (slot?: BracketSlot) => {
          const mem = roster(slot?.name)
          if (!slot || !mem) return
          slot.members = toMembers(mem)
          slot.avgRating = avgByName.get(key(slot.name!)) ?? null
          const r = rec.get(key(slot.name!))
          if (r) slot.record = `${r.w}-${r.l}`
        }
        const attachRounds = (rounds?: BracketRound[]) => rounds?.forEach((r) => r.matches.forEach((m) => { attachSlot(m.a); attachSlot(m.b) }))
        attachRounds(cup.bracket); attachRounds(cup.winnersBracket); attachRounds(cup.losersBracket); attachRounds(cup.grandFinal)
        const attachComp = (c?: TournamentCompetitor) => { const mem = roster(c?.name); if (c && mem) c.members = toMembers(mem).map((m) => ({ name: m.name, ...(m.handle ? { handle: m.handle } : {}) })) }
        attachComp(cup.champion); attachComp(cup.runnerUp); attachComp(cup.thirdPlace)
      }

      return cup
    })
}
