import { Badge } from '@/components/ui/badge'
import type { ConfidenceLevel } from '@/lib/preview-competitions'

const CONFIG: Record<ConfidenceLevel, { label: string; variant: React.ComponentProps<typeof Badge>['variant'] }> = {
  explicit: { label: 'Explicit', variant: 'success' },
  verified: { label: 'Verified', variant: 'success' },
  reconstructed: { label: 'Reconstructed', variant: 'muted' },
  heuristic: { label: 'Heuristic', variant: 'muted' },
  incomplete: { label: 'Incomplete', variant: 'muted' },
  disputed: { label: 'Disputed', variant: 'destructive' },
  unknown: { label: 'Unknown', variant: 'outline' },
}

/** Consistent archive-confidence pill. Never hides uncertainty. */
export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const c = CONFIG[level] ?? CONFIG.unknown
  return <Badge variant={c.variant}>{c.label}</Badge>
}
