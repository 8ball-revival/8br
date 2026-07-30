import { LineChart } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'

/**
 * Ranking history over time. The archive has no time-series ranking snapshots, so
 * this shows an honest pending state. Prepared for future RankingSnapshot data.
 */
export function RankingHistory() {
  return (
    <EmptyState
      icon={LineChart}
      title="Ranking history not yet available"
      description="Time-series ranking snapshots are not part of the archive. They will appear here once the 8 Ball Revival ranking system is defined and computed."
    />
  )
}
