import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { StandingRowData } from '@/lib/mock-data'

function num(v: number | null) {
  return v == null ? <span className="text-muted-foreground">—</span> : v
}

function signed(v: number | null) {
  if (v == null) return <span className="text-muted-foreground">—</span>
  return v > 0 ? `+${v}` : v
}

/** Ranked group standings. Scrolls horizontally on small screens (via Table). */
export function StandingsTable({ rows }: { rows: StandingRowData[] }) {
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">#</TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="text-right">P</TableHead>
            <TableHead className="text-right">W</TableHead>
            <TableHead className="text-right">L</TableHead>
            <TableHead className="text-right">+/−</TableHead>
            <TableHead className="text-right">Pts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={`${r.name}-${i}`}>
              <TableCell className="tabular text-muted-foreground">{r.pos ?? '—'}</TableCell>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell className="tabular text-right">{num(r.played)}</TableCell>
              <TableCell className="tabular text-right">{num(r.wins)}</TableCell>
              <TableCell className="tabular text-right">{num(r.losses)}</TableCell>
              <TableCell className="tabular text-right">{signed(r.diff)}</TableCell>
              <TableCell className="tabular text-right font-semibold">{num(r.points)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
