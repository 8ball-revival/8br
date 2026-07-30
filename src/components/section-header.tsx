import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Section heading used across pages: optional eyebrow, title, description, a
 * right-aligned "view all" link, and an optional "Sample" marker for temp data.
 */
export function SectionHeader({
  eyebrow,
  title,
  description,
  actionHref,
  actionLabel = 'View all',
  sample = false,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  actionHref?: string
  actionLabel?: string
  sample?: boolean
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div>
        {eyebrow && <p className="eyebrow mb-2 text-gold">{eyebrow}</p>}
        <div className="flex items-center gap-3">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
          {sample && <Badge variant="muted">Sample</Badge>}
        </div>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actionHref && (
        <Link
          href={actionHref}
          className="inline-flex items-center gap-1 text-sm font-medium text-gold transition-colors hover:text-gold-soft"
        >
          {actionLabel}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  )
}
