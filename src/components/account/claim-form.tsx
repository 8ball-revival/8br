'use client'

import { useActionState, useState, useTransition } from 'react'
import { claimAccountAction, lookupClaimTargetAction } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'

const FIELD = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
const LABEL = 'eyebrow text-muted-foreground'

export function ClaimForm() {
  const [state, action, pending] = useActionState(claimAccountAction, {} as { ok?: boolean; error?: string })
  const [loginId, setLoginId] = useState('')
  const [target, setTarget] = useState<{ name?: string; error?: string } | null>(null)
  const [looking, startLookup] = useTransition()

  const lookup = () => {
    if (!loginId.trim()) return setTarget(null)
    startLookup(async () => {
      const r = await lookupClaimTargetAction(loginId)
      setTarget(r.ok ? { name: r.playerName } : { error: r.error })
    })
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className={LABEL} htmlFor="loginId">CueVerse login ID</label>
        <input id="loginId" name="loginId" value={loginId} onChange={(e) => setLoginId(e.target.value)} onBlur={lookup} required className={`${FIELD} mt-1`} placeholder="your login id" />
        {looking && <p className="mt-1 text-xs text-muted-foreground">Checking…</p>}
        {target?.name && <p className="mt-1 text-xs text-foreground">You are claiming the profile: <span className="font-semibold text-gold">{target.name}</span></p>}
        {target?.error && <p className="mt-1 text-xs text-muted-foreground">{target.error}</p>}
      </div>

      <div>
        <label className={LABEL} htmlFor="code">One-time claim code</label>
        <input id="code" name="code" required className={`${FIELD} mt-1`} placeholder="XXXXX-XXXXX" />
      </div>

      <div className="border-t border-border pt-4">
        <label className={LABEL} htmlFor="password">Create a password</label>
        <input id="password" name="password" type="password" required minLength={8} className={`${FIELD} mt-1`} placeholder="At least 8 characters" />
      </div>
      <div>
        <label className={LABEL} htmlFor="confirmPassword">Confirm password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} className={`${FIELD} mt-1`} />
      </div>
      <div>
        <label className={LABEL} htmlFor="email">Recovery email</label>
        <input id="email" name="email" type="email" required className={`${FIELD} mt-1`} placeholder="for password recovery" />
        <p className="mt-1 text-xs text-muted-foreground">Private — used only for password recovery, never shown publicly.</p>
      </div>

      {state?.error && <p className="rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Claiming…' : 'Claim account & sign in'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Your claim code works once. All your existing cups, seasons, rankings and titles stay attached to your profile.
      </p>
    </form>
  )
}
