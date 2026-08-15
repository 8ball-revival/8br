'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { setForcedPasswordAction, type ForcePwResult } from '@/lib/account/force-password-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const initial: ForcePwResult = {}

export function SetPasswordForm() {
  const router = useRouter()
  const [state, action, pending] = useActionState(setForcedPasswordAction, initial)

  useEffect(() => {
    if (state.ok) { router.replace('/account'); router.refresh() }
  }, [state.ok, router])

  return (
    <form action={action} className="mt-5 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">New password</label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="••••••••" />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirm" className="text-sm font-medium">Confirm new password</label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} placeholder="••••••••" />
      </div>
      {state.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? 'Saving…' : 'Set permanent password'}</Button>
    </form>
  )
}
