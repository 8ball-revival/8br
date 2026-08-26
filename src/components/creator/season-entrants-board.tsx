'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Lock, Pencil, Search, UserPlus, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityText } from '@/lib/identity/display'
import { AutoAssignPanel } from '@/components/archive/auto-assign-panel'
import { createMemberAction } from '@/lib/staff/create-member'
import {
  searchSeasonPlayersAction, addSeasonEntrantAction, removeSeasonEntrantAction,
  type SeasonActionResult,
} from '@/lib/seasons/actions'
import { updateEntrantIdentityAction } from '@/lib/creator/entrant-identity-actions'
import {
  closeRegistrationPreflightAction, closeRegistrationToGroupsAction,
  type CloseRegistrationPreflight,
} from '@/lib/creator/season-entrants-actions'

export interface CreatorEntrant {
  entrantId: number
  playerId: string | null
  name: string
  cueverseId: string | null
  rating: number | null
}

/**
 * The Entrants stage.
 *
 * ── Identity is corrected HERE, canonically ──────────────────────────────────────────────────────
 * A misspelt handle is noticed while looking at the entrant list, not while browsing the member
 * table, so the fix belongs where it is noticed. It writes the canonical Player and propagates, so
 * it is the same correction the member editor makes — not a local relabelling of this one Season.
 *
 * ── Closing is the irreversible bit ──────────────────────────────────────────────────────────────
 * Everything else on this page can be undone by clicking again. Closing captures the seeding
 * snapshot and moves the Season on, so it asks first, and it says what it found: how many entrants,
 * and how many archived players are still unaccounted for.
 */
export function SeasonEntrantsBoard({
  seasonId,
  entrants,
  isOpen,
  showAutoAdd,
  autoAddDisabledReason,
}: {
  seasonId: number
  entrants: CreatorEntrant[]
  /** Registration is still open: entrants can be added and removed. */
  isOpen: boolean
  showAutoAdd: boolean
  autoAddDisabledReason: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [closing, setClosing] = useState<CloseRegistrationPreflight | null>(null)

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
    <div className="space-y-5">
      {toast && (
        <div
          role="status"
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            toast.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {toast.text}
        </div>
      )}

      {showAutoAdd && (
        <div className="flex flex-col items-start gap-1">
          <AutoAssignPanel seasonId={seasonId} mode="entrants" disabledReason={autoAddDisabledReason} />
          {!autoAddDisabledReason && (
            <span className="text-xs text-muted-foreground">
              Searches every existing account for this Season&rsquo;s archived players. Creates nobody &mdash;
              anyone without an account is listed for you to add by hand.
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {isOpen && <AddEntrant seasonId={seasonId} run={run} onFlash={flash} />}
        {isOpen && (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setClosing(await closeRegistrationPreflightAction(seasonId)))}
            className="ml-auto inline-flex items-center gap-1.5 cyber-clip-sm border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <Lock className="size-4" aria-hidden /> Close Registration
          </button>
        )}
      </div>

      {closing && (
        <CloseDialog
          seasonId={seasonId}
          preflight={closing}
          onCancel={() => setClosing(null)}
          onError={(text) => { setClosing(null); flash({ ok: false, text }) }}
        />
      )}

      <div className="overflow-hidden rounded-none border border-border">
        <div className="flex items-center gap-3 border-b border-border bg-card/50 px-3 py-1.5 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          <span className="w-8 shrink-0 text-right">#</span>
          <span className="min-w-0 flex-1">Entrant</span>
          <span className="w-16 shrink-0 text-right">Rating</span>
          <span className="w-16 shrink-0" />
        </div>
        <ul className="divide-y divide-border">
          {entrants.map((e, i) => (
            <EntrantRow
              key={e.entrantId}
              index={i + 1}
              entrant={e}
              seasonId={seasonId}
              canEdit={isOpen}
              run={run}
              onFlash={flash}
            />
          ))}
          {entrants.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              No entrants yet{isOpen ? ' — add them above, or use Auto Add Entrants.' : '.'}
            </li>
          )}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        {entrants.length} entrant{entrants.length === 1 ? '' : 's'}
        {!isOpen && ' · registration closed'}
      </p>
    </div>
  )
}

/** One entrant: read as a row, edited in place, removed with the ×. */
function EntrantRow({
  index, entrant, seasonId, canEdit, run, onFlash,
}: {
  index: number
  entrant: CreatorEntrant
  seasonId: number
  canEdit: boolean
  run: (fn: () => Promise<SeasonActionResult>) => void
  onFlash: (t: { ok: boolean; text: string }) => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, startSave] = useTransition()
  const [name, setName] = useState(entrant.name)
  const [handle, setHandle] = useState(entrant.cueverseId ?? '')

  const dirty = name.trim() !== entrant.name || handle.trim() !== (entrant.cueverseId ?? '')

  const save = () => {
    const playerId = entrant.playerId
    if (!playerId || !dirty) { setEditing(false); return }
    startSave(async () => {
      const r = await updateEntrantIdentityAction(playerId, {
        preferredName: name.trim(),
        cueverseId: handle.trim(),
      })
      if (r.error) { onFlash({ ok: false, text: r.error }); return }
      setEditing(false)
      onFlash({
        ok: true,
        text: r.propagated
          ? `Identity saved — updated in ${r.propagated} competition record${r.propagated === 1 ? '' : 's'}.`
          : 'Identity saved.',
      })
      router.refresh()
    })
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="tabular w-8 shrink-0 text-right text-xs text-muted-foreground">{index}</span>

      {editing ? (
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="CueVerse ID"
            aria-label="CueVerse ID"
            className="w-40 rounded-none border border-input bg-background px-2 py-1 text-sm font-semibold text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Preferred name"
            aria-label="Preferred name"
            className="w-48 rounded-none border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          />
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-foreground">
          {entrant.cueverseId && <span className="font-semibold text-[var(--gold)]">{entrant.cueverseId}</span>}
          {entrant.cueverseId && entrant.name && <span className="text-muted-foreground"> · </span>}
          {entrant.name && <span className="text-muted-foreground">{entrant.name}</span>}
        </span>
      )}

      <span className="tabular w-16 shrink-0 text-right font-semibold text-foreground">
        {entrant.rating != null ? entrant.rating : <span className="font-normal text-muted-foreground">—</span>}
      </span>

      <span className="flex w-16 shrink-0 items-center justify-end gap-1">
        {editing ? (
          <>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              aria-label="Save identity"
              className="rounded p-1 text-brand hover:bg-muted disabled:opacity-50"
            >
              <Check className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setName(entrant.name); setHandle(entrant.cueverseId ?? '') }}
              aria-label="Cancel"
              className="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" aria-hidden />
            </button>
          </>
        ) : (
          <>
            {entrant.playerId && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Edit ${identityText({ cueverseId: entrant.cueverseId, preferredName: entrant.name })}`}
                title="Correct this player's canonical name — the change reaches every record"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => run(() => removeSeasonEntrantAction(seasonId, entrant.entrantId))}
                aria-label={`Remove ${identityText({ cueverseId: entrant.cueverseId, preferredName: entrant.name })}`}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </>
        )}
      </span>
    </li>
  )
}

/** Search existing accounts, or create one for somebody who has never had a record here. */
function AddEntrant({
  seasonId, run, onFlash,
}: {
  seasonId: number
  run: (fn: () => Promise<SeasonActionResult>) => void
  onFlash: (t: { ok: boolean; text: string }) => void
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<{ playerId: string; primaryName: string; cueverseId: string | null }[]>([])
  const [searching, startSearch] = useTransition()
  const [creating, startCreate] = useTransition()

  const load = (value: string) => {
    setQ(value)
    startSearch(async () => setCandidates(await searchSeasonPlayersAction(seasonId, value.trim())))
  }
  const openList = () => { setOpen(true); if (candidates.length === 0) load('') }

  const createAndAdd = () => {
    const handle = q.trim()
    if (!handle) return
    startCreate(async () => {
      const made = await createMemberAction({ cueverseId: handle, preferredName: handle })
      if (made.error || !made.playerId) { onFlash({ ok: false, text: made.error ?? 'Could not create that account.' }); return }
      const added = await addSeasonEntrantAction(seasonId, made.playerId)
      if (added.error) { onFlash({ ok: false, text: added.error }); return }
      onFlash({ ok: true, text: `Created ${handle} and added them as an entrant.` })
      setQ(''); setOpen(false); router.refresh()
    })
  }

  return (
    <div className="relative max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => load(e.target.value)}
          onFocus={openList}
          onClick={openList}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Add entrant by name or CueVerse ID…"
          aria-label="Add entrant"
          className="w-80 rounded-none border border-border bg-background py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        />
      </div>
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-80 space-y-1 overflow-y-auto rounded-none border border-border bg-background p-1 shadow-lg">
          {searching && <li className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</li>}
          {!searching && candidates.map((c) => (
            <li key={c.playerId}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { run(() => addSeasonEntrantAction(seasonId, c.playerId)); setQ('') }}
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                {c.cueverseId && <span className="font-semibold text-[var(--gold)]">{c.cueverseId}</span>}
                {c.cueverseId && <span className="text-muted-foreground"> · </span>}
                <span className="text-muted-foreground">{c.primaryName}</span>
              </button>
            </li>
          ))}
          {!searching && candidates.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              {q.trim() ? 'No account matches that.' : 'Type a name or CueVerse ID.'}
            </li>
          )}
          {/*
            Creating an account from here is deliberate, and deliberately last.
            An archived Season will always contain a few people who never had an account, and sending
            the operator to the member console to make one — then back — for each of them is how a
            reconstruction stalls. Searching first means it is only reached when the search has
            genuinely come up empty.
          */}
          {q.trim() && (
            <li className="border-t border-border pt-1">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={createAndAdd}
                disabled={creating}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-brand hover:bg-muted disabled:opacity-50"
              >
                <UserPlus className="size-3.5" aria-hidden />
                {creating ? 'Creating…' : `Create “${q.trim()}” and add them`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** Close Registration: what it will do, and what it noticed before doing it. */
function CloseDialog({
  seasonId, preflight, onCancel, onError,
}: {
  seasonId: number
  preflight: CloseRegistrationPreflight
  onCancel: () => void
  onError: (text: string) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const confirm = () =>
    start(async () => {
      const r = await closeRegistrationToGroupsAction(seasonId)
      if (r.error || !r.href) { onError(r.error ?? 'Registration could not be closed.'); return }
      router.push(r.href)
    })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-reg-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-none border border-border bg-card p-5 shadow-xl">
        <h2 id="close-reg-title" className="font-display text-lg font-bold text-foreground">
          Close Registration?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The entrant list locks, every entrant&rsquo;s current Rankings rating is captured as the
          seeding snapshot, and the Season moves to Group Setup.
        </p>

        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Entrants</dt>
            <dd className="tabular font-semibold text-foreground">{preflight.entrants}</dd>
          </div>
          {preflight.unresolvedArchive != null && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Archived players not yet entered</dt>
              <dd className={cn('tabular font-semibold', preflight.unresolvedArchive > 0 ? 'text-[var(--gold)]' : 'text-foreground')}>
                {preflight.unresolvedArchive}
              </dd>
            </div>
          )}
        </dl>

        {preflight.noEntrants && (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
            This Season has no entrants. Closing now leaves nothing to draw groups from.
          </p>
        )}
        {!preflight.noEntrants && preflight.unresolvedArchive != null && preflight.unresolvedArchive > 0 && (
          <p className="mt-3 rounded-md border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-3 py-2 text-sm text-foreground">
            {preflight.unresolvedArchive} archived player{preflight.unresolvedArchive === 1 ? ' is' : 's are'} still
            outside the entrant list. Run Auto Add Entrants first if they belong in this Season.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={closeRef}
            type="button"
            onClick={onCancel}
            className="cyber-clip-sm border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Keep Registration Open
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="cyber-clip-sm bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            {pending ? 'Closing…' : 'Close and Set Up Groups'}
          </button>
        </div>
      </div>
    </div>
  )
}
