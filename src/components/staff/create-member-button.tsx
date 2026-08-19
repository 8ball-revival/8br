'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'

import { cn } from '@/lib/utils'
import { createMemberAction, findPossibleDuplicatesAction } from '@/lib/staff/create-member'
import type { PossibleDuplicate } from '@/lib/staff/possible-duplicates'
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
        <div className="mt-4 grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-lg border border-border bg-card p-4">
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
            </div>

            {/* One line rather than a field. The password never varied, so the input was a control
                that could only ever read back its own constant — and it took a third of the form. */}
            <p className="mt-2 text-[0.7rem] text-muted-foreground">
              Starts on <strong className="font-mono text-foreground">{TEMPORARY_PASSWORD}</strong> — the same for
              everyone. Ask the member to change it from My Account at first sign-in.
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

        {/* Beside the form, not under it: a duplicate found after the account exists is a merge. */}
        <DuplicatePanel cueverseId={cueverseId} preferredName={preferredName} />
        </div>
      )}
    </div>
  )
}

/**
 * Who might already be this person.
 *
 * Sits beside the form rather than under it, and updates as the handle is typed, because the point
 * is to be seen BEFORE the account exists. A duplicate discovered afterwards is no longer a warning
 * — it is a merge, with results already attached to the wrong identity.
 *
 * It never blocks the save. Two similar handles are sometimes two people, and only the person
 * entering the roster knows which; a warning they can read and overrule is worth more than a rule
 * that stops them working.
 *
 * The lookup is debounced and single-flight, and out-of-order responses are dropped — otherwise a
 * slow reply for "cere" can land after a fast one for "cerebro" and show matches for a handle that
 * is no longer in the box.
 */
function DuplicatePanel({ cueverseId, preferredName }: { cueverseId: string; preferredName: string }) {
  const [matches, setMatches] = useState<PossibleDuplicate[]>([])
  const [looking, setLooking] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const id = cueverseId.trim()
    const name = preferredName.trim()
    const mine = ++seq.current
    // The flag is raised when the request actually goes, not on the keystroke: setting state
    // synchronously in an effect body cascades a render, and "Checking…" flickering between every
    // letter says less than leaving the previous answer up until a new one is on its way.
    const t = setTimeout(() => {
      if (id.length < 2 && name.length < 2) { setMatches([]); setLooking(false); return }
      setLooking(true)
      void findPossibleDuplicatesAction(id, name)
        .then((found) => { if (mine === seq.current) { setMatches(found); setLooking(false) } })
        .catch(() => { if (mine === seq.current) { setMatches([]); setLooking(false) } })
    }, 300)
    return () => clearTimeout(t)
  }, [cueverseId, preferredName])

  const idle = cueverseId.trim().length < 2 && preferredName.trim().length < 2

  return (
    <aside className="rounded-lg border border-border bg-card p-4" aria-live="polite">
      <p className="text-sm font-semibold text-foreground">Possible duplicates</p>
      <p className="mt-1 text-[0.7rem] text-muted-foreground">
        Existing profiles that look like the person you are entering. Checked as you type.
      </p>

      {idle ? (
        <p className="mt-3 text-[0.7rem] text-muted-foreground">Start typing a CueVerse ID or name.</p>
      ) : looking ? (
        <p className="mt-3 text-[0.7rem] text-muted-foreground">Checking…</p>
      ) : matches.length === 0 ? (
        <p className="mt-3 text-[0.7rem] text-success">No similar profile found.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {matches.map((m) => (
            <li
              key={m.playerId}
              className={cn(
                'rounded-md border px-2.5 py-2',
                // An exact clash will be refused by the server anyway, so it is marked as a problem
                // rather than a hint.
                m.reason === 'exact-id'
                  ? 'border-destructive/50 bg-destructive/10'
                  : 'border-border bg-background',
              )}
            >
              <p className="text-xs font-semibold text-foreground">
                {m.cueverseId ?? '—'}
                {m.preferredName && m.preferredName !== m.cueverseId && (
                  <span className="ml-1 font-normal text-muted-foreground">· {m.preferredName}</span>
                )}
              </p>
              <p className="mt-0.5 text-[0.68rem] text-muted-foreground">{m.explanation}</p>
              <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                {m.played > 0
                  ? `${m.played} recorded ${m.played === 1 ? 'match' : 'matches'}`
                  : 'No recorded matches'}
                {' · '}
                {m.hasAccount ? 'has an account' : 'no account yet'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
