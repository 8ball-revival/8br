'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'

import { cn } from '@/lib/utils'
import { createMemberAction } from '@/lib/staff/create-member'
import { TEMPORARY_PASSWORD } from '@/lib/account/validation'

const input =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

/**
 * "Create New Member" — opens an inline panel on the Member Management page.
 *
 * Only the CueVerse ID is required. Email is not collected at all - the server derives a reserved,
 * non-deliverable address from the handle, and the member can set a real one from My Account. The
 * temporary password is fixed and displayed rather than typed. The server action re-validates
 * everything and is gated on `manage_players`, so this component decides only what to show.
 *
 * New accounts are always created as `member`. Promoting someone is a separate, Owner-gated action
 * in Staff Management — minting staff is deliberately not possible from here.
 */
export function CreateMemberButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const [cueverseId, setCueverseId] = useState('')
  const [preferredName, setPreferredName] = useState('')

  const reset = () => {
    setCueverseId('')
    setPreferredName('')
    setError(null)
  }

  async function submit() {
    setError(null)
    setDone(null)
    setPending(true)
    const res = await createMemberAction({ cueverseId, preferredName })
    setPending(false)
    if (res.error) return setError(res.error)
    setDone(`Created @${cueverseId.trim()}.`)
    reset()
    setOpen(false)
    router.refresh()
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserPlus className="size-4" aria-hidden />
          Create New Member
        </button>
        {done && <p className="text-xs text-success">{done}</p>}
      </div>

      {open && (
        <div className="mt-4 max-w-2xl rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">New member account</p>
          <p className="mt-1 text-[0.7rem] text-muted-foreground">
            The CueVerse ID is both the public identity and the login handle. Email is not needed here
            — the member can add one from My Account, along with a password of their own.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-[0.7rem] text-muted-foreground">
              CueVerse ID <span className="text-destructive">*</span>
              <input value={cueverseId} onChange={(e) => setCueverseId(e.target.value)} autoFocus className={cn(input, 'mt-1')} />
            </label>
            <label className="text-[0.7rem] text-muted-foreground">
              Preferred name <span className="opacity-60">(optional)</span>
              <input value={preferredName} onChange={(e) => setPreferredName(e.target.value)} className={cn(input, 'mt-1')} />
            </label>
            <label className="text-[0.7rem] text-muted-foreground">
              Temporary password
              {/* Fixed and shown, not typed: whoever creates the account reads it out. Because it is
                  the same for everyone, the member should change it at first sign-in. */}
              <input
                value={TEMPORARY_PASSWORD}
                readOnly
                aria-readonly="true"
                tabIndex={-1}
                className={cn(input, 'mt-1 cursor-default font-mono text-muted-foreground')}
              />
            </label>
          </div>

          <p className="mt-2 text-[0.7rem] text-muted-foreground">
            Every new account starts on <strong className="font-mono text-foreground">{TEMPORARY_PASSWORD}</strong>. It is
            the same for everyone, so ask the member to change it from My Account when they first sign in.
          </p>

          {error && (
            <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {pending ? 'Creating…' : 'Create member'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                reset()
              }}
              disabled={pending}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
