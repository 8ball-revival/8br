'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowBigUp, ArrowBigDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { castVoteAction } from '@/lib/break/vote-actions'

/**
 * Up / score / down.
 *
 * ── Optimistic, with a real rollback ─────────────────────────────────────────────────────────────
 * The number moves the instant it is clicked, because waiting for a round trip to acknowledge a
 * click makes voting feel broken. What matters is what happens when the server disagrees: the
 * previous state is captured before the guess, and restored on failure — so a refused vote leaves
 * the display telling the truth rather than a number that only exists in this tab.
 *
 * ── Keyboard and screen readers ──────────────────────────────────────────────────────────────────
 * Real buttons, so they are reachable and operable by keyboard without any handler of ours. The
 * pressed state is `aria-pressed`, and the label says what the button does AND the current score,
 * because colour alone is not a state anybody can hear.
 */
export function VoteControl({
  target,
  id,
  score,
  viewerVote,
  signedIn,
  returnTo,
  compact = false,
  hideScore = false,
}: {
  target: 'post' | 'comment'
  id: number
  score: number
  /** 1, -1, 0, or null when signed out. */
  viewerVote: number | null
  signedIn: boolean
  /** Where to come back to after signing in. */
  returnTo: string
  compact?: boolean
  /** Scores can be hidden for an initial period. The voter still sees their OWN vote. */
  hideScore?: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [optimistic, setOptimistic] = useState<{ score: number; vote: number } | null>(null)

  const currentVote = optimistic?.vote ?? viewerVote ?? 0
  const currentScore = optimistic?.score ?? score

  function vote(direction: 1 | -1) {
    if (!signedIn) {
      // Sign in, then come back to exactly where they were.
      router.push(`/login?next=${encodeURIComponent(returnTo)}`)
      return
    }

    // Clicking the vote you already have removes it.
    const next = currentVote === direction ? 0 : direction
    const previous = { score: currentScore, vote: currentVote }
    setOptimistic({ score: currentScore - currentVote + next, vote: next })

    startTransition(async () => {
      const result = await castVoteAction({ target, id, value: next })
      if (!result.ok) {
        // The server refused. Put back what was really there.
        setOptimistic(previous)
        return
      }
      // Adopt the authoritative numbers rather than keeping the guess.
      setOptimistic({ score: result.score ?? previous.score, vote: result.viewerVote ?? next })
    })
  }

  const size = compact ? 'size-4' : 'size-5'
  const label = (dir: 'Upvote' | 'Downvote') =>
    `${dir}${hideScore ? '' : `, currently ${currentScore}`}${currentVote !== 0 ? `, you ${currentVote === 1 ? 'upvoted' : 'downvoted'}` : ''}`

  return (
    <div className={cn('flex flex-col items-center', compact ? 'gap-0' : 'gap-0.5')}>
      <button
        type="button"
        onClick={() => vote(1)}
        aria-pressed={currentVote === 1}
        aria-label={label('Upvote')}
        className={cn(
          'grid place-items-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60',
          // A comfortable target on a phone; the icon stays small.
          compact ? 'size-7' : 'size-8',
          currentVote === 1 ? 'text-[var(--gold)]' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <ArrowBigUp className={cn(size, currentVote === 1 && 'fill-current')} aria-hidden />
      </button>

      <span
        className={cn(
          'tabular-nums font-semibold',
          compact ? 'text-[0.7rem]' : 'text-xs',
          currentVote === 1 ? 'text-[var(--gold)]' : currentVote === -1 ? 'text-[var(--loss)]' : 'text-foreground',
        )}
        // The number is announced by the buttons' labels; repeating it here would say it twice.
        aria-hidden
      >
        {hideScore ? '·' : currentScore}
      </span>

      <button
        type="button"
        onClick={() => vote(-1)}
        aria-pressed={currentVote === -1}
        aria-label={label('Downvote')}
        className={cn(
          'grid place-items-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60',
          compact ? 'size-7' : 'size-8',
          currentVote === -1 ? 'text-[var(--loss)]' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <ArrowBigDown className={cn(size, currentVote === -1 && 'fill-current')} aria-hidden />
      </button>
    </div>
  )
}
