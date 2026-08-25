'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { deletePostAction } from '@/lib/break/post-actions'

/**
 * Edit and delete, for whoever is entitled to them.
 *
 * ── Why a menu and not a banner ──────────────────────────────────────────────────────────────────
 * A reader looking at a post should see the post. An admin bar across the top, or a "manage this in
 * the admin area" strip, changes what the page IS for the one person most likely to be checking how
 * it reads to everybody else. Two items behind a three-dot button are enough to be found and small
 * enough to ignore.
 *
 * ── This control is not the permission ───────────────────────────────────────────────────────────
 * It is drawn when the server says the viewer may manage the post, and that is a courtesy. The
 * server action resolves the actor from the session and the canonical service checks again inside
 * its transaction, so removing this component would change nothing about who can delete what.
 */
export function PostManageMenu({
  postId,
  slug,
  title,
  authorLabel,
  commentCount,
  returnTo = '/the-break',
}: {
  postId: number
  slug: string
  title: string
  /** The author, as the reader sees them — CueVerse ID first. */
  authorLabel: string
  commentCount: number
  returnTo?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const wrapRef = useRef<HTMLDivElement>(null)

  // Escape closes, an outside click closes. Both restore nothing else about the page.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  function remove() {
    setError(null)
    startTransition(async () => {
      const r = await deletePostAction(postId)
      if (!r.ok) { setError(r.error ?? 'That could not be deleted.'); return }
      setConfirming(false)
      router.push(returnTo)
      router.refresh()
    })
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Manage this post"
        data-testid="post-manage-trigger"
        className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Post management"
          className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); router.push(`/the-break/${slug}/edit`) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-white/[0.06]"
          >
            <Pencil className="size-3.5" aria-hidden /> Edit Post
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); setConfirming(true) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/[0.08]"
          >
            <Trash2 className="size-3.5" aria-hidden /> Delete Post
          </button>
        </div>
      )}

      {confirming && (
        /*
         * The dialog states the thing being deleted rather than asking "are you sure?".
         *
         * Somebody managing a feed has several posts open and the titles are similar. Naming the
         * post, its author and how many replies go quiet with it is what makes the confirmation a
         * decision instead of a reflex.
         */
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-post-title"
            className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
          >
            <h2 id="delete-post-title" className="text-base font-semibold text-foreground">Delete this post?</h2>

            <dl className="mt-3 space-y-1 rounded-md border border-border bg-background/50 p-3 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Title</dt>
                <dd className="min-w-0 flex-1 font-medium text-foreground">{title}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Author</dt>
                <dd className="min-w-0 flex-1 text-foreground">{authorLabel}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">Replies</dt>
                <dd className="min-w-0 flex-1 text-foreground">{commentCount}</dd>
              </div>
            </dl>

            <p className="mt-3 text-sm text-muted-foreground">
              It will disappear from The Break, from search, from the homepage and from
              {' '}{authorLabel}&apos;s profile, and its {commentCount === 1 ? 'reply' : 'replies'} will
              no longer be readable. The post is withdrawn rather than destroyed, so this can be undone.
            </p>

            {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setConfirming(false); setError(null) }}
                disabled={pending}
                className="rounded-md border border-input px-3 py-1.5 text-sm text-foreground hover:bg-white/[0.06] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                data-testid="confirm-delete-post"
                className={cn(
                  'rounded-md bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground',
                  'hover:opacity-90 disabled:opacity-50',
                )}
              >
                {pending ? 'Deleting…' : 'Delete Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
