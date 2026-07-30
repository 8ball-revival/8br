import { Users } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { GroupData } from '@/lib/mock-data'

/** A group roster card (participants in one group/pool). */
export function GroupCard({ group }: { group: GroupData }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{group.name}</CardTitle>
          <Badge variant="muted">
            <Users className="size-3" aria-hidden /> {group.roster.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="space-y-1.5 text-sm">
          {group.roster.map((name, i) => (
            <li key={`${name}-${i}`} className="flex items-center gap-2">
              <span className="tabular w-5 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
              <span className="font-medium">{name}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
