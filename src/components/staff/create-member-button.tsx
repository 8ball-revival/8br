'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'

import { cn } from '@/lib/utils'
import { createMemberAction } from '@/lib/staff/create-member'
import { TEMPORARY_PASSWORD } from '@/lib/account/validation'

const input =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

/**
 * "Create New Member" — an inline panel on the Member Management page, built for entering a roster
 * in one sitting rather than one person at a time.
 *
 * On success the panel STAYS OPEN, clears, and puts the cursor back in the CueVerse ID field, so
 * thirty names are thirty type-Enter cycles rather than thirty round trips through the button. The
 * member list below refreshes each time, and a running tally of who was added this sitting sits in
 * the panel so it is obvious where you are in a long list.
 *
 * Only the CueVerse ID is required. Email is not collected at all — the server derives a reserved,
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
  /** Who was added since the panel was opened — the progress marker for a long roster. */
  const [added, setAdded] = useState<string[]>([])

  const [cueverseId, setCueverseId] = useState('')
  const [preferredName, setPreferredName] = useState('')
  const cueRef = useRef<HTMLInputElement>(null)

  const clearFields = () => {
    setCueverseId('')
    setPreferredName('')
    setError(null)
  }

  function openPanel() {
    setAdded([])
    clearFields()
    setOpen(true)
  }

  function closePanel() {
    setOpen(false)
    setAdded([])
    clearFields()
  }

  async function submit() {
    const id = cueverseId.trim()
    if (!id || pending) return
    setError(null)
    setPending(true)
    // The button must always come back. A server action that throws rather than returning an error
    // used to leave this stuck on "Creating…" with nothing on screen to explain why.
    try {
      const res = await createMemberAction({ cueverseId: id, preferredName })
      if (res.error) {
        setError(res.error)
        return
      }
      setAdded((prev) => [...prev, id])
      clearFields()
      router.refresh() // the member list below picks up the new row
      cueRef.current?.focus() // straight on to the next person
    } catch (e) {
      setError(e instanceof Error ? `Could not create the member: ${e.message}` : 'Could not create the member.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (open ? closePanel() : openPanel())}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserPlus className="size-4" aria-hidden />
          Create New Member
        </button>
      </div>

      {open && (
        <div className="mt-4 max-w-2xl rounded-lg border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">New member account</p>
            {added.length > 0 && (
              <p className="text-xs font-semibold text-success" aria-live="polite">
                {added.length} added
              </p>
            )}
          </div>
          <p className="mt-1 text-[0.7rem] text-muted-foreground">
            The CueVerse ID is both the public identity and the login handle. Email is not needed here
            — the member can add one from My Account, along with a password of their own. Press{' '}
            <kbd className="rounded border border-border px-1 font-sans">Enter</kbd> to save and go
            straight on to the next person.
          </p>

          {/* A real form, so Enter submits from either field — the whole point when entering 30 names. */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-[0.7rem] text-muted-foreground">
                CueVerse ID <span className="text-destructive">*</span>
                <input
                  ref={cueRef}
                  value={cueverseId}
                  onChange={(e) => setCueverseId(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(input, 'mt-1')}
                />
              </label>
              <label className="text-[0.7rem] text-muted-foreground">
                Preferred name <span className="opacity-60">(optional)</span>
                <input
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  autoComplete="off"
                  className={cn(input, 'mt-1')}
                />
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

            <div className="mt-4 flex items-center gap-2">
              <button
                type="submit"
                disabled={pending || !cueverseId.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {pending ? 'Creating…' : 'Create member'}
              </button>
              <button
                type="button"
                onClick={closePanel}
                disabled={pending}
                className="rounded-md border border-border px-4 py-2 text-sm font-semibold"
              >
                {added.length > 0 ? 'Done' : 'Cancel'}
              </button>
            </div>
          </form>

          {added.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">Added this sitting</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {added.map((id) => (
                  <li
                    key={id}
                    className="rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-[0.7rem] text-success"
                  >
                    @{id}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
