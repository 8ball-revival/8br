import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Consistent empty state for pages/sections with no data yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'cyber-clip flex flex-col items-center justify-center rounded-none border border-dashed border-[var(--neon-line)] bg-card/40 px-6 py-14 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="cyber-clip-sm mb-4 flex size-12 items-center justify-center rounded-none border border-[var(--neon-line)] bg-muted text-[var(--neon-cyan)] [box-shadow:var(--glow-soft)]">
          <Icon className="size-6" aria-hidden />
        </div>
      )}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
