/**
 * Archive-wide totals from the local 8BRCAM snapshot (read-only). Real counts,
 * used only as preview statistics — clearly labelled as archive/historical, never
 * presented as 8 Ball Revival-chronology figures.
 */
import statsData from './preview-data/archive-stats.json'

export interface ArchiveStats {
  players: number
  aliases: number
  matches: number
  seasons: number
  seasonDivisions: number
}

export function getArchiveStats(): ArchiveStats {
  return statsData as ArchiveStats
}
