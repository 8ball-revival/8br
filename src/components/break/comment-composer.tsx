'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { cn } from '@/lib/utils'
import { addCommentAction } from '@/lib/break/comment-actions'

/**
 * Writing a comment or a reply.
 *
 * Plain text for now, converted to the site's rich-text document server-side. The editor that
 * handles formatting and pasted media is a separate piece of work; this deliberately does the thing
 * it can do properly rather than presenting controls that do not work yet.
 */
export function CommentComposer({
  postId,
  parentId,
  onDone,
  compact = false,
}: {
  /** Zero when replying: the server resolves the post from the parent, which cannot be spoofed. */
  postId: number
  parentId: number | null
  onDone?: () => void
  compact?: boolean
}) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body) { setError('Say something first.'); return }
    setError(null)

    startTransition(async () => {
      const result = await addCommentAction({ postId, parentId, text: body })
      if (!result.ok) { setError(result.error ?? 'That did not save.'); return }
      setText('')
      onDone?.()
      // The server owns the tree; refreshing is what puts the new comment in its sorted place.
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className={cn('mb-4', compact && 'mb-0')}>
      <label className="sr-only" htmlFor={`comment-${parentId ?? 'root'}`}>
        {parentId ? 'Write a reply' : 'Write a comment'}
      </label>
      <textarea
        id={`comment-${parentId ?? 'root'}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={compact ? 3 : 4}
        maxLength={10_000}
        placeholder={parentId ? 'Write a reply…' : 'Add a comment…'}
        className="w-full resize-y rounded border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      />
      {error && <p role="alert" className="mt-1 text-xs text-[var(--loss)]">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || text.trim().length === 0}
          className="rounded-full bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          {pending ? 'Posting…' : parentId ? 'Reply' : 'Comment'}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
