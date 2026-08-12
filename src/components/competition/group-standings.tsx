import type { Standing, TournamentMatch } from '@prisma/client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MATCH_STATUS_LABEL } from '@/lib/competition/labels'

export interface GroupView {
  id: number
  code: string
  name: string
  standings: Standing[]
  matches: TournamentMatch[]
}

/** Public read-only group panel: ranked standings + fixtures. Consumes published data. */
export function GroupStandings({ group }: { group: GroupView }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-lg">{group.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
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
              <TableRow key={s.id} className={s.qualified ? 'bg-success/5' : undefined}>
                <TableCell className="tabular text-muted-foreground">{s.rank}</TableCell>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-2">
                    {s.username}
                    {s.qualified && <Badge variant="success">Q</Badge>}
                  </span>
                </TableCell>
                <TableCell className="tabular text-right">{s.played}</TableCell>
                <TableCell className="tabular text-right">{s.wins}</TableCell>
                <TableCell className="tabular text-right">{s.losses}</TableCell>
                <TableCell className="tabular text-right">
                  {s.gameDiff > 0 ? `+${s.gameDiff}` : s.gameDiff}
                </TableCell>
                <TableCell className="tabular text-right font-semibold">{s.points}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {group.matches.length > 0 && (
          <div>
            <h4 className="eyebrow mb-3 text-muted-foreground">Fixtures</h4>
            <ul className="divide-y divide-border text-sm">
              {group.matches.map((m) => {
                const decided = m.winnerRegistrationId != null
                const homeWon = m.winnerRegistrationId === m.homeRegistrationId
                return (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <span className={homeWon && decided ? 'font-semibold' : ''}>{m.homeUsername}</span>
                    <span className="shrink-0 tabular text-muted-foreground">
                      {decided && m.homeGames != null ? (
                        <span className="font-medium text-foreground">
                          {m.homeGames} – {m.awayGames}
                        </span>
                      ) : (
                        <Badge variant="muted">{MATCH_STATUS_LABEL[m.status]}</Badge>
                      )}
                    </span>
                    <span className={!homeWon && decided ? 'font-semibold text-right' : 'text-right'}>
                      {m.awayUsername}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
