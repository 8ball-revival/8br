'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { logoutRecovery, transferOwnershipRecovery } from '@/lib/recovery/actions'
import { Button } from '@/components/ui/button'

export interface RecoveryAccount {
  id: number
  username: string
  role: 'owner' | 'admin' | 'member'
}

/**
 * Break-glass console. Shows the current Owner and lets the operator hand ownership to a chosen
 * account (which demotes the current Owner to Admin). Every transfer is audited server-side.
 */
export function RecoveryConsole({
  currentOwner,
  candidates,
}: {
  currentOwner: RecoveryAccount | null
  candidates: RecoveryAccount[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [targetId, setTargetId] = useState<number | ''>('')
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)

  const doTransfer = () => {
    if (targetId === '') return
    const target = candidates.find((c) => c.id === targetId)
    const label = target ? target.username : `#${targetId}`
    if (!window.confirm(`Transfer ownership to ${label}? The current Owner will be demoted to Administrator. This is logged.`)) return
    setMsg(null)
    start(async () => {
      const res = await transferOwnershipRecovery(Number(targetId))
      if (res.error) setMsg({ text: res.error })
      else {
        setMsg({ ok: true, text: 'Ownership transferred.' })
        setTargetId('')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-none border border-border bg-background px-4 py-3 text-sm">
        <span className="eyebrow text-muted-foreground">Current Owner</span>
        <p className="mt-1 font-medium">
          {currentOwner ? `${currentOwner.username} (#${currentOwner.id})` : 'None found'}
        </p>
      </div>

      <div className="space-y-2">
        <label className="eyebrow text-muted-foreground" htmlFor="target">Transfer ownership to</label>
        <select
          id="target"
          className="w-full rounded-none border border-border bg-background px-3 py-2 text-sm"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">Select an account…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.username} (#{c.id}) — {c.role}
            </option>
          ))}
        </select>
      </div>

      {msg && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}
        >
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="destructive" disabled={pending || targetId === ''} onClick={doTransfer}>
          {pending ? 'Transferring…' : 'Transfer ownership'}
        </Button>
        <form action={logoutRecovery}>
          <Button type="submit" variant="outline">Log out</Button>
        </form>
      </div>
    </div>
  )
}
