import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { GroupCrossTable } from '@/components/competition/group-cross-table'
import type { PublicGroupView } from '@/lib/competition/public'

/**
 * Public read-only group panel. Shows the staff-created group exactly: the seeded
 * roster (before any play) or the live standings (once results exist), plus the
 * fixtures. Every name is the entrant's public display identity — never an account
 * User ID, email, or other private field.
 */
export function PublicGroupCard({ group }: { group: PublicGroupView }) {
  // Once fixtures exist (group published), show the classic cross-table grid with
  // frozen standings. Before fixtures exist, fall back to the seeded roster.
  if (group.fixtures.length > 0) return <GroupCrossTable group={group} />

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-lg">{group.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {group.hasResults ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">P</TableHead>
                <TableHead className="text-right">W</TableHead>
                <TableHead className="text-right">L</TableHead>
                <TableHead className="text-right">Diff</TableHead>
                <TableHead className="text-right">Pts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.standings.map((s) => (
                <TableRow key={s.registrationId} className={s.qualified ? 'bg-success/5' : undefined}>
                  <TableCell className="tabular text-muted-foreground">{s.rank}</TableCell>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {s.displayName}
                      {s.qualified && <Badge variant="success">Q</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="tabular text-right">{s.played}</TableCell>
                  <TableCell className="tabular text-right">{s.wins}</TableCell>
                  <TableCell className="tabular text-right">{s.losses}</TableCell>
                  <TableCell className="tabular text-right">{s.gameDiff > 0 ? `+${s.gameDiff}` : s.gameDiff}</TableCell>
                  <TableCell className="tabular text-right font-semibold">{s.points}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {group.players.map((p, i) => (
              <li key={p.registrationId} className="flex items-baseline gap-2">
                <span className="tabular w-5 text-xs text-muted-foreground">{i + 1}.</span>
                <span className="font-medium text-foreground">{p.displayName}</span>
                {p.cueverseId && <span className="text-xs text-muted-foreground">({p.cueverseId})</span>}
              </li>
            ))}
          </ol>
        )}

        {group.fixtures.length > 0 && (
          <div>
            <h4 className="eyebrow mb-3 text-muted-foreground">Fixtures</h4>
            <ul className="divide-y divide-border text-sm">
              {group.fixtures.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <span className={m.decided && m.winner === 'home' ? 'font-semibold' : ''}>{m.homeName}</span>
                  <span className="shrink-0 tabular text-muted-foreground">
                    {m.decided && m.homeGames != null ? (
                      <span className="font-medium text-foreground">{m.homeGames} – {m.awayGames}</span>
                    ) : (
                      <Badge variant="muted">Scheduled</Badge>
                    )}
                  </span>
                  <span className={m.decided && m.winner === 'away' ? 'text-right font-semibold' : 'text-right'}>{m.awayName}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
