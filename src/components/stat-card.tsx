import type { LucideIcon } from 'lucide-react'

import { Card } from '@/components/ui/card'
import type { Stat } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

/** Compact KPI tile. Value uses tabular mono figures for alignment. */
export function StatCard({ stat, icon: Icon, className }: { stat: Stat; icon?: LucideIcon; className?: string }) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="tabular text-3xl font-semibold tracking-tight">{stat.value}</div>
          <div className="mt-1 text-sm font-medium">{stat.label}</div>
          {stat.hint && <div className="mt-0.5 text-xs text-muted-foreground">{stat.hint}</div>}
        </div>
        {Icon && <Icon className="size-5 text-gold" aria-hidden />}
      </div>
    </Card>
  )
}
