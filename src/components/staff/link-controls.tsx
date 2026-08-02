'use client'

import { useActionState } from 'react'

import { linkAccountAction, updateProfileAction, createProfileAction } from '@/lib/players/actions'
import type { ActionResult } from '@/lib/competition/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Manually create a player profile. */
export function CreateProfileForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createProfileAction, {})
  return (
    <form action={action} className="mt-3 grid gap-2 sm:grid-cols-2">
      <Input name="primaryName" placeholder="Display name *" required />
      <Input name="cueverseId" placeholder="CueVerse ID" />
      <Input name="discord" placeholder="Discord" />
      <Input name="timeZone" placeholder="Time zone" />
      <div className="col-span-full flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>{pending ? 'Creating…' : 'Create profile'}</Button>
        {state.error && <span className="text-xs text-destructive">{state.error}</span>}
        {state.ok && <span className="text-xs text-success">Created</span>}
      </div>
    </form>
  )
}

/** Manually link a specific profile to a chosen unlinked account. */
export function AccountLinkSelect({ playerId, accounts }: { playerId: string; accounts: { userId: number; username: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(linkAccountAction, {})
  if (!accounts.length) return <span className="text-xs text-muted-foreground">No unlinked accounts</span>
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="playerId" value={playerId} />
      <select name="userId" className="rounded-md border border-input bg-background px-2 py-1 text-sm">
        {accounts.map((a) => (
          <option key={a.userId} value={a.userId}>{a.username}</option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? '…' : 'Link'}</Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      {state.ok && <span className="text-xs text-success">Linked</span>}
    </form>
  )
}

/** Inline edit of a profile's public details + active flag. */
export function EditProfileForm({
  profile,
}: {
  profile: { id: string; primaryName: string; cueverseId: string | null; discord: string | null; timeZone: string | null; active: boolean }
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateProfileAction, {})
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Edit details</summary>
      <form action={action} className="mt-2 grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="playerId" value={profile.id} />
        <Labeled label="Display name"><Input name="primaryName" defaultValue={profile.primaryName} /></Labeled>
        <Labeled label="CueVerse ID"><Input name="cueverseId" defaultValue={profile.cueverseId ?? ''} /></Labeled>
        <Labeled label="Discord"><Input name="discord" defaultValue={profile.discord ?? ''} /></Labeled>
        <Labeled label="Time zone"><Input name="timeZone" defaultValue={profile.timeZone ?? ''} /></Labeled>
        <label className="col-span-full flex items-center gap-2 text-sm">
          <input type="hidden" name="active" value="false" />
          <input type="checkbox" name="active" value="true" defaultChecked={profile.active} className="size-4 accent-gold" /> Active
        </label>
        <div className="col-span-full flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
          {state.error && <span className="text-xs text-destructive">{state.error}</span>}
          {state.ok && <span className="text-xs text-success">Saved</span>}
        </div>
      </form>
    </details>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </label>
  )
}
