import Link from 'next/link'
import { cn } from '@/lib/utils'
import { identityLines, identityText, type IdentityInput } from '@/lib/identity/display'

/**
 * A competitor's name, rendered the same way everywhere: CueVerse ID first, preferred name beneath.
 *
 * See `@/lib/identity/display` for why the ID leads. This component is the only thing that should
 * decide how those two lines look, so a change to the house style is a change to one file.
 *
 * Plain markup and no client hooks, so it drops into server and client components alike.
 */
export function PlayerName({
  identity,
  href,
  className,
  size = 'md',
  inline = false,
  emphasis = 'strong',
}: {
  identity: IdentityInput | null | undefined
  /** Profile link for the primary line. Omitted for entrants with no public profile. */
  href?: string | null
  className?: string
  /** `sm` for dense tables and brackets, `md` for lists, `lg` for headings. */
  size?: 'sm' | 'md' | 'lg'
  /** One line (`ID (Preferred Name)`) for tight spots like dropdown options and inline prose. */
  inline?: boolean
  /** `plain` drops the bolding, for places where the surrounding row already carries the weight. */
  emphasis?: 'strong' | 'plain'
}) {
  const { primary, secondary } = identityLines(identity)

  if (inline) {
    const text = identityText(identity)
    const body = <span className={cn(emphasis === 'strong' && 'font-medium', className)}>{text}</span>
    return href ? <Link href={href} className="hover:text-brand hover:underline">{body}</Link> : body
  }

  const primarySize = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-base' : 'text-sm'
  const secondarySize = size === 'lg' ? 'text-xs' : 'text-[0.7rem]'

  // The full identity as a tooltip, so a truncated cell is still readable on hover.
  const full = identityText(identity)
  const primaryEl = (
    <span className={cn('block truncate', primarySize, emphasis === 'strong' && 'font-medium')}>{primary}</span>
  )

  return (
    <span title={full} className={cn('block min-w-0', className)}>
      {href ? (
        <Link href={href} className="block min-w-0 hover:text-brand hover:underline">{primaryEl}</Link>
      ) : (
        primaryEl
      )}
      {secondary && (
        <span className={cn('block truncate italic leading-tight text-muted-foreground', secondarySize)}>
          {secondary}
        </span>
      )}
    </span>
  )
}
