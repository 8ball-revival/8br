'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Lock, RotateCcw, Trophy } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useUnsavedTotal } from '@/components/seasons/unsaved-groups'
import {
  previewCloseGroupsAction, previewReopenGroupsAction, closeSeasonGroupsAction,
  reopenSeasonGroupsAction, clearSeasonMatchAction,
} from '@/lib/seasons/actions'
import type { CloseGroupsPreflight, ReopenImpact } from '@/lib/seasons/group-close'

/**
 * The controls that end and un-end the group stage.
 *
 * They live outside the group tables because they act on all of them at once — and because closing
 * has to know about work the tables are still holding. `useUnsavedTotal` is how it finds out.
 */
/*
 * The stage controls sit ABOVE the tables, and stay put.
 *
 * They used to sit underneath, which is fine on a Season with two groups and wrong on one with
 * twelve: the only way to close the stage or move on to the playoffs was to scroll past every table
 * to find it, and the button that ends the stage is not something to go hunting for. Sticky, so it
 * is still there after scrolling into the standings to check them.
 *
 * `top-16` clears the site header, which is itself sticky at `top-0`; the same offset the other
 * secondary bars in the app use. `top-0` would park this underneath it.
 */
export function GroupStageControls({ seasonId, canClose }: { seasonId: number; canClose: boolean }) {
  const [pending, start] = useTransition()
  const [preflight, setPreflight] = useState<CloseGroupsPreflight | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const unsaved = useUnsavedTotal()

  if (!canClose) return null

  return (
    <div className="sticky top-16 z-30 -mx-1 mb-4 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setPreflight(await previewCloseGroupsAction(seasonId)))}
        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <Lock className="size-4" aria-hidden /> Close Groups
      </button>
      {unsaved > 0 && (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="size-3.5" aria-hidden />
          {unsaved} unsaved score{unsaved === 1 ? '' : 's'} — save each group before closing.
        </span>
      )}
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}

      {preflight && (
        <CloseDialog
          seasonId={seasonId}
          preflight={preflight}
          unsaved={unsaved}
          onClose={() => setPreflight(null)}
          onMessage={setMsg}
          onRefreshed={(next) => setPreflight(next)}
        />
      )}
    </div>
  )
}

function CloseDialog({
  seasonId, preflight, unsaved, onClose, onMessage, onRefreshed,
}: {
  seasonId: number
  preflight: CloseGroupsPreflight
  unsaved: number
  onClose: () => void
  onMessage: (s: string) => void
  onRefreshed: (p: CloseGroupsPreflight) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const blocked = !preflight.canClose || unsaved > 0

  const confirm = () =>
    start(async () => {
      setError(null)
      const r = await closeSeasonGroupsAction(seasonId)
      if (r.error) { setError(r.error); return }
      onMessage(r.message ?? 'Groups closed.')
      onClose()
      router.refresh()
    })

  const clearOne = (matchId: number) =>
    start(async () => {
      setError(null)
      const r = await clearSeasonMatchAction(seasonId, matchId)
      if (r.error) { setError(r.error); return }
      onRefreshed(await previewCloseGroupsAction(seasonId))
      router.refresh()
    })

  return (
    <Dialog labelledBy="close-groups-title" onClose={onClose}>
      <h2 id="close-groups-title" className="font-display text-lg font-bold text-foreground">Close Groups?</h2>

      {unsaved > 0 && (
        <p className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/[0.08] px-3 py-2 text-sm text-amber-500">
          {unsaved} score{unsaved === 1 ? '' : 's'} {unsaved === 1 ? 'is' : 'are'} typed but not saved. Close the dialog,
          press Save Group in each table, then come back — closing now would lock the standings without them.
        </p>
      )}

      {/*
        The malformed list comes first and blocks.
        A half-entered row is somebody's result that did not land. Sweeping it into No Contest under
        the same word that describes a fixture nobody played would destroy it quietly, so it has to
        be dealt with by name.
      */}
      {preflight.malformed.length > 0 && (
        <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/[0.06] px-3 py-2">
          <p className="text-sm font-semibold text-destructive">
            {preflight.malformed.length} match{preflight.malformed.length === 1 ? ' is' : 'es are'} half-entered and must be
            fixed first.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            These are not unplayed matches — each holds part of a result. Correct the score in the table, or clear it
            to unplayed here. They will never be turned into No Contest for you.
          </p>
          <ul className="mt-2 space-y-1">
            {preflight.malformed.map((m) => (
              <li key={m.matchId} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-foreground">{m.home} v {m.away}</span>
                <span className="text-muted-foreground">{m.detail}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => clearOne(m.matchId)}
                  className="ml-auto rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-50"
                >
                  Clear to unplayed
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preflight.unresolved > 0 ? (
        <div className="mt-3 rounded-md border border-border bg-card/50 px-3 py-2">
          <p className="text-sm text-foreground">
            {preflight.unresolved} match{preflight.unresolved === 1 ? '' : 'es'} {preflight.unresolved === 1 ? 'was' : 'were'} never
            played. Closing records {preflight.unresolved === 1 ? 'it' : 'them'} as <b>No Contest</b>:
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
            <li>no points</li>
            <li>no win, loss or draw</li>
            <li>no rating change</li>
            <li>no game differential</li>
            <li>no effect on any streak</li>
          </ul>
          {preflight.unresolvedMatchups.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {preflight.unresolvedMatchups.slice(0, 6).map((m) => `${m.home} v ${m.away}`).join(' · ')}
              {preflight.unresolvedMatchups.length > 6 && ` · and ${preflight.unresolvedMatchups.length - 6} more`}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Every match is resolved. The final standings will be locked.
        </p>
      )}

      {error && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onClose} className={btnGhost}>Keep Groups Open</button>
        <button
          type="button"
          onClick={confirm}
          disabled={pending || blocked}
          title={blocked ? 'Resolve the problems above first.' : undefined}
          className={btnGold}
        >
          {pending ? 'Closing…' : 'Close Groups'}
        </button>
      </div>
    </Dialog>
  )
}

/**
 * The closed state: what happened, and the two ways out of it.
 *
 * Reopen is red because it moves a finished stage backwards; Playoff Brackets is gold because it is
 * the way forward and the one almost everybody wants.
 */
export function GroupsClosedControls({ seasonId, playoffsHref }: { seasonId: number; playoffsHref: string }) {
  const [impact, setImpact] = useState<ReopenImpact | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="sticky top-16 z-30 -mx-1 mb-4 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setImpact(await previewReopenGroupsAction(seasonId)))}
        className="inline-flex items-center gap-1.5 rounded-full border border-destructive/60 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
      >
        <RotateCcw className="size-4" aria-hidden /> Reopen Groups
      </button>
      <Link href={playoffsHref} className={cn(btnGold, 'inline-flex items-center gap-1.5 no-underline')}>
        <Trophy className="size-4" aria-hidden /> Playoff Brackets
      </Link>
      <span className="text-sm text-muted-foreground">
        Groups are closed — advance to playoff selection, or reopen above to edit results.
      </span>

      {impact && <ReopenDialog seasonId={seasonId} impact={impact} onClose={() => setImpact(null)} />}
    </div>
  )
}

function ReopenDialog({ seasonId, impact, onClose }: { seasonId: number; impact: ReopenImpact; onClose: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [discard, setDiscard] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const confirm = () =>
    start(async () => {
      setError(null)
      const r = await reopenSeasonGroupsAction(seasonId, { discardDraftBracket: discard })
      if (r.error) { setError(r.error); return }
      onClose()
      router.refresh()
    })

  return (
    <Dialog labelledBy="reopen-groups-title" onClose={onClose}>
      <h2 id="reopen-groups-title" className="font-display text-lg font-bold text-foreground">Reopen Groups?</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Score entry unlocks and standings are recalculated as you edit. The group structure and every
        score already entered are kept. Publicly the Season returns to Group Stage Live.
      </p>

      {impact.requiresReview.length > 0 && (
        <div className="mt-3 rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/[0.06] px-3 py-2">
          <p className="text-sm font-semibold text-foreground">Worth checking afterwards</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {impact.requiresReview.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      )}

      {impact.draftPlayoffMatches > 0 && (
        <label className="mt-3 flex items-start gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={discard}
            onChange={(e) => setDiscard(e.target.checked)}
            className="mt-0.5 accent-[var(--gold)]"
          />
          <span>
            <span className="font-medium text-foreground">Also discard the bracket draft</span>
            <span className="block text-xs text-muted-foreground">
              Deletes the {impact.draftPlayoffMatches} unpublished playoff match{impact.draftPlayoffMatches === 1 ? '' : 'es'} and
              clears the playoff selection, so the bracket is rebuilt from the new standings. Leave this unticked to keep
              your arrangement and review it yourself. Published playoff results are never affected either way.
            </span>
          </span>
        </label>
      )}

      {error && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onClose} className={btnGhost}>Keep Groups Closed</button>
        <button type="button" onClick={confirm} disabled={pending} className={btnDanger}>
          {pending ? 'Reopening…' : 'Reopen Groups'}
        </button>
      </div>
    </Dialog>
  )
}

function Dialog({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl">
        {children}
      </div>
    </div>
  )
}

const btnGhost =
  'rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60'
const btnGold =
  'rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60'
const btnDanger =
  'rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50'
