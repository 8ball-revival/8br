/**
 * Archive seasons loader. Reads the generated archive-seasons.json (produced by
 * scripts/build-archive-seasons.py from the read-only CueVerse archive) and adds
 * the current-era placeholder for 2026 S1 (real data pending entry). This is the
 * interim source for the /seasons archive; per the single-source-of-truth rule it
 * will ultimately be computed from the season + cup dataset.
 */
import raw from './data/archive-seasons.json'
import { CURRENT_SEASONS } from './data/current-seasons'
import { VERIFIED_PLAYOFFS } from './data/verified-playoffs'

export interface SeasonSlot {
  name: string
  handle?: string // the ID the player used that season
  seed?: number
  score?: number
}

export interface SeasonMatch {
  a: SeasonSlot | null
  b: SeasonSlot | null
  winner?: 'a' | 'b' | null
  note?: string // e.g. "Walkover", "Forfeit", "CK advanced (DQ)"
}

export interface SeasonRound {
  name: string
  matches: SeasonMatch[]
}

export interface SeasonStandingRow {
  name: string
  handle?: string | null // the ID the player used that season
  advanced?: boolean // reached the playoffs (baby-blue name; #1 shown gold)
  banned?: boolean // banned / withdrew / kicked (red name) — manual status
  played: number
  wins: number
  losses: number
  draws: number
  points: number
}

export interface SeasonGroup {
  letter: string
  rows: SeasonStandingRow[]
}

export interface SeasonDivision {
  division: string // "A", "B", or "single"
  champion: { name: string; handle?: string } | null
  runnerUp: { name: string; handle?: string } | null
  championConfidence: string | null
  bracketReconstructed: boolean
  groups: SeasonGroup[]
  playoff: { rounds: SeasonRound[] } | null // single-elimination bracket
  doubleElim?: { winners: SeasonRound[]; losers: SeasonRound[] } | null // double-elim (e.g. 2026 S1)
  playoffNote?: string // shown when no bracket is available (pending / other format)
}

export interface ArchiveSeason {
  seasonId: string
  year: number
  period: number
  label: string
  divisions: SeasonDivision[]
  pending?: boolean // no structured data yet (awaiting entry)
}

const ARCHIVE = raw as ArchiveSeason[]

// Current-era seasons live outside the historical archive export (manually entered
// until they land in the season/cup dataset). Newest first (2026, then 2014 … 2005).
const ALL: ArchiveSeason[] = [...CURRENT_SEASONS, ...ARCHIVE].sort(
  (a, b) => b.year - a.year || b.period - a.period,
)

// Apply hand-verified playoff brackets over the generated data (pre-2012 seasons
// where the archive had no results). Groups from the archive are preserved.
for (const s of ALL) {
  for (const d of s.divisions) {
    const ov = VERIFIED_PLAYOFFS[`${s.seasonId}:${d.division}`]
    if (ov) {
      d.champion = ov.champion
      d.runnerUp = ov.runnerUp
      d.championConfidence = ov.championConfidence
      d.bracketReconstructed = false
      d.playoff = ov.playoff
      d.doubleElim = null
      d.playoffNote = undefined
    }
  }
}

export function getArchiveYears(): number[] {
  return [...new Set(ALL.map((s) => s.year))].sort((a, b) => b - a)
}

export function getSeasonsByYear(year: number): ArchiveSeason[] {
  return ALL.filter((s) => s.year === year).sort((a, b) => b.period - a.period)
}

export function getAllArchiveSeasons(): ArchiveSeason[] {
  return ALL
}
