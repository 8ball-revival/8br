'use client'

/**
 * The Entrants stage, for a Season or a Tournament.
 *
 * ── One board, two records ──────────────────────────────────────────────────────────────────────
 * Filling an entrant list is the same job either way: search somebody, add them, correct a misspelt
 * handle, take somebody out, and close the list when it is right. Only the ACTIONS differ, so those
 * are injected and everything else — the table, the row, the count, the close confirmation — is
 * written once. A second copy for Tournaments would be the same screen with different imports, and
 * the two would drift the first time one of them was improved.
 *
 * ── Identity is corrected HERE, canonically ─────────────────────────────────────────────────────
 * A misspelt handle is noticed while looking at the entrant list, not while browsing the member
 * table, so the fix belongs where it is noticed. It writes the canonical Player and propagates, so
 * it is the same correction the member editor makes — not a local relabelling of this one record.
 *
 * ── Closing is the irreversible bit ─────────────────────────────────────────────────────────────
 * Everything else here can be undone by clicking again. Closing settles the list and moves the
 * record on, so it asks first and says what it found before doing it.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Lock, Pencil, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityText } from '@/lib/identity/display'
import { PlayerSearch, type PlayerSearchResult } from '@/components/players/player-search'
import { updateEntrantIdentityAction } from '@/lib/creator/entrant-identity-actions'

export interface CreatorEntrant {
  entrantId: number
  playerId: string | null
  name: string
  cueverseId: string | null
  rating: number | null
}

/** What every action here answers with. Deliberately the shape both records already return. */
export interface BoardResult {
  ok?: boolean
  error?: string
  message?: string
}

/** What the close confirmation shows before it commits. */
export interface ClosePreflight {
  entrants: number
  noEntrants: boolean
  /** Season only: archived players that have not been entered yet. Omitted where it means nothing. */
  unresolvedArchive?: number | null
}

export interface EntrantsBoardApi {
  search: (term: string) => Promise<PlayerSearchResult[]>
  add: (playerId: string) => Promise<BoardResult>
  remove: (entrantId: number) => Promise<BoardResult>
  /** Offered when the search finds nobody: make the account and enter them in one step. */
  createAndAdd?: (handle: string) => Promise<BoardResult>
  closePreflight: () => Promise<ClosePreflight>
  /** Returns where to go once the list is settled. */
  close: () => Promise<{ error?: string; href?: string }>
}

export interface EntrantsBoardCopy {
  /** What closing does, in the record's own terms. */
  closeExplanation: string
  /** The confirming button, which says what happens rather than "OK". */
  closeConfirmLabel: string
  /** Shown when closing with an empty list. */
  emptyWarning: string
}

export function EntrantsBoard({
  entrants, isOpen, api, copy, extras, addHint,
}: {
  entrants: CreatorEntrant[]
  /** Registration is still open: entrants can be added and removed. */
  isOpen: boolean
  api: EntrantsBoardApi
  copy: EntrantsBoardCopy
  /** Record-specific controls above the list — the Season's Auto Add, for instance. */
  extras?: React.ReactNode
  addHint?: React.ReactNode
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [closing, setClosing] = useState<ClosePreflight | null>(null)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (t: { ok: boolean; text: string }) => {
    setToast(t)
    if (timer.current) clearTimeout(timer.current)
    if (t.ok) timer.current = setTimeout(() => setToast(null), 2500)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const run = (fn: () => Promise<BoardResult>) =>
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
          className={cn('rounded-md border px-3 py-2 text-sm',
            toast.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}
        >
          {toast.text}
        </div>
      )}

      {extras}

      <div className="flex flex-wrap items-start gap-3">
        {isOpen && (
          <div className="max-w-md flex-1">
            <PlayerSearch
              search={api.search}
              onPick={(r) => run(() => api.add(r.id))}
              label="Add entrant"
              placeholder="Add by name, CueVerse ID or an old handle…"
              footer={api.createAndAdd
                ? (term) => (
                  <CreateAndAdd
                    term={term}
                    onCreate={api.createAndAdd!}
                    onFlash={flash}
                    onDone={() => router.refresh()}
                  />
                )
                : undefined}
            />
            {addHint && <p className="mt-1 text-xs text-muted-foreground">{addHint}</p>}
          </div>
        )}
        {isOpen && (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setClosing(await api.closePreflight()))}
            className="ml-auto inline-flex items-center gap-1.5 cyber-clip-sm border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <Lock className="size-4" aria-hidden /> Close Registration
          </button>
        )}
      </div>

      {closing && (
        <CloseDialog
          preflight={closing}
          copy={copy}
          onClose={api.close}
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
              canEdit={isOpen}
              onRemove={() => run(() => api.remove(e.entrantId))}
              onFlash={flash}
            />
          ))}
          {entrants.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              No entrants yet{isOpen ? ' — add them above.' : '.'}
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
  index, entrant, canEdit, onRemove, onFlash,
}: {
  index: number
  entrant: CreatorEntrant
  canEdit: boolean
  onRemove: () => void
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
                onClick={onRemove}
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

/** Offered only when the search found nobody: make the account and enter them in one step. */
function CreateAndAdd({
  term, onCreate, onFlash, onDone,
}: {
  term: string
  onCreate: (handle: string) => Promise<BoardResult>
  onFlash: (t: { ok: boolean; text: string }) => void
  onDone: () => void
}) {
  const [creating, start] = useTransition()
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      disabled={creating}
      onClick={() => start(async () => {
        const r = await onCreate(term)
        if (r.error) { onFlash({ ok: false, text: r.error }); return }
        onFlash({ ok: true, text: r.message ?? `Created ${term} and added them.` })
        onDone()
      })}
      className="flex w-full items-center gap-1.5 text-left text-sm text-brand disabled:opacity-50"
    >
      {creating ? 'Creating…' : `Create “${term}” and add them`}
    </button>
  )
}

/** Close Registration: what it will do, and what it noticed before doing it. */
function CloseDialog({
  preflight, copy, onClose, onCancel, onError,
}: {
  preflight: ClosePreflight
  copy: EntrantsBoardCopy
  onClose: () => Promise<{ error?: string; href?: string }>
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
      const r = await onClose()
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
        <p className="mt-2 text-sm text-muted-foreground">{copy.closeExplanation}</p>

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
            {copy.emptyWarning}
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
            {pending ? 'Closing…' : copy.closeConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
