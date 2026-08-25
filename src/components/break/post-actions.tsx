'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bookmark, BookmarkCheck, Share2, Flag, Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import { toggleSaveAction } from '@/lib/break/save-actions'

/**
 * Save, share and report.
 *
 * These sit beside the card's link rather than inside it, so a tap on one of them acts instead of
 * navigating. Signed-out visitors still SEE them — hiding a control teaches nothing, whereas a
 * prompt that explains and then returns them to the same post is how somebody discovers the account
 * is worth having.
 */
export function PostActions({
  postId,
  slug,
  saved,
  signedIn,
}: {
  postId: number
  slug: string
  saved: boolean
  signedIn: boolean
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [isSaved, setIsSaved] = useState(saved)
  const [copied, setCopied] = useState(false)

  const href = `/the-break/${slug}`
  const signIn = () => router.push(`/login?next=${encodeURIComponent(href)}`)

  function save() {
    if (!signedIn) return signIn()
    const previous = isSaved
    setIsSaved(!previous)
    startTransition(async () => {
      const r = await toggleSaveAction({ target: 'post', id: postId })
      // The server is the authority; a refusal puts the icon back rather than leaving a lie.
      if (!r.ok) setIsSaved(previous)
      else setIsSaved(r.saved ?? !previous)
    })
  }

  async function share() {
    const url = new URL(href, window.location.origin).toString()
    /*
     * The platform sheet where there is one, the clipboard otherwise.
     *
     * `navigator.share` rejects when the user dismisses the sheet, which is not an error and must not
     * fall through to a "copied" confirmation for something they cancelled.
     */
    // Captured before the branch: narrowing on `'share' in navigator` leaves the else branch typed
    // as never in this lib configuration, which then hides the clipboard from the compiler.
    const clipboard = navigator.clipboard
    const share = (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share

    if (typeof share === 'function') {
      try {
        await share.call(navigator, { url, title: 'The Break' })
      } catch {
        // A dismissed share sheet rejects. That is a cancellation, not a failure, and must not fall
        // through to a "copied" confirmation for something the reader chose not to do.
      }
      return
    }
    try {
      await clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // A clipboard the browser will not grant is not worth an error dialog.
    }
  }

  const base = 'inline-flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60'

  return (
    <>
      <button type="button" onClick={save} className={cn(base, isSaved && 'text-[var(--gold)]')}
        aria-pressed={isSaved} aria-label={isSaved ? 'Unsave this post' : 'Save this post'}>
        {isSaved ? <BookmarkCheck className="size-3.5" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
        <span className="hidden sm:inline">{isSaved ? 'Saved' : 'Save'}</span>
      </button>

      <button type="button" onClick={share} className={base} aria-label="Share this post">
        {copied ? <Check className="size-3.5" aria-hidden /> : <Share2 className="size-3.5" aria-hidden />}
        <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
      </button>

      <button
        type="button"
        onClick={() => (signedIn ? router.push(`${href}?report=post`) : signIn())}
        className={base}
        aria-label="Report this post"
      >
        <Flag className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Report</span>
      </button>
    </>
  )
}
