'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Crown, Minus, Plus, Trophy } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityLines, identityText, NO_IDENTITY } from '@/lib/identity/display'

/**
 * The administrative playoff bracket: every tie on one screen, scored in place.
 *
 * ── Why this is dense and the public one is not ──────────────────────────────────────────────────
 * The public bracket is read once, by somebody looking for a result. This one is worked in — a
 * sixty-four player draw, entered a tie at a time, over an evening. The two jobs want opposite
 * layouts, and trying to serve both from one component is what produced a public bracket with score
 * inputs hidden inside it. So the presentation is separate and the SERVICES are shared: every save
 * here goes through the same canonical result path the rest of the site uses.
 *
 * ── What a match can be ──────────────────────────────────────────────────────────────────────────
 * Playable (both players known), waiting (a feeder has not resolved), or a bye. Only the first is
 * editable, and the other two say why rather than presenting a dead input.
 */

export interface ScoringSlotView {
  entrantId: number | null
  /** The username the match was seeded with — kept for byes and unresolved slots. */
  name: string | null
  /** The CueVerse ID. The identity: six players here are called Chris. */
  cueverseId?: string | null
  /** The Preferred Name, shown under the handle where the cell has room. */
  preferredName?: string | null
  seed: number | null
}

export interface ScoringMatchView {
  id: number
  round: number
  slot: number
  section: string | null
  label: string | null
  home: ScoringSlotView
  away: ScoringSlotView
  homeGames: number | null
  awayGames: number | null
  status: string
  winnerEntrantId: number | null
  forfeitEntrantId: number | null
  needsReview: boolean
  updatedAt: string
  /** True when nothing feeds this side, so an empty slot means "bye" rather than "not decided". */
  homeIsEntry: boolean
  awayIsEntry: boolean
  /** Which ties decide this one, for the waiting message. */
  feederLabels: string[]
  /** Empty, and nothing will ever arrive: a bye rather than a tie still to be decided. */
  homeIsBye: boolean
  awayIsBye: boolean
}

export interface ScoringRound {
  key: string
  name: string
  matches: ScoringMatchView[]
}

type Draft = { home: string; away: string }

/**
 * What a result is recorded THROUGH.
 *
 * A Season and a Tournament score a playoff identically — the same cells, the same FF, the same
 * refusal of a tie — but they write to different tables under different gates, and a Season also
 * offers to rebuild everything downstream when a completed result changes. A Tournament's action
 * has no such warning, so it simply never returns one and the dialog never opens.
 */
export interface ScoringApi {
  record(matchId: number, home: number, away: number, opts: ScoringOpts): Promise<ScoringResult>
  forfeit(matchId: number, forfeiter: 'home' | 'away', opts: ScoringOpts): Promise<ScoringResult>
}

export interface ScoringOpts {
  confirmRebuild?: boolean
  note?: string | null
  expectedUpdatedAt?: string
}

export interface ScoringResult {
  ok?: boolean
  error?: string
  message?: string
  conflict?: boolean
  /** Present only where changing a settled result would clear matches that followed from it. */
  warning?: { affected: { id: number; label: string }[] }
}

export function PlayoffScoring({ rounds, api }: { rounds: ScoringRound[]; api: ScoringApi }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [confirm, setConfirm] = useState<{ matchId: number; labels: string[]; apply: () => void } | null>(null)
  /*
   * Overwriting a score that is already recorded.
   *
   * Saving now happens on Enter or on leaving the cell, which is what makes the cards small — but it
   * also means a stray keystroke in a decided match would rewrite a result with no deliberate act at
   * all. A recorded score therefore asks once before it is replaced. An empty match saves straight
   * away, because there is nothing to lose.
   */
  const [editing, setEditing] = useState<
    { matchId: number; from: string; to: string; apply: () => void } | null
  >(null)
  /** Fit Bracket by default; the control is there for a draw too wide to read at that size. */
  const [zoom, setZoom] = useState(1)

  const all = rounds.flatMap((r) => r.matches)
  const signature = all.map((m) => `${m.id}:${m.updatedAt}:${m.homeGames}:${m.awayGames}:${m.needsReview}`).join('|')
  const [sig, setSig] = useState(signature)
  if (sig !== signature) { setSig(signature); setDrafts({}); setErrors({}) }

  const initialOf = (m: ScoringMatchView): Draft =>
    m.status === 'FORFEIT'
      ? { home: m.forfeitEntrantId === m.home.entrantId ? 'FF' : '', away: m.forfeitEntrantId === m.away.entrantId ? 'FF' : '' }
      : { home: m.homeGames != null ? String(m.homeGames) : '', away: m.awayGames != null ? String(m.awayGames) : '' }

  const draftOf = (m: ScoringMatchView) => drafts[m.id] ?? initialOf(m)
  const setCell = (id: number, side: 'home' | 'away', v: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? initialOf(all.find((m) => m.id === id)!)), [side]: v } }))
  const setErr = (id: number, e: string | null) =>
    setErrors((m) => { const n = { ...m }; if (e) n[id] = e; else delete n[id]; return n })

  /**
   * Interpret the two cells and save through the canonical service.
   *
   * The same vocabulary as the group stage — numbers, or FF in the forfeiting player's cell alone —
   * minus the draw, which a playoff tie cannot have, and minus KO, which is not entered anywhere any
   * more.
   */
  const save = (m: ScoringMatchView, opts: { confirmRebuild?: boolean; confirmEdit?: boolean } = {}) => {
    const d = draftOf(m)
    const h = d.home.trim().toUpperCase()
    const a = d.away.trim().toUpperCase()
    setErr(m.id, null)

    /*
     * Nothing typed, nothing to do — this fires on every blur, including tabbing straight through.
     */
    const recorded = m.homeGames != null && m.awayGames != null
    const wasHome = m.homeGames == null ? '' : String(m.homeGames)
    const wasAway = m.awayGames == null ? '' : String(m.awayGames)
    if (h === wasHome && a === wasAway) return

    if (recorded && !opts.confirmEdit) {
      setEditing({
        matchId: m.id,
        from: `${wasHome}–${wasAway}`,
        to: `${h || '—'}–${a || '—'}`,
        apply: () => save(m, { ...opts, confirmEdit: true }),
      })
      return
    }

    if (h === 'KO' || a === 'KO') {
      setErr(m.id, 'KO is not entered here. Manage the entrant instead.')
      return
    }
    if (h === 'FF' || a === 'FF') {
      if (h === 'FF' && a === 'FF') { setErr(m.id, 'Only one player can forfeit.'); return }
      if ((h === 'FF' && a !== '') || (a === 'FF' && h !== '')) {
        setErr(m.id, 'FF goes in the forfeiting player’s cell only; leave the opponent blank.')
        return
      }
      const forfeiter = h === 'FF' ? 'home' : 'away'
      start(async () => {
        const r = await api.forfeit(m.id, forfeiter, { expectedUpdatedAt: m.updatedAt, ...opts })
        if (r.warning) { setConfirm({ matchId: m.id, labels: r.warning.affected.map((x) => x.label), apply: () => save(m, { confirmRebuild: true }) }); return }
        if (r.error) { setErr(m.id, r.error); return }
        setMsg({ ok: true, text: r.message ?? 'Saved.' })
        router.refresh()
      })
      return
    }

    if (h === '' && a === '') return
    if (h === '' || a === '') { setErr(m.id, 'Enter both scores.'); return }
    if (!/^\d+$/.test(h) || !/^\d+$/.test(a)) { setErr(m.id, 'Whole numbers, or FF.'); return }
    const hn = Number(h)
    const an = Number(a)
    if (hn === 0 && an === 0) return
    if (hn === an) { setErr(m.id, 'A playoff tie needs a winner — equal scores are refused.'); return }

    start(async () => {
      const r = await api.record(m.id, hn, an, { expectedUpdatedAt: m.updatedAt, ...opts })
      if (r.warning) { setConfirm({ matchId: m.id, labels: r.warning.affected.map((x) => x.label), apply: () => save(m, { confirmRebuild: true }) }); return }
      if (r.error) { setErr(m.id, r.error); return }
      setMsg({ ok: true, text: r.message ?? 'Saved.' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {msg && (
        <div role="status" className={cn('rounded-md border px-3 py-1.5 text-xs',
          msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          Enter each player&rsquo;s games, or <b className="text-foreground">FF</b> in the forfeiting
          player&rsquo;s cell with the opponent blank. A playoff tie cannot be drawn.
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))} className={zoomBtn}>
            <Minus className="size-3" aria-hidden />
          </button>
          <button type="button" onClick={() => setZoom(1)} className={cn(zoomBtn, 'px-2')}>Fit</button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.1).toFixed(2)))} className={zoomBtn}>
            <Plus className="size-3" aria-hidden />
          </button>
        </span>
      </div>

      {/* The only scroller: the page itself never scrolls sideways. */}
      {/*
        Horizontal only, and no height cap.

        This board had the same fixed-height scroller the public bracket did: a 78vh box with its own
        vertical scrollbar, so a tall bracket was cut off and had to be scrolled INSIDE a panel on a
        page with room to spare. The section is now as tall as the bracket and the page scrolls to
        reach the rest of it. `overflow-y-visible` is what keeps that true — any other y value turns
        the x axis back into a scroll container and the inner scrollbar returns.
      */}
      <div className="scrollbar-themed overflow-x-auto overflow-y-visible cyber-clip border border-[var(--bracket-outline)] bg-[var(--bracket-canvas)]">
        <div className="flex min-w-max items-start gap-3 p-2" style={{ fontSize: `${zoom}rem` }}>
          {rounds.map((round) => (
            <section key={round.key} className="min-w-[13rem] shrink-0">
              {/* A round heading is not a result, so it does not get gold. */}
              <h3 className="sticky top-0 z-10 mb-1 bg-[var(--bracket-canvas)]/95 px-1 py-1 text-[0.6em] font-semibold uppercase tracking-wide text-[var(--bracket-text-neutral)] backdrop-blur">
                {round.name}
              </h3>
              <ul className="space-y-1">
                {round.matches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    draft={draftOf(m)}
                    error={errors[m.id]}
                    pending={pending}
                    onCell={(side, v) => setCell(m.id, side, v)}
                    onSave={() => save(m)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      {editing && (
        <EditScoreDialog
          from={editing.from}
          to={editing.to}
          onCancel={() => setEditing(null)}
          onConfirm={() => { const go = editing.apply; setEditing(null); go() }}
        />
      )}
      {confirm && (
        <RebuildDialog
          labels={confirm.labels}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const go = confirm.apply; setConfirm(null); go() }}
        />
      )}
    </div>
  )
}

function MatchCard({
  match, draft, error, pending, onCell, onSave,
}: {
  match: ScoringMatchView
  draft: Draft
  error?: string
  pending: boolean
  onCell: (side: 'home' | 'away', v: string) => void
  onSave: () => void
}) {
  const bothKnown = match.home.entrantId != null && match.away.entrantId != null
  /*
   * An empty side nothing can ever reach is a bye; an empty side still expecting somebody is a tie
   * waiting on its feeder. `isBye` is the engine's verdict, so the board agrees with the bracket.
   */
  const homeBye = match.home.entrantId == null && match.homeIsBye
  const awayBye = match.away.entrantId == null && match.awayIsBye
  const isBye = (homeBye && match.away.entrantId != null) || (awayBye && match.home.entrantId != null)
  /*
   * Both sides empty for good: a position the bracket allocated and the field never reached, which
   * happens in a losers bracket when both feeding ties were byes. It is not waiting for anything.
   */
  const unused = homeBye && awayBye
  const waiting = !bothKnown && !isBye && !unused
  const decided = match.winnerEntrantId != null

  return (
    <li
      className={cn(
        'rounded border px-1.5 py-1',
        /* One card surface in every state. Review is told by its outline and its badge, not by a
           tinted fill that would put a third background colour on the board. */
        match.needsReview
          ? 'border-[var(--bracket-review)] bg-[var(--bracket-surface)]'
          : 'border-[var(--bracket-outline)] bg-[var(--bracket-surface)]',
      )}
    >
      <p className="mb-0.5 flex items-center gap-1 text-[0.6em] uppercase tracking-wide text-muted-foreground">
        {match.label ?? `R${match.round}`}
        {match.needsReview && (
          <span className="cyber-clip-sm border border-[var(--bracket-review)] px-1 text-[var(--bracket-review)]">Needs Review</span>
        )}
      </p>

      {(['home', 'away'] as const).map((side) => {
        const slot = match[side]
        const isWinner = decided && slot.entrantId === match.winnerEntrantId
        const forfeited = match.forfeitEntrantId != null && slot.entrantId === match.forfeitEntrantId
        const lines = identityLines({ cueverseId: slot.cueverseId, preferredName: slot.preferredName ?? slot.name })
        return (
          <div key={side} className="flex items-center gap-1">
            <span className="tabular w-4 shrink-0 text-right text-[0.6em] text-[var(--bracket-text-neutral)]">{slot.seed ?? ''}</span>
            {/*
              The handle, then the name.
              This board showed the seeded username alone — "Chris", "Kevin", "Josh" — which on a
              site with six Chrises names nobody. The CueVerse ID leads and the Preferred Name sits
              under it when the cell has room.
            */}
            {/*
              One row, not two.
              Both halves of the identity sit side by side so a slot is a single line — on a 32-player
              draw the second line was costing sixteen rows of height per column for information that
              fits perfectly well beside the handle.
            */}
            <span
              className={cn(
                'flex min-w-0 flex-1 items-baseline gap-1 truncate text-[0.75em]',
                isWinner ? 'font-semibold text-[var(--bracket-winner)]'
                : decided ? 'text-[var(--bracket-text-neutral)]'
                : 'text-[var(--bracket-text)]',
              )}
              title={identityText({ cueverseId: slot.cueverseId, preferredName: slot.preferredName ?? slot.name })}
            >
              <span className="shrink-0">
                {lines.primary === NO_IDENTITY
                  ? ((side === 'home' ? homeBye : awayBye) ? 'Bye' : 'TBD')
                  : lines.primary}
              </span>
              {lines.secondary && (
                <span className="min-w-0 truncate text-[0.85em] font-normal text-foreground/55">
                  · {lines.secondary}
                </span>
              )}
              {forfeited && <span className="shrink-0 text-[0.85em] text-destructive">FF</span>}
            </span>
            <input
              value={draft[side]}
              onChange={(e) => onCell(side, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave() } }}
              /*
               * Tabbing out commits, the same as Enter.
               *
               * The board is filled in by typing, and reaching for a button between every pair of
               * numbers is what made the cards tall in the first place. Leaving the cell is the same
               * intent as pressing Enter, so it does the same thing.
               */
              onBlur={onSave}
              disabled={!bothKnown || pending}
              aria-label={`${lines.primary === NO_IDENTITY ? 'Unknown' : identityText({ cueverseId: slot.cueverseId, preferredName: slot.preferredName ?? slot.name })} score`}
              title={waiting ? 'Waiting on an earlier match' : isBye ? 'A bye is advanced automatically' : undefined}
              className={cn(
                'h-5 w-8 shrink-0 rounded border bg-[var(--bracket-canvas)] text-center text-[0.7em] tabular text-[var(--bracket-text)] outline-none',
                'focus-visible:border-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-40',
                'border-input',
              )}
            />
          </div>
        )
      })}

      {waiting && (
        <p className="mt-0.5 text-[0.6em] text-muted-foreground">
          Waiting on {match.feederLabels.length ? match.feederLabels.join(' and ') : 'an earlier match'}.
        </p>
      )}
      {isBye && <p className="mt-0.5 text-[0.6em] text-muted-foreground">Bye — advanced automatically, no result recorded.</p>}
      {unused && <p className="mt-0.5 text-[0.6em] text-muted-foreground">Unused — both feeding matches were byes.</p>}
      {error && <p className="mt-0.5 text-[0.6em] text-destructive">{error}</p>}


    </li>
  )
}

/** Changing a decided winner rebuilds what came after it. */
/**
 * Replacing a score that is already recorded.
 *
 * Deliberately smaller than the rebuild warning: this one is a check that the edit was meant, not a
 * warning about consequences. When the change also moves the winner, the rebuild dialog follows it.
 */
function EditScoreDialog({ from, to, onCancel, onConfirm }: { from: string; to: string; onCancel: () => void; onConfirm: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="edit-score-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="w-full max-w-xs rounded-none border border-border bg-card p-4 shadow-xl">
        <h2 id="edit-score-title" className="font-display text-base font-bold text-foreground">Change this score?</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This tie is already recorded as{' '}
          <span className="tabular font-semibold text-foreground">{from}</span>. Save it as{' '}
          <span className="tabular font-semibold text-[var(--gold)]">{to}</span>?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Keep {from}
          </button>
          <button ref={confirmRef} type="button" onClick={onConfirm}
            className="rounded bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black hover:opacity-90">
            Change it
          </button>
        </div>
      </div>
    </div>
  )
}

function RebuildDialog({ labels, onCancel, onConfirm }: { labels: string[]; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="rebuild-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="w-full max-w-md rounded-none border border-border bg-card p-5 shadow-xl">
        <h2 id="rebuild-title" className="font-display text-lg font-bold text-foreground">This changes the winner</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The bracket after this tie was built on the old result. These matches are affected:
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-foreground">
          {labels.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel}
            className="cyber-clip-sm border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className="cyber-clip-sm bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90">
            Apply the correction
          </button>
        </div>
      </div>
    </div>
  )
}

/** The champion strip, once the Final has a winner. */
export function ChampionBanner({ champion, championCueverseId, runnerUp, runnerUpCueverseId, byForfeit }: {
  champion: string
  /** The champion is named by handle; a banner reading "Chris" crowns one of six people. */
  championCueverseId?: string | null
  runnerUp: string | null
  runnerUpCueverseId?: string | null
  byForfeit: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 cyber-clip border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-3 py-2">
      <Crown className="size-4 text-[var(--gold)]" aria-hidden />
      <span className="font-display font-bold text-[var(--gold)]">
        {identityText({ cueverseId: championCueverseId, preferredName: champion })}
        {byForfeit && <span aria-hidden>*</span>}
      </span>
      {runnerUp && (
        <span className="text-sm text-muted-foreground">
          def. {identityText({ cueverseId: runnerUpCueverseId, preferredName: runnerUp })}
        </span>
      )}
      {byForfeit && (
        <span className="w-full text-xs text-muted-foreground">
          <b className="text-foreground">FINAL WON BY FORFEIT</b> — * Championship awarded after the
          opponent forfeited the Final.
        </span>
      )}
    </div>
  )
}

export function NoBracketYet() {
  return (
    <p className="flex items-center gap-2 cyber-clip border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
      <Trophy className="size-4" aria-hidden /> The bracket is being prepared.
    </p>
  )
}

export function ReviewWarning({ count }: { count: number }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-[var(--gold)]/45 bg-[var(--attention-surface)] px-3 py-2 text-xs text-[var(--gold)]">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {count} match{count === 1 ? '' : 'es'} need{count === 1 ? 's' : ''} review: an earlier correction
      replaced a participant, so the recorded score belongs to a matchup that no longer exists.
      Re-enter {count === 1 ? 'it' : 'them'} to clear this. The Season cannot be completed until then.
    </p>
  )
}

const zoomBtn =
  'rounded border border-border px-1 py-0.5 text-[0.7rem] text-muted-foreground transition-colors hover:border-[var(--gold)]/50 hover:text-[var(--gold)]'
