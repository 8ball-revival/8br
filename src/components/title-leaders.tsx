import Link from 'next/link'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getPlayerIndex } from '@/lib/preview-players'

/**
 * Historical title leaders from the 8BRCAM archive (real championship counts).
 * This is NOT a current 8 Ball Revival ranking — label it as historical wherever used.
 */
export function TitleLeaders({ limit }: { limit?: number }) {
  const rows = getPlayerIndex().filter((p) => p.titles > 0)
  const shown = limit ? rows.slice(0, limit) : rows

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">#</TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="text-right">Titles</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((p, i) => (
            <TableRow key={p.slug}>
              <TableCell className="tabular font-medium text-muted-foreground">{i + 1}</TableCell>
              <TableCell>
                <Link href={`/players/${p.slug}`} className="font-medium transition-colors hover:text-gold">
                  {p.handle}
                </Link>
              </TableCell>
              <TableCell className="tabular text-right font-semibold">{p.titles}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
