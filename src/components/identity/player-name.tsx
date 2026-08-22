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

  /*
   * Gold for the handle, neutral for the name.
   *
   * The two lines are one identity in two registers. Gold carries the CueVerse ID because that is
   * the half that tells competitors apart, and the Preferred Name sits under it in plain light text.
   */
  const primarySize = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-base' : 'text-sm'
  const secondarySize = size === 'lg' ? 'text-xs' : 'text-[0.7rem]'

  // The full identity as a tooltip, so a truncated cell is still readable on hover.
  const full = identityText(identity)
  const primaryEl = (
    <span
      className={cn(
        'block truncate',
        primarySize,
        emphasis === 'strong' ? 'font-semibold text-[var(--gold)]' : 'font-medium text-foreground',
      )}
    >
      {primary}
    </span>
  )

  return (
    <span title={full} className={cn('block min-w-0', className)}>
      {href ? (
        <Link href={href} className="block min-w-0 hover:text-brand hover:underline">{primaryEl}</Link>
      ) : (
        primaryEl
      )}
      {/*
        The handle is not an aside.
        It was italic and muted, which read as a footnote to the name. It is the half that tells two
        people called Chris apart, so it renders in plain light text at full legibility.
      */}
      {secondary && (
        <span className={cn('block truncate leading-tight text-foreground/70', secondarySize)}>
          {secondary}
        </span>
      )}
    </span>
  )
}
