import Link from 'next/link'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RankingRow } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

function Movement({ value }: { value: number }) {
  if (value === 0) return <span className="inline-flex items-center text-muted-foreground"><Minus className="size-3.5" /></span>
  const up = value > 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 tabular text-xs', up ? 'text-success' : 'text-destructive')}>
      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      {Math.abs(value)}
    </span>
  )
}

export function RankingTable({ rows, className }: { rows: RankingRow[]; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border', className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12">#</TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="text-right">Points</TableHead>
            <TableHead className="w-16 text-right">Move</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.rank}>
              <TableCell className="tabular font-medium text-muted-foreground">{row.rank}</TableCell>
              <TableCell>
                <Link href={`/players/${row.playerSlug}`} className="font-medium transition-colors hover:text-gold">
                  {row.playerHandle}
                </Link>
              </TableCell>
              <TableCell className="tabular text-right font-medium">{row.points.toLocaleString('en-US')}</TableCell>
              <TableCell className="text-right">
                <Movement value={row.movement} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
