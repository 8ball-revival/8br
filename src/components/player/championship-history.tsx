import { Trophy } from 'lucide-react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import type { ChampionshipConfidence, PreviewChampionship } from '@/lib/preview-players'
import { formatArchiveSeason, formatDivision } from '@/lib/format'

const CONFIDENCE_LABEL: Record<ChampionshipConfidence, string> = {
  explicit: 'Explicit',
  heuristic: 'Heuristic',
  reconstructed: 'Reconstructed',
  unknown: 'Unknown',
}

function ConfidenceBadge({ c }: { c: ChampionshipConfidence }) {
  return <Badge variant={c === 'explicit' ? 'success' : 'muted'}>{CONFIDENCE_LABEL[c]}</Badge>
}

/** Championship / runner-up finishes from the archive, with source confidence. */
export function ChampionshipHistory({ championships }: { championships: PreviewChampionship[] }) {
  if (championships.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No championship records in archive preview"
        description="Championship finishes will appear here once verified."
      />
    )
  }
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Season</TableHead>
            <TableHead>Division</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {championships.map((c, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium">{formatArchiveSeason(c.seasonId)}</TableCell>
              <TableCell className="text-muted-foreground">{formatDivision(c.division)}</TableCell>
              <TableCell>
                {c.result === 'champion' ? (
                  <Badge variant="gold">
                    <Trophy className="size-3" aria-hidden /> Champion
                  </Badge>
                ) : (
                  <Badge variant="muted">Runner-up</Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <ConfidenceBadge c={c.confidence} />
                  {c.bracketReconstructed && (
                    <span className="text-xs text-muted-foreground">bracket reconstructed</span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
