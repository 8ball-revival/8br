/**
 * COMPETITION PREVIEW DATA — curated, read-only snapshot from the local 8BRCAM
 * archive (src/lib/preview-data/archive-competitions.json). Frontend preview only;
 * NOT a Prisma connection or the import pipeline. These are REAL historical archive
 * competitions (8BRCAM seasons), pending 8 Ball Revival verification — they are explicitly NOT
 * part of the 8 Ball Revival chronology. Nothing is fabricated: where the archive lacks data
 * (e.g. playoff match results), the UI shows honest pending/incomplete states.
 *
 * Reuses the season data shapes (GroupData, PlayoffData, SeasonSourceRef) so the
 * existing season components render this data without duplication.
 */
import competitionsData from './preview-data/archive-competitions.json'
import type {
  Competition,
  CompetitionStatus,
  GroupData,
  PlayoffData,
  SeasonSourceRef,
} from './mock-data'

export type ConfidenceLevel =
  | 'explicit'
  | 'verified'
  | 'reconstructed'
  | 'heuristic'
  | 'incomplete'
  | 'disputed'
  | 'unknown'

export interface StageInfo {
  name: string
  format: string
  confidence: ConfidenceLevel
  note: string | null
}

export interface ChampionInfo {
  name: string
  playerId: string | null
  slug: string | null
  confidence: ConfidenceLevel
  inferred: boolean
}

export interface RunnerUpInfo {
  name: string
  playerId: string | null
  slug: string | null
}

export interface CompetitionPreview {
  slug: string
  competitionId: string
  seasonId: string
  division: string
  name: string
  legacyName: string
  type: 'Season' | 'Cup' | 'Tournament' | 'Invitational'
  chronology: 'archive' | 'ego'
  status: CompetitionStatus
  year: number | null
  dateLabel: string | null
  datesPending: boolean
  organizer: string
  formatSummary: string | null
  participantsCount: number | null
  confidence: ConfidenceLevel
  champion: ChampionInfo | null
  runnerUp: RunnerUpInfo | null
  overviewNote: string | null
  participants: string[]
  stages: StageInfo[]
  groups: GroupData[]
  totalGroupMatches: number
  shownGroupMatches: number
  playoff: PlayoffData
  sources: SeasonSourceRef[]
  historicalNotes: string[]
}

const COMPETITIONS = competitionsData as unknown as CompetitionPreview[]

export const COMPETITION_PREVIEW_SOURCE =
  '8BRCAM archive (imported snapshot) — pending 8 Ball Revival source verification'

export function getCompetitionPreviewSlugs(): string[] {
  return COMPETITIONS.map((c) => c.slug)
}

export function getCompetitionPreview(slug: string): CompetitionPreview | undefined {
  return COMPETITIONS.find((c) => c.slug === slug)
}

export interface CompetitionSearchHit {
  slug: string
  name: string
  legacyName: string
}

/** Case-insensitive search over competition name, legacy name, and season id. */
export function searchCompetitions(query: string): CompetitionSearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return COMPETITIONS.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.legacyName.toLowerCase().includes(q) ||
      c.seasonId.toLowerCase().includes(q),
  ).map((c) => ({ slug: c.slug, name: c.name, legacyName: c.legacyName }))
}

/** Archive competition previews mapped to the shared CompetitionCard shape. */
export function getArchiveCompetitionIndex(): Competition[] {
  return COMPETITIONS.map((c) => ({
    slug: c.slug,
    name: c.name,
    type: 'Season',
    status: c.status,
    date: c.dateLabel ?? String(c.year ?? ''),
    format: c.formatSummary ?? 'Format pending verification',
  }))
}
