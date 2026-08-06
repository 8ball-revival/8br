'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { removePenaltyAction } from '@/lib/moderation/actions'

/** Remove an active penalty early from the Penalties page. Prompts for a required reason. */
export function PenaltyRemoveButton({ penaltyId, userId, type }: { penaltyId: number; userId: number; type: 'TIMEOUT' | 'BAN' }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => {
        const reason = window.prompt(`Reason for removing this ${type === 'BAN' ? 'ban' : 'timeout'}?`)
        if (reason == null) return
        if (!reason.trim()) { setError('A reason is required.'); return }
        setError(null)
        start(async () => {
          const r = await removePenaltyAction(penaltyId, userId, reason)
          if (r.error) setError(r.error)
          else router.refresh()
        })
      }}>
        {pending ? 'Removing…' : type === 'BAN' ? 'Unban' : 'Remove timeout'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
