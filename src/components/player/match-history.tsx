import Link from 'next/link'
import { Swords } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import type { PreviewCareer, PreviewH2H } from '@/lib/preview-players'
import { formatArchiveSeason, formatPct } from '@/lib/format'

/** Overall record + top head-to-head opponents (archive). Individual match logs
 *  are summarised here; full per-match history awaits import. */
export function MatchHistory({
  career,
  headToHead,
}: {
  career: PreviewCareer | null
  headToHead: PreviewH2H[]
}) {
  return (
    <div className="space-y-6">
      {career && (
        <Card>
          <CardContent className="grid grid-cols-3 gap-6 p-5">
            <div>
              <div className="tabular text-2xl font-semibold">{career.totalWins ?? '—'}</div>
              <div className="text-xs text-muted-foreground">Wins</div>
            </div>
            <div>
              <div className="tabular text-2xl font-semibold">{career.totalLosses ?? '—'}</div>
              <div className="text-xs text-muted-foreground">Losses</div>
            </div>
            <div>
              <div className="tabular text-2xl font-semibold">
                {career.totalWinPct != null ? formatPct(career.totalWinPct / 100) : '—'}
              </div>
              <div className="text-xs text-muted-foreground">Win rate</div>
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="mb-3 font-display text-lg font-semibold">Head-to-head</h3>
        {headToHead.length === 0 ? (
          <EmptyState
            icon={Swords}
            title="Head-to-head records pending verification"
            description="Opponent records will appear here once matches are imported."
          />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Opponent</TableHead>
                  <TableHead className="text-right">Matches</TableHead>
                  <TableHead className="text-right">W–L</TableHead>
                  <TableHead>Last met</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {headToHead.map((h, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">
                      {h.opponentSlug ? (
                        <Link href={`/players/${h.opponentSlug}`} className="transition-colors hover:text-gold">
                          {h.opponent}
                        </Link>
                      ) : (
                        h.opponent
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">{h.matches ?? '—'}</TableCell>
                    <TableCell className="tabular text-right">
                      {h.wins ?? '—'}–{h.losses ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {h.lastSeason ? formatArchiveSeason(h.lastSeason) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
