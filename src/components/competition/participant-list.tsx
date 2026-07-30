import { Users } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'

/** Participant roster (archive names). Shows an honest empty state when unavailable. */
export function ParticipantList({ participants }: { participants: string[] }) {
  if (participants.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Participant list incomplete"
        description="The full participant list is not yet available for this competition."
      />
    )
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">{participants.length} participants recorded.</p>
      <div className="flex flex-wrap gap-2">
        {participants.map((name, i) => (
          <span
            key={`${name}-${i}`}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-sm"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}
