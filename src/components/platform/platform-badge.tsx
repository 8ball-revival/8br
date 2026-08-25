import { cn } from '@/lib/utils'
import type { CompetitionPlatform } from '@prisma/client'

/**
 * Which platform a record belongs to, said quietly.
 *
 * ── Why a wordmark and not a logo ────────────────────────────────────────────────────────────────
 * No logo asset exists in the repository, and inventing one — or reproducing a third party's mark
 * from memory — would put a wrong Yahoo logo on a page about somebody's history. A wordmark carries
 * the same information, is legible at this size, needs no image request, and is trivially replaced:
 * drop a transparent asset in and swap the span for it, keeping these dimensions.
 *
 * ── Restrained on purpose ────────────────────────────────────────────────────────────────────────
 * It sits at the far right of a card and is the least prominent thing on it. A Season is identified
 * by its title, its champion and its status; the platform is context for those, not a heading. So:
 * no filled background, no platform colour, one hairline border, uppercase micro-type.
 */
export function PlatformBadge({
  platform,
  className,
}: {
  platform: CompetitionPlatform
  className?: string
}) {
  const yahoo = platform === 'YAHOO'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded border px-1.5 py-0.5',
        'text-[0.6rem] font-semibold uppercase tracking-[0.1em] leading-none',
        'border-border text-muted-foreground',
        className,
      )}
      title={yahoo ? 'Played on Yahoo — historical archive' : 'Played on CueVerse'}
    >
      {yahoo ? 'Yahoo' : 'CueVerse'}
    </span>
  )
}

/**
 * A Division that records history but ranks nothing.
 *
 * Division B is preserved in full — entrants, groups, matches, playoffs, champions — and none of it
 * reaches a ladder. Without a marker the only way to discover that is to notice that its players
 * have no rating, which reads as missing data rather than as a rule.
 */
export function UnrankedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded border px-1.5 py-0.5',
        'text-[0.6rem] font-semibold uppercase tracking-[0.1em] leading-none',
        'border-[var(--warning)]/40 text-[var(--warning)]',
        className,
      )}
      title="Division B is recorded in full but does not contribute to any ranking"
    >
      Unranked Division
    </span>
  )
}

/**
 * A division, labelled once.
 *
 * The two archives disagree about what a division code is. Yahoo's Seasons store `A` and `B`, so a
 * label has to supply the word "Division"; a Season created on CueVerse stores the whole phrase
 * `Division A`, so supplying it again reads "Division Division A". Prefixing here rather than at
 * each display site means a third convention only has to be handled in one place -- and normalising
 * the stored values instead would mean rewriting canonical rows to fix a caption.
 */
export function divisionLabel(code: string): string {
  return /^division/i.test(code.trim()) ? code.trim() : `Division ${code.trim()}`
}
