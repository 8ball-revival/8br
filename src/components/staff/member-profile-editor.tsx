'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { adminUpdateMemberProfileAction, type ProfilePatch } from '@/lib/staff/member-profile-actions'

const input = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand'

export interface ProfileInitial {
  userId: number
  preferredName: string
  cueverseId: string
  timeZone: string
  discord: string
  email: string
}

/** Admin editor for a player's safe profile fields — no cooldown. There is no separate Username:
 *  CueVerse ID IS the account identity and login name. Derived stats are never here. */
export function MemberProfileEditor({ initial }: { initial: ProfileInitial }) {
  const router = useRouter()
  const [v, setV] = useState<ProfileInitial>(initial)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (k: keyof ProfileInitial, val: string) => setV((s) => ({ ...s, [k]: val }))

  const dirty =
    v.preferredName !== initial.preferredName || v.cueverseId !== initial.cueverseId ||
    v.timeZone !== initial.timeZone || v.discord !== initial.discord || v.email !== initial.email

  const save = () => start(async () => {
    setMsg(null)
    const patch: ProfilePatch = {}
    if (v.preferredName !== initial.preferredName) patch.preferredName = v.preferredName
    if (v.cueverseId !== initial.cueverseId) patch.cueverseId = v.cueverseId
    if (v.timeZone !== initial.timeZone) patch.timeZone = v.timeZone
    if (v.discord !== initial.discord) patch.discord = v.discord
    if (v.email !== initial.email) patch.email = v.email
    const r = await adminUpdateMemberProfileAction(initial.userId, patch)
    if (r.error) setMsg({ ok: false, text: r.error })
    else { setMsg({ ok: true, text: 'Profile updated.' }); router.refresh() }
  })

  const field = (k: keyof ProfileInitial, label: string, opts?: { hint?: string; type?: string }) => (
    <div>
      <label className="mb-1 block text-[0.7rem] uppercase tracking-wide text-muted-foreground">{label}</label>
      <input type={opts?.type ?? 'text'} value={v[k] as string} onChange={(e) => set(k, e.target.value)} className={input} autoComplete="off" />
      {opts?.hint && <p className="mt-1 text-[0.7rem] text-muted-foreground">{opts.hint}</p>}
    </div>
  )

  return (
    <div className="space-y-5">
      {msg && <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>}

      <div className="grid gap-3 sm:grid-cols-2">
        {field('preferredName', 'Preferred Name')}
        {field('cueverseId', 'CueVerse ID', { hint: 'Account identity + login name. Admin edit — no 7-day cooldown; must be unique.' })}
        {field('timeZone', 'Time Zone', { hint: 'e.g. America/New_York' })}
        {field('discord', 'Discord')}
      </div>

      <Button disabled={!dirty || pending} onClick={save}><Save className="size-4" /> {pending ? 'Saving…' : 'Save profile'}</Button>
    </div>
  )
}
