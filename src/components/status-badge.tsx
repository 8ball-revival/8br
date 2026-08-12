import { Badge } from '@/components/ui/badge'
import { STATUS_LABEL, type CompetitionStatus } from '@/lib/mock-data'

const VARIANT: Record<CompetitionStatus, React.ComponentProps<typeof Badge>['variant']> = {
  upcoming: 'muted',
  registration: 'gold',
  in_progress: 'success',
  completed: 'outline',
}

/** Consistent competition/tournament status pill. */
export function StatusBadge({ status }: { status: CompetitionStatus }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
}
