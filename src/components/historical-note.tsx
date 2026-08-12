import { ScrollText } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Restrained, reusable annotation for historical/administrative context (e.g. the
 * 8 Ball Revival Season 1 seeding review). Visually distinct but deliberately NOT sensationalized:
 * a muted gold-bordered panel, neutral wording, no alarm styling.
 */
export function HistoricalNote({
  title = 'Historical note',
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <aside
      className={cn(
        'flex gap-3 rounded-lg border border-gold/25 bg-gold/[0.05] p-4 text-sm',
        className,
      )}
      role="note"
    >
      <ScrollText className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
      <div>
        <p className="font-medium text-gold">{title}</p>
        <p className="mt-1 text-muted-foreground">{children}</p>
      </div>
    </aside>
  )
}
