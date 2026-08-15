'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Star, ArrowUp, ArrowDown, Crown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { promoteToAdminAction, demoteAdminAction, setHeadAdministratorAction, transferOwnershipAction, type RoleResult } from '@/lib/staff/roles-actions'

type Role = 'owner' | 'admin' | 'member'

/**
 * In-app staff-role management for a single member. All invariants are enforced server-side
 * in the roles service; this UI mirrors them (hides actions the viewer may not take, requires
 * confirmation) and never duplicates the backend logic.
 */
export function MemberRoles({
  targetUserId,
  targetUsername,
  targetRole,
  targetIsHeadAdmin,
  viewerUserId,
  viewerIsOwner,
  viewerCanManageAdmins,
}: {
  targetUserId: number
  targetUsername: string
  targetRole: Role
  targetIsHeadAdmin: boolean
  viewerUserId: number
  viewerIsOwner: boolean
  viewerCanManageAdmins: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)
  const isSelf = targetUserId === viewerUserId

  const go = (fn: () => Promise<RoleResult>) => {
    setMsg(null)
    start(async () => {
      const r = await fn()
      if (r.error) setMsg({ text: r.error })
      else { setMsg({ ok: true, text: 'Role updated.' }); router.refresh() }
    })
  }
  const run = (fn: () => Promise<RoleResult>, confirmText?: string) => {
    if (!confirmText) { go(fn); return }
    void confirm({ title: 'Confirm role change?', message: confirmText, confirmLabel: 'Confirm', cancelLabel: 'Cancel', tone: 'warning' }).then((res) => { if (res.confirmed) go(fn) })
  }

  if (!viewerCanManageAdmins) {
    return <p className="text-sm text-muted-foreground">Only the Owner or Head Administrator can manage roles.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Current role:</span>
        <Badge variant={targetRole === 'owner' ? 'gold' : targetRole === 'admin' ? 'success' : 'muted'}>
          {targetRole === 'owner' ? 'Owner' : targetRole === 'admin' ? 'Administrator' : 'Member'}
        </Badge>
        {targetIsHeadAdmin && <Badge variant="default"><Star className="mr-1 size-3" aria-hidden />Head Administrator</Badge>}
      </div>

      {msg && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>{msg.text}</p>
      )}

      {isSelf && <p className="text-xs text-muted-foreground italic">You cannot change your own role or remove yourself.</p>}

      {targetRole === 'owner' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Crown className="size-4 text-brand" aria-hidden /> The Owner is protected. Ownership changes only via transfer from the Owner account.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {targetRole === 'member' && !isSelf && (
            <Button size="sm" disabled={pending} onClick={() => run(() => promoteToAdminAction(targetUserId, 'Promoted via Member Management'), `Promote ${targetUsername} to Administrator?`)}>
              <ArrowUp className="size-4" /> Promote to Administrator
            </Button>
          )}

          {targetRole === 'admin' && (
            <>
              {!targetIsHeadAdmin && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setHeadAdministratorAction(targetUserId, 'Head Administrator appointed'), `Make ${targetUsername} the Head Administrator? This replaces the current Head Administrator.`)}>
                  <ShieldCheck className="size-4" /> Appoint Head Administrator
                </Button>
              )}
              {!isSelf && (
                <Button size="sm" variant="outline" disabled={pending || targetIsHeadAdmin} onClick={() => run(() => demoteAdminAction(targetUserId, 'Demoted via Member Management'), `Demote ${targetUsername} to Member?`)}>
                  <ArrowDown className="size-4" /> Demote to Member
                </Button>
              )}
              {targetIsHeadAdmin && !isSelf && (
                <p className="w-full text-xs text-muted-foreground italic">This is the Head Administrator — appoint another Administrator as Head before demoting or removing.</p>
              )}
              {viewerIsOwner && !isSelf && (
                <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(() => transferOwnershipAction(targetUserId, 'Ownership transferred'), `Transfer OWNERSHIP to ${targetUsername}? You will become an Administrator. There is always exactly one Owner.`)}>
                  <Crown className="size-4" /> Transfer ownership
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
