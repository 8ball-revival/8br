'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquareOff, MessageSquarePlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { setBreakPostingBlockedAction } from '@/lib/break/posting-access-actions'

/**
 * Removing and restoring a member's ability to post in The Break.
 *
 * ── What this control says, and why the wording matters ──────────────────────────────────────────
 * Posting is open to every member, so there is nothing here to grant. The default state is "can
 * post", and the only action is taking it away from somebody who has abused it. An administrator
 * arriving at this page should be able to tell that at a glance, because the alternative — reading
 * it as a permission that has to be handed out — leads to exactly the mistake that has already been
 * made here once: granting a member a publishing permission and expecting it to fix something.
 *
 * ── Why a reason is required to remove and not to restore ────────────────────────────────────────
 * The member is shown the reason when they next try to post. Without one they get a refusal with no
 * explanation and no idea what to do about it, which turns a moderation decision into a mystery.
 * Restoring needs no justification: giving somebody their ordinary rights back is not exceptional.
 *
 * The server action re-checks the capability and re-checks the reason. This component decides what
 * to show; it decides nothing about what is allowed.
 */
export function MemberPostingAccess({
  targetUserId,
  targetLabel,
  blocked,
  blockedReason,
  blockedAt,
  hasProfile,
  canManage,
}: {
  targetUserId: number
  targetLabel: string
  blocked: boolean
  blockedReason: string | null
  blockedAt: string | null
  hasProfile: boolean
  canManage: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)

  const apply = (next: boolean, reason?: string) => {
    setMsg(null)
    start(async () => {
      const r = await setBreakPostingBlockedAction(targetUserId, next, reason)
      if (r.error) setMsg({ text: r.error })
      else {
        setMsg({ ok: true, text: next ? 'Posting removed.' : 'Posting restored.' })
        router.refresh()
      }
    })
  }

  const ask = (next: boolean) => {
    if (!next) {
      void confirm({
        title: 'Restore posting?',
        message: `${targetLabel} will be able to write posts again from their next visit. Comments, votes and saves were never affected.`,
        confirmLabel: 'Restore',
        cancelLabel: 'Cancel',
      }).then((res) => { if (res.confirmed) apply(false) })
      return
    }
    /*
     * The browser's own prompt for the reason.
     *
     * The confirm dialog this codebase provides returns a yes or no, and building a bespoke reason
     * form for a control used a handful of times a year is more surface than the decision warrants.
     * The server rejects an empty reason regardless, so the requirement does not depend on this.
     */
    const reason = window.prompt(
      `Why is posting being removed from ${targetLabel}?\n\nThey are shown this when they try to post.`,
      '',
    )
    if (reason == null) return
    if (!reason.trim()) { setMsg({ text: 'Give a reason. The member is shown it when they try to post.' }); return }

    void confirm({
      title: 'Remove posting?',
      message: `${targetLabel} will not be able to write new posts. They keep reading, commenting, voting and saving, and everything they have already posted stays up. Use a timeout or a ban instead if the account should not be here at all.`,
      confirmLabel: 'Remove posting',
      cancelLabel: 'Cancel',
      tone: 'warning',
    }).then((res) => { if (res.confirmed) apply(true, reason) })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Posting:</span>
        {blocked
          ? <Badge variant="destructive"><MessageSquareOff className="mr-1 size-3" aria-hidden />Removed</Badge>
          : <Badge variant="muted">Open, like every member</Badge>}
      </div>

      <p className="text-xs text-muted-foreground">
        {blocked
          ? 'This member cannot write new posts. Comments, votes and saves are unaffected, and their existing posts are still up.'
          : 'Every member in good standing can post in The Break. Nothing needs granting; this is only for taking it away.'}
      </p>

      {blocked && blockedReason && (
        <p className="border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Reason shown to them:</span> {blockedReason}
          {blockedAt && <span className="block text-[0.7rem] opacity-70">Removed {new Date(blockedAt).toLocaleDateString()}</span>}
        </p>
      )}

      {msg && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
          {msg.text}
        </p>
      )}

      {!hasProfile
        ? <p className="text-sm text-muted-foreground">This account has no linked profile, so it has no posting identity to change.</p>
        : !canManage
          ? <p className="text-sm text-muted-foreground">Only an administrator can change posting access.</p>
          : (
            <Button
              size="sm"
              variant={blocked ? 'default' : 'outline'}
              disabled={pending}
              onClick={() => ask(!blocked)}
            >
              {blocked
                ? <><MessageSquarePlus className="size-4" aria-hidden />Restore posting</>
                : <><MessageSquareOff className="size-4" aria-hidden />Remove posting</>}
            </Button>
          )}
    </div>
  )
}
