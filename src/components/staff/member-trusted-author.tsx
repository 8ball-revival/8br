'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PenLine, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { setTrustedAuthorAction } from '@/lib/editorial/trusted-author-actions'

/**
 * The Trusted Author control on a member's admin Overview.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────────────────────────────
 * It does not decide whether somebody can post in The Break. Every member in good standing can, and
 * `canPost` has never consulted this flag.
 *
 * The wording here used to say that granting it let a member "publish articles to The Break
 * immediately", which is how an administrator came to grant it to a member whose Create Post button
 * was returning a 404 — a missing route, not a refused permission. Nothing changed for them, because
 * nothing here was ever in that path. Misleading copy on a permission control is not cosmetic: it
 * gets permissions handed out for reasons that were never true.
 *
 * What it actually gates is the legacy ARTICLE system under /news: whether an article publishes
 * straight away or waits for review. To take posting away from somebody abusing it, use the Posting
 * control above.
 *
 * Mirrors the server rule rather than duplicating it: the action re-checks the capability itself, so
 * this component only decides what to show.
 */
export function MemberTrustedAuthor({
  targetUserId,
  targetLabel,
  trusted,
  hasProfile,
  canManage,
}: {
  targetUserId: number
  targetLabel: string
  trusted: boolean
  hasProfile: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)

  const apply = (next: boolean) => {
    setMsg(null)
    start(async () => {
      const r = await setTrustedAuthorAction(targetUserId, next)
      if (r.error) setMsg({ text: r.error })
      else {
        setMsg({ ok: true, text: next ? 'Trusted Author granted.' : 'Trusted Author revoked.' })
        router.refresh()
      }
    })
  }

  const ask = (next: boolean) => {
    void confirm({
      title: next ? 'Grant Trusted Author?' : 'Revoke Trusted Author?',
      message: next
        ? `${targetLabel} will be able to publish legacy /news articles immediately, without review. This does not affect The Break: they can already post there, like every member. It also does not let them mark anything Official, feature it or pin it — those stay with administrators.`
        : `${targetLabel} will go back to submitting legacy /news articles for review before they appear. Their ability to post in The Break is unaffected — use the Posting control for that. Anything already published stays published.`,
      confirmLabel: next ? 'Grant' : 'Revoke',
      cancelLabel: 'Cancel',
      tone: next ? 'default' : 'warning',
    }).then((res) => { if (res.confirmed) apply(next) })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Legacy articles:</span>
        {trusted
          ? <Badge variant="gold"><ShieldCheck className="mr-1 size-3" aria-hidden />Trusted Author</Badge>
          : <Badge variant="muted">Publishes after review</Badge>}
      </div>

      <p className="text-xs text-muted-foreground">
        {trusted
          ? 'Legacy /news articles by this member go live as soon as they publish them. Does not affect posting in The Break, which is open to every member.'
          : 'Legacy /news articles by this member are held for review. Does not affect posting in The Break, which is open to every member.'}
      </p>

      {msg && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
          {msg.text}
        </p>
      )}

      {!hasProfile
        ? <p className="text-sm text-muted-foreground">This account has no linked profile, so it cannot be given publishing permissions.</p>
        : !canManage
          ? <p className="text-sm text-muted-foreground">Only an administrator can change publishing permissions.</p>
          : (
            <Button
              size="sm"
              variant={trusted ? 'outline' : 'default'}
              disabled={pending}
              onClick={() => ask(!trusted)}
            >
              <PenLine className="size-4" aria-hidden />
              {trusted ? 'Revoke Trusted Author' : 'Grant Trusted Author'}
            </Button>
          )}
    </div>
  )
}
