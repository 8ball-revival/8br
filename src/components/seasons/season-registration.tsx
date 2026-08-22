'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Lock, Plus, Search, UserPlus, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PlayerName } from '@/components/identity/player-name'
import { identityText } from '@/lib/identity/display'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { createMemberAction } from '@/lib/staff/create-member'
import {
  searchSeasonPlayersAction,
  addSeasonEntrantAction,
  removeSeasonEntrantAction,
  closeSeasonRegistrationAction,
  registerForSeasonAction,
  type SeasonActionResult,
} from '@/lib/seasons/actions'
import { AutoAssignPanel } from '@/components/archive/auto-assign-panel'
import type { AutoAssignAvailability } from '@/lib/archive/auto-assign'

export interface RegEntrant { entrantId: number; name: string; cueverseId: string | null; slug: string | null; rating: number | null }

/**
 * Season registration phase — a focused, single-purpose page: entrant list (# · Preferred Name +
 * CueVerse ID · Rankings rating), admin Add Player search + remove + Close Registration, and member
 * self-registration. No Groups / Standings / Playoffs here.
 */
export function SeasonRegistration({
  seasonId,
  entrants,
  canManage,
  isOpen,
  isLoggedIn,
  alreadyRegistered,
  memberRegistrationOpen,
  autoEntrants,
}: {
  seasonId: number
  entrants: RegEntrant[]
  canManage: boolean
  /** Decided on the server; absent for a Season with no archive template. */
  autoEntrants?: AutoAssignAvailability
  isOpen: boolean
  isLoggedIn: boolean
  alreadyRegistered: boolean
  /**
   * Whether a signed-in member may enter this Season themselves.
   *
   * Decided on the server by the site-wide policy — the component does not reason about it, and
   * there is no per-Season password to satisfy on top of it. A Season that is OPEN under an
   * ADMIN_ONLY policy simply shows no registration control.
   */
  memberRegistrationOpen: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  // Auto-dismiss temporary success toasts so they never dominate the layout.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (t: { ok: boolean; text: string }) => {
    setToast(t)
    if (timer.current) clearTimeout(timer.current)
    if (t.ok) timer.current = setTimeout(() => setToast(null), 2500)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const run = (fn: () => Promise<SeasonActionResult>) =>
    start(async () => {
      const r = await fn()
      if (r.error) flash({ ok: false, text: r.error })
      else { flash({ ok: true, text: r.message ?? 'Done.' }); router.refresh() }
    })

  return (
    <div className="mt-8 space-y-5">
      {toast && (
        <div className={cn('rounded-md border px-3 py-2 text-sm', toast.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')} role="status">
          {toast.text}
        </div>
      )}

      {/*
        Auto Add Entrants leads the entrant controls, because it is the first step of the archive
        workflow and the one that makes the rest possible: nothing can be assigned to a group until
        the people exist as entrants.
      */}
      {canManage && autoEntrants?.show && (
        // items-start, or the column stretches the button into a full-width gold bar.
        <div className="flex flex-col items-start gap-1">
          <AutoAssignPanel seasonId={seasonId} mode="entrants" disabledReason={autoEntrants.disabledReason} />
          {!autoEntrants.disabledReason && (
            <span className="text-xs text-muted-foreground">
              Searches every existing account for this Season&rsquo;s archived players. Creates nobody —
              anyone without an account is listed for you to add by hand.
            </span>
          )}
        </div>
      )}

      {/* Member self-registration / admin controls */}
      <div className="flex flex-wrap items-center gap-3">
        {memberRegistrationOpen && !canManage && isLoggedIn && !alreadyRegistered && (
          <SelfRegister seasonId={seasonId} onDone={(r) => (r.error ? flash({ ok: false, text: r.error }) : (flash({ ok: true, text: r.message ?? 'Registered.' }), router.refresh()))} />
        )}
        {memberRegistrationOpen && !canManage && !isLoggedIn && (
          <Button asChild size="sm"><Link href={`/login?returnTo=${encodeURIComponent(`/seasons/${seasonId}`)}`}>Sign in to register</Link></Button>
        )}
        {alreadyRegistered && !canManage && (
          <p className="inline-flex items-center gap-2 rounded-md border border-success/30 bg-success/[0.06] px-3 py-2 text-sm text-foreground"><UserPlus className="size-4 text-success" /> You&apos;re registered for this Season.</p>
        )}

        {canManage && isOpen && <AddPlayer seasonId={seasonId} run={run} />}
        {canManage && isOpen && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={pending}
            onClick={async () => {
              const res = await confirm({
                title: 'Close Registration?',
                message: 'Registration will close, the entrant list will lock, and every player’s current Rankings rating will be captured for Season seeding.',
                confirmLabel: 'Close Registration',
                cancelLabel: 'Keep Registration Open',
                action: async () => closeSeasonRegistrationAction(seasonId),
              })
              if (res.confirmed) router.refresh()
            }}
          >
            <Lock className="size-4" /> Close Registration
          </Button>
        )}
      </div>

      {/* Numbered entrant list: # · Preferred Name + CueVerse ID · Rating */}
      <div className="overflow-hidden rounded-md border border-border">
        <div className="flex items-center gap-3 border-b border-border bg-card/50 px-3 py-1.5 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          <span className="w-8 shrink-0 text-right">#</span>
          <span className="min-w-0 flex-1">Entrant</span>
          <span className="w-16 shrink-0 text-right">Rating</span>
          {canManage && isOpen && <span className="w-6 shrink-0" />}
        </div>
        <ul className="divide-y divide-border">
          {entrants.map((e, i) => (
            <li key={e.entrantId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="tabular w-8 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
              <PlayerName
                identity={{ cueverseId: e.cueverseId, preferredName: e.name }}
                href={e.slug ? `/players/${encodeURIComponent(e.slug)}` : null}
                size="sm"
                className="min-w-0 flex-1 text-foreground"
              />
              <span className="tabular w-16 shrink-0 text-right font-semibold text-foreground">{e.rating != null ? e.rating : <span className="font-normal text-muted-foreground">—</span>}</span>
              {canManage && isOpen && (
                <button aria-label={`Remove ${identityText({ cueverseId: e.cueverseId, preferredName: e.name })}`} onClick={() => run(() => removeSeasonEntrantAction(seasonId, e.entrantId))} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
              )}
            </li>
          ))}
          {entrants.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">No entrants yet{isOpen ? ' — be the first to register.' : '.'}</li>}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">{entrants.length} entrant{entrants.length === 1 ? '' : 's'}</p>
    </div>
  )
}

/**
 * One button. There is nothing else to satisfy.
 *
 * The Season password field lived here, and is gone: the site-wide policy is the sole gate, so a
 * member who is offered this control is already permitted to use it. Asking for a second secret
 * after already deciding "yes" was a gate that could only ever produce a refusal the member could
 * not act on.
 */
function SelfRegister({ seasonId, onDone }: { seasonId: number; onDone: (r: SeasonActionResult) => void }) {
  const [pending, start] = useTransition()
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); start(async () => onDone(await registerForSeasonAction(seasonId, ''))) }}
    >
      <Button size="sm" type="submit" disabled={pending}><UserPlus className="size-4" /> {pending ? 'Registering…' : 'Register for this Season'}</Button>
    </form>
  )
}

function AddPlayer({ seasonId, run }: { seasonId: number; run: (fn: () => Promise<SeasonActionResult>) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<{ playerId: string; primaryName: string; cueverseId: string | null }[]>([])
  const [searching, startSearch] = useTransition()
  const [creating, setCreating] = useState(false)

  const load = (value: string) => { setQ(value); startSearch(async () => setCandidates(await searchSeasonPlayersAction(seasonId, value.trim()))) }
  const openList = () => { setOpen(true); if (candidates.length === 0) load('') }

  return (
    <div className="relative max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <input value={q} onChange={(e) => load(e.target.value)} onFocus={openList} onClick={openList} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Add player by name or CueVerse ID…" className="w-72 rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm" aria-label="Add player" />
      </div>
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-72 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg">
          {searching && <li className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</li>}
          {!searching && candidates.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">No eligible players — create one below.</li>}
          {candidates.map((c) => (
            <li key={c.playerId}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => run(async () => { const r = await addSeasonEntrantAction(seasonId, c.playerId); setQ(''); setCandidates([]); setOpen(false); return r })} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                <PlayerName identity={{ cueverseId: c.cueverseId, preferredName: c.primaryName }} inline />
                <Plus className="size-3.5 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Reconstructing an old Season constantly turns up a player who has no account yet. Leaving
          the page to make one and coming back loses your place in a list of forty names, so the
          account is created HERE — through the same service the staff console uses, with the same
          validation and the same audit trail. */}
      <div className="mt-2">
        {creating
          ? <CreatePlayerInline seasonId={seasonId} run={run} onDone={() => { setCreating(false); load(q) }} />
          : (
            <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60">
              <UserPlus className="size-3.5" aria-hidden />
              Player not listed? Create one
            </button>
          )}
      </div>
    </div>
  )
}

/**
 * Create a player and enter them, in one step.
 *
 * Two things happen and either can fail, so they are reported separately: if the account is created
 * but the entry fails, it says so rather than reporting a flat failure that would send somebody back
 * to create a duplicate account. Only the CueVerse ID is required — the account starts on the shared
 * temporary password, exactly as it does in the staff console. No password is asked for or shown
 * here.
 */
function CreatePlayerInline({
  seasonId, run, onDone,
}: {
  seasonId: number
  run: (fn: () => Promise<SeasonActionResult>) => void
  onDone: () => void
}) {
  const [cueverseId, setCueverseId] = useState('')
  const [preferredName, setPreferredName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const id = cueverseId.trim()
    if (!id) { setError('A CueVerse ID is required.'); return }

    setBusy(true)
    const res = await createMemberAction({ cueverseId: id, preferredName: preferredName.trim() || undefined })
    if (!res.ok || !res.playerId) {
      setError(res.error ?? 'The player could not be created.')
      setBusy(false)
      return
    }
    const playerId = res.playerId
    setCueverseId('')
    setPreferredName('')
    setBusy(false)
    onDone()
    run(async () => addSeasonEntrantAction(seasonId, playerId))
  }

  return (
    <form onSubmit={submit} className="w-72 rounded-md border border-border bg-background p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">New player</p>
      <input value={cueverseId} onChange={(e) => setCueverseId(e.target.value)} placeholder="CueVerse ID" aria-label="CueVerse ID" autoFocus className="mb-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm" />
      <input value={preferredName} onChange={(e) => setPreferredName(e.target.value)} placeholder="Preferred name (optional)" aria-label="Preferred name" className="mb-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm" />
      {error && <p role="alert" className="mb-2 text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? 'Creating…' : 'Create and add'}</Button>
        <button type="button" onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </form>
  )
}
