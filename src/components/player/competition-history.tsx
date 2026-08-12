import { CalendarRange } from 'lucide-react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { PreviewSeason } from '@/lib/preview-players'
import { formatArchiveSeason, formatDivision } from '@/lib/format'

/** Per-season participation from the archive. These are HISTORICAL archive seasons
 *  (not 8 Ball Revival seasons) and are labelled as such. */
export function CompetitionHistory({ seasons }: { seasons: PreviewSeason[] }) {
  if (seasons.length === 0) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Competition history pending verification"
        description="Season-by-season participation will appear here once verified."
      />
    )
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Historical archive seasons (8BRCAM) — distinct from the 8 Ball Revival chronology.
      </p>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Season</TableHead>
              <TableHead>Division</TableHead>
              <TableHead>Group</TableHead>
              <TableHead className="text-right">Group W–L</TableHead>
              <TableHead>Playoffs</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {seasons.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{formatArchiveSeason(s.seasonId)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDivision(s.division)}</TableCell>
                <TableCell className="text-muted-foreground">{s.groupLetter ?? '—'}</TableCell>
                <TableCell className="tabular text-right">
                  {s.groupWins ?? '—'}–{s.groupLosses ?? '—'}
                </TableCell>
                <TableCell>
                  {s.madePlayoffs ? (
                    <Badge variant="outline">
                      {s.playoffSeed != null ? `Seed ${s.playoffSeed}` : 'Qualified'}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{s.result ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
