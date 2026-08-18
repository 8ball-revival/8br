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
 * Mirrors the server rule rather than duplicating it: the action re-checks the capability itself, so
 * this component only decides what to show. The confirmation spells out what the permission actually
 * does in both directions, because "Trusted Author" on its own does not tell an administrator that
 * granting it means skipping review entirely.
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
        ? `${targetLabel} will be able to publish articles to The Break immediately, without review. They still cannot mark anything as Official News, feature it, or pin it — those stay with administrators.`
        : `${targetLabel} will go back to submitting articles for review before they appear. Anything they have already published stays published; this only affects what they write from now on.`,
      confirmLabel: next ? 'Grant' : 'Revoke',
      cancelLabel: 'Cancel',
      tone: next ? 'default' : 'warning',
    }).then((res) => { if (res.confirmed) apply(next) })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">The Break:</span>
        {trusted
          ? <Badge variant="gold"><ShieldCheck className="mr-1 size-3" aria-hidden />Trusted Author</Badge>
          : <Badge variant="muted">Publishes after review</Badge>}
      </div>

      <p className="text-xs text-muted-foreground">
        {trusted
          ? 'Articles by this member go live as soon as they publish them. Official News, featuring and pinning remain administrator-only.'
          : 'Articles by this member are held for review before they appear on the site.'}
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
