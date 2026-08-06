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
import { scrubForPublic } from '@/lib/stats/identity'

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

export interface SeasonGroupMatch {
  a: { name: string; handle?: string | null }
  b: { name: string; handle?: string | null }
  scoreA: number | null
  scoreB: number | null
  winner?: 'a' | 'b' | null // null = draw or unplayed
}

export interface SeasonGroup {
  letter: string
  rows: SeasonStandingRow[]
  matches?: SeasonGroupMatch[] // individual group-stage results (for the deep-dive)
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

// PUBLIC identity scrub: records belonging to Neo render only as "Neo / Starkiller"
// (old handles hidden). Applied at the loader so every consumer — pages AND the
// stats services — sees the canonical identity; source JSON keeps provenance.
function scrubSlot(s: { name?: string | null; handle?: string | null } | null | undefined) {
  if (!s || !s.name) return
  const p = scrubForPublic(s.handle, s.name)
  s.name = p.name
  if (p.handle !== undefined) s.handle = p.handle
  else delete (s as { handle?: string | null }).handle
}
for (const s of ALL) {
  for (const d of s.divisions) {
    scrubSlot(d.champion)
    scrubSlot(d.runnerUp)
    for (const g of d.groups ?? []) for (const r of g.rows) scrubSlot(r)
    for (const r of d.playoff?.rounds ?? []) for (const m of r.matches) { scrubSlot(m.a); scrubSlot(m.b) }
    if (d.doubleElim)
      for (const br of [d.doubleElim.winners, d.doubleElim.losers])
        for (const r of br) for (const m of r.matches) { scrubSlot(m.a); scrubSlot(m.b) }
  }
}

// ============================================================================
// TWO AUDIENCES, TWO SURFACES
// ----------------------------------------------------------------------------
// The historical archive is NOT globally disabled. It remains a first-class input
// to the statistics that are historical BY DESIGN — Rankings (Current / Historical /
// All-Time), Hall of Fame, player careers, records, head-to-head. Those consume the
// FULL set (`getAllArchiveSeasons` and the year getters below).
//
// What changed is only the MAIN /seasons page, which is a forward-looking surface: it
// should list the current-era season(s) (2026 Season 1) plus — in Phase 2 — live DB
// seasons, and should NOT be cluttered by the older 2005–2014 archive. That narrower
// set is exposed separately via `getCurrentEraSeasons*` (backed by CURRENT_SEASONS,
// i.e. everything NOT sourced from the historical archive-seasons.json export).
// ============================================================================

// ---- FULL archive (Rankings, Hall of Fame, careers, records, H2H) ----------
export function getArchiveYears(): number[] {
  return [...new Set(ALL.map((s) => s.year))].sort((a, b) => b - a)
}

export function getSeasonsByYear(year: number): ArchiveSeason[] {
  return ALL.filter((s) => s.year === year).sort((a, b) => b.period - a.period)
}

export function getAllArchiveSeasons(): ArchiveSeason[] {
  return ALL
}

// ---- Current-era only (the forward-looking public /seasons page) -----------
// CURRENT_SEASONS holds the manually-entered current-era seasons (today: 2026 S1);
// the older historical seasons come from ARCHIVE and are intentionally excluded here.
// (Phase 2 will merge live `comp_season` DB seasons into this same surface.)
export function getCurrentEraSeasonYears(): number[] {
  return [...new Set(CURRENT_SEASONS.map((s) => s.year))].sort((a, b) => b - a)
}

export function getCurrentEraSeasonsByYear(year: number): ArchiveSeason[] {
  return CURRENT_SEASONS.filter((s) => s.year === year).sort((a, b) => b.period - a.period)
}
