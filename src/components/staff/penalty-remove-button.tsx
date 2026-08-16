'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { removePenaltyAction } from '@/lib/moderation/actions'

/** Remove an active penalty early from the Penalties page. Requires a reason via the 8BR modal. */
export function PenaltyRemoveButton({ penaltyId, userId, type }: { penaltyId: number; userId: number; type: 'TIMEOUT' | 'BAN' }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    const res = await confirm({
      title: type === 'BAN' ? 'Lift this ban?' : 'End this timeout?',
      confirmLabel: type === 'BAN' ? 'Unban' : 'Remove timeout',
      tone: 'warning',
      input: { label: 'Reason (required)', required: true, placeholder: 'Why is this penalty being removed?' },
      action: async (reason) => {
        const r = await removePenaltyAction(penaltyId, userId, reason)
        return r.error ? { ok: false, error: r.error } : { ok: true }
      },
    })
    if (res.confirmed) { setError(null); start(() => Promise.resolve(router.refresh())) }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={remove}>
        {pending ? 'Removing…' : type === 'BAN' ? 'Unban' : 'Remove timeout'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
