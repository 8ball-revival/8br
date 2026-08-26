'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Trophy } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityLines, identityText } from '@/lib/identity/display'
import { AutoAssignPanel } from '@/components/archive/auto-assign-panel'
import { BracketDraftBadge } from '@/components/bracket/primitives'
import type { AutoAssignAvailability } from '@/lib/archive/auto-assign'
import type { SeasonSeedRow } from '@/lib/seasons/playoffs'
import type { BracketTopology, EntrySlot, StartReadiness } from '@/lib/seasons/playoff-topology'
import { applySwap, canPlaceInto, describeSwap, sameSlot, type SlotRef } from '@/lib/seasons/bracket-swap'
import {
  setSeasonPlayoffIncludedAction, setSeasonPlayoffFieldAction, setSeasonPlayoffTypeAction,
  generateSeasonBracketAction, startSeasonPlayoffsAction, swapSeasonBracketSlotsAction,
  previewStartReadinessAction,
} from '@/lib/seasons/actions'

const SIZES = [2, 4, 8, 16, 32, 64, 128] as const

/**
 * Playoff setup: who is in, and where they sit.
 *
 * ── Two panels, because they answer two questions ────────────────────────────────────────────────
 * The left is the field — the group stage's own ordering, with a tick against everyone who played
 * the playoffs. The right is the draw. Selecting is a decision about the record; placing is a
 * decision about the bracket, and doing them on one list means neither is legible.
 *
 * ── The draft is private, and says so ────────────────────────────────────────────────────────────
 * Nothing here is on the Season page until Start Playoffs. That is worth stating on screen rather
 * than leaving to be discovered, because the whole point of a draft is that it can be wrong for a
 * while.
 */
export function PlayoffWorkspace({
  seasonId, seeding, topology, readiness, doubleElim, autoPlayoffs, autoPlacement,
}: {
  seasonId: number
  seeding: SeasonSeedRow[]
  topology: BracketTopology
  readiness: StartReadiness
  doubleElim: boolean
  autoPlayoffs?: AutoAssignAvailability
  autoPlacement?: AutoAssignAvailability
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [size, setSize] = useState<number | ''>('')
  const [confirmStart, setConfirmStart] = useState<StartReadiness | null>(null)
  const [confirmType, setConfirmType] = useState<boolean | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)
  /** The slot picked up, waiting for its partner. Click-then-click, so it works without a mouse. */
  const [picked, setPicked] = useState<SlotRef | null>(null)
  /** The card currently under the pointer, so invalid targets can say so before the drop. */
  const [dragging, setDragging] = useState<SlotRef | null>(null)
  /*
   * The slots as drawn, which may be one swap ahead of the server.
   *
   * Applying the exchange immediately makes dragging feel like moving a card rather than like
   * submitting a form. The cost is that a refusal has to put it back, so the pre-swap array is kept
   * and restored on failure — the alternative, leaving the optimistic state in place, would show an
   * arrangement the database does not have.
   */
  const [slots, setSlots] = useState<EntrySlot[]>(topology.entrySlots)
  const [announcement, setAnnouncement] = useState('')

  /*
   * A fresh render from the server is the truth; adopt it whenever the draft really changed.
   *
   * Adjusted during render rather than in an effect. `topology.entrySlots` is a new array on every
   * render, so an identity check would reset forever and an effect would paint the stale board
   * first and then correct it — a visible flicker on every keystroke elsewhere on the page. The
   * signature compares the CONTENT, so it changes exactly when a position does.
   */
  const serverSignature = topology.entrySlots.map((x) => `${x.matchId}:${x.side}:${x.entrantId ?? ''}`).join('|')
  const [signature, setSignature] = useState(serverSignature)
  if (signature !== serverSignature) {
    setSignature(serverSignature)
    setSlots(topology.entrySlots)
  }

  const hasDraft = topology.matches > 0
  const selectable = seeding.filter((r) => r.qualification !== 'KICKED_OUT')
  const allSelected = selectable.length > 0 && selectable.every((r) => r.included)

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn()
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' })
      router.refresh()
    })

  /**
   * Exchange two positions.
   *
   * The same path for both interactions, so a drag and a pair of clicks cannot disagree about what
   * a swap means. Refused targets never get here — see `canPlaceInto` — but the server checks again
   * regardless, and its refusal is what restores the board.
   */
  const commitSwap = (from: SlotRef, target: SlotRef) => {
    if (sameSlot(from, target)) return
    if (!canPlaceInto(topology.entryKeys, target) || !canPlaceInto(topology.entryKeys, from)) {
      setMsg({ ok: false, text: 'That position is decided by an earlier match — it cannot be set by hand.' })
      return
    }
    const before = slots
    setSlots(applySwap(slots, from, target))
    setAnnouncement(describeSwap(slots, from, target))
    start(async () => {
      const r = await swapSeasonBracketSlotsAction(seasonId, from, target)
      if (r.error) {
        // Put the board back exactly as it was: an optimistic arrangement the database refused is
        // worse than no move at all, because it looks saved.
        setSlots(before)
        setAnnouncement('The move was refused and has been undone.')
        setMsg({ ok: false, text: r.error })
        return
      }
      router.refresh()
    })
  }

  const swap = (target: SlotRef) => {
    if (!picked) { setPicked(target); return }
    const from = picked
    setPicked(null)
    if (sameSlot(from, target)) return
    commitSwap(from, target)
  }

  return (
    <div className="space-y-5">
      {msg && (
        <div
          role="status"
          className={cn('rounded-md border px-3 py-2 text-sm',
            msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}
        >
          {msg.text}
        </div>
      )}

      {/* Announcements for a screen reader: a swap is a visual change with nothing else to hear. */}
      <p aria-live="polite" className="sr-only">{announcement}</p>

      {/* A small marker rather than a full-width coloured banner: a warning stripe across the top of
          every draft is one people stop reading, and the page is already behind a staff gate. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <BracketDraftBadge />
        <p className="text-xs text-[var(--bracket-text-neutral)]">
          Nothing on this page appears on the Season page. The bracket becomes public only when you
          press Start Playoffs.
        </p>
      </div>

      {/* ── Controls ─────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-none border border-border bg-card/40 p-3">
        <span className="text-sm font-semibold text-foreground">Bracket:</span>
        <div className="inline-flex gap-1 rounded-none border border-input bg-card p-1">
          {[{ v: false, l: 'Single Elimination' }, { v: true, l: 'Double Elimination' }].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              disabled={pending}
              onClick={() => (hasDraft && doubleElim !== o.v ? setConfirmType(o.v) : run(() => setSeasonPlayoffTypeAction(seasonId, o.v)))}
              className={cn('rounded px-3 py-1.5 text-sm font-semibold transition-colors',
                doubleElim === o.v ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground')}
            >
              {o.l}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Size
          <select
            value={size}
            onChange={(e) => setSize(e.target.value === '' ? '' : Number(e.target.value))}
            className="rounded-none border border-input bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="">Smallest that fits</option>
            {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/*
            The workflow reads left to right: choose the field, then draw the bracket, then start.
            Select Playoff Entrants only ticks boxes. Apply Archive Placement reproduces the recorded
            draw and will draw the private bracket itself if there is none — which is why it does not
            wait for `hasDraft` the way Place Entrants does.
          */}
          {autoPlayoffs?.show && (
            <AutoAssignPanel seasonId={seasonId} mode="playoffs" disabledReason={autoPlayoffs.disabledReason} />
          )}
          {autoPlayoffs?.show && (
            <AutoAssignPanel seasonId={seasonId} mode="archive-placement" disabledReason={autoPlayoffs.disabledReason} />
          )}
          {hasDraft && autoPlacement?.show && (
            <AutoAssignPanel seasonId={seasonId} mode="placement" disabledReason={autoPlacement.disabledReason} />
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => (hasDraft
              ? setConfirmRegen(true)
              : run(() => generateSeasonBracketAction(seasonId, size === '' ? {} : { size })))}
            className="cyber-clip-sm border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            {hasDraft ? 'Regenerate Bracket' : 'Generate Bracket'}
          </button>
          <button
            type="button"
            disabled={pending || !readiness.ok}
            title={readiness.ok ? undefined : readiness.problems.join(' ')}
            onClick={() => start(async () => setConfirmStart(await previewStartReadinessAction(seasonId)))}
            className="inline-flex items-center gap-1.5 cyber-clip-sm bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <Trophy className="size-4" aria-hidden /> Start Playoffs
          </button>
        </div>
      </div>

      {!readiness.ok && readiness.problems.length > 0 && (
        <ul className="rounded-md border border-[var(--gold)]/45 bg-[var(--attention-surface)] px-3 py-2 text-xs text-[var(--gold)]">
          {readiness.problems.map((p, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />{p}
            </li>
          ))}
        </ul>
      )}

      {/* ── The two panels ───────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ParticipantTable
          seeding={seeding}
          allSelected={allSelected}
          pending={pending}
          onToggle={(entrantId, included) => run(() => setSeasonPlayoffIncludedAction(seasonId, entrantId, included))}
          onToggleAll={(included) => run(() => setSeasonPlayoffFieldAction(seasonId, included))}
        />
        <DraftBracket
          slots={slots}
          seeding={seeding}
          entryKeys={topology.entryKeys}
          picked={picked}
          dragging={dragging}
          onPick={swap}
          onDragStart={setDragging}
          onDragEnd={() => setDragging(null)}
          onDrop={(target) => { if (dragging) commitSwap(dragging, target); setDragging(null) }}
          hasDraft={hasDraft}
        />
      </div>

      {confirmType !== null && (
        <Confirm
          title="Change the bracket type?"
          body={`The current draft placement will be discarded and a ${confirmType ? 'double' : 'single'}-elimination bracket generated from the selection. An existing bracket is never reinterpreted as the other type.`}
          confirmLabel="Change and regenerate"
          onCancel={() => setConfirmType(null)}
          onConfirm={() => { const v = confirmType; setConfirmType(null); run(() => setSeasonPlayoffTypeAction(seasonId, v!)) }}
        />
      )}

      {confirmRegen && (
        <Confirm
          title="Regenerate the bracket?"
          body="The current draft placement will be replaced by a fresh draw from the selected participants and their seeds. Anything you arranged by hand, or placed from the archive, is discarded. Published brackets and recorded results are not affected."
          confirmLabel="Regenerate"
          onCancel={() => setConfirmRegen(false)}
          onConfirm={() => { setConfirmRegen(false); run(() => generateSeasonBracketAction(seasonId, size === '' ? {} : { size })) }}
        />
      )}

      {confirmStart && (
        <StartDialog
          seasonId={seasonId}
          readiness={confirmStart}
          onCancel={() => setConfirmStart(null)}
          onError={(text) => { setConfirmStart(null); setMsg({ ok: false, text }) }}
        />
      )}
    </div>
  )
}

/** The field, in the order the group stage decided. */
function ParticipantTable({
  seeding, allSelected, pending, onToggle, onToggleAll,
}: {
  seeding: SeasonSeedRow[]
  allSelected: boolean
  pending: boolean
  onToggle: (entrantId: number, included: boolean) => void
  onToggleAll: (included: boolean) => void
}) {
  return (
    <div className="overflow-hidden rounded-none border border-border">
      <div className="flex items-center gap-2 border-b border-[var(--bracket-outline)] bg-[var(--bracket-surface)] px-3 py-1.5">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={pending}
            onChange={(e) => onToggleAll(e.target.checked)}
            className="accent-[var(--gold)]"
          />
          Select All
        </label>
        <span className="ml-auto text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          {seeding.filter((r) => r.included).length} selected
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[0.65rem] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5 text-left font-medium">Sel</th>
              <th className="px-2 py-1.5 text-right font-medium">Seed</th>
              <th className="px-2 py-1.5 text-left font-medium">Entrant</th>
              <th className="px-2 py-1.5 text-left font-medium">Group</th>
              <th className="px-2 py-1.5 text-right font-medium">Pos</th>
              <th className="px-2 py-1.5 text-right font-medium">Pts</th>
              <th className="px-2 py-1.5 text-right font-medium">Record</th>
            </tr>
          </thead>
          <tbody>
            {seeding.map((r) => {
              const kicked = r.qualification === 'KICKED_OUT'
              return (
                <tr key={r.entrantId} className={cn('border-b border-border/60', kicked && 'opacity-50')}>
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={r.included}
                      disabled={pending || kicked}
                      title={kicked ? 'Kicked out — not eligible' : undefined}
                      aria-label={`Select ${r.cueverseId ?? r.name}`}
                      onChange={(e) => onToggle(r.entrantId, e.target.checked)}
                      className="accent-[var(--gold)]"
                    />
                  </td>
                  <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{r.overallSeed ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    {r.cueverseId && <span className="font-semibold text-[var(--gold)]">{r.cueverseId}</span>}
                    {r.cueverseId && r.name && <span className="text-muted-foreground"> · </span>}
                    <span className="text-muted-foreground">{r.name}</span>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">{r.group}</td>
                  <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{r.groupPosition}</td>
                  <td className="tabular px-2 py-1.5 text-right font-semibold text-foreground">{r.points}</td>
                  <td className="tabular px-2 py-1.5 text-right text-muted-foreground">{r.record}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * The draw, as positions rather than as a tree.
 *
 * ── Only genuine entrant positions are here ──────────────────────────────────────────────────────
 * Everything the bracket fills for itself is deliberately absent. Showing a round-two slot that
 * cannot be edited invites the attempt, and the refusal then reads as a bug rather than as the rule.
 *
 * ── The match marker ─────────────────────────────────────────────────────────────────────────────
 * A short muted connector into a small gold-outlined pill — M1, M2 — rather than a large coloured
 * elbow. It has to say which tie a pair of slots belongs to and then get out of the way; at forty
 * players the marker was competing with the names for attention and winning.
 */
function DraftBracket({
  slots, seeding, entryKeys, picked, dragging, onPick, onDragStart, onDragEnd, onDrop, hasDraft,
}: {
  slots: EntrySlot[]
  /** The entrant list the board was built from — the only place a slot's CueVerse ID lives. */
  seeding: SeasonSeedRow[]
  entryKeys: Set<string>
  picked: SlotRef | null
  dragging: SlotRef | null
  onPick: (t: SlotRef) => void
  onDragStart: (t: SlotRef) => void
  onDragEnd: () => void
  onDrop: (t: SlotRef) => void
  hasDraft: boolean
}) {
  if (!hasDraft) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center cyber-clip border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        Select the participants, then Generate Bracket to lay out the draw.
      </div>
    )
  }

  // Group the entry positions by the tie they belong to, in bracket order.
  const byMatch = new Map<number, EntrySlot[]>()
  for (const s of slots) {
    const list = byMatch.get(s.matchId) ?? []
    list.push(s)
    byMatch.set(s.matchId, list)
  }
  const ties = [...byMatch.entries()]
    .map(([matchId, slots]) => ({ matchId, slots: slots.sort((a, b) => (a.side === 'home' ? -1 : 1) - (b.side === 'home' ? -1 : 1)), ref: slots[0] }))
    .sort((a, b) => a.ref.round - b.ref.round || a.ref.slot - b.ref.slot)

  /*
   * Two columns read top to bottom, not side to side.
   *
   * A CSS grid fills row by row, so M1 and M2 landed beside each other and the numbers zig-zagged
   * down the board — you had to read left, right, left, right to follow the order. Splitting the
   * list in half puts M1–M8 down the left and M9–M16 down the right, which is how a draw sheet is
   * read and how the pill numbers now run.
   *
   * The halves are computed rather than left to CSS column balancing, so the split is exactly the
   * same for 8, 16, 32 or 128 matches instead of depending on how a browser decides to balance
   * heights. Stacked on a narrow screen the two halves fall one after the other, which is M1 through
   * Mn in true sequence.
   *
   * Presentation only: match ids, slot topology, seeding and feeder relationships are untouched —
   * `ties` itself is still in bracket order, and the M number is that order's index.
   */
  const half = Math.ceil(ties.length / 2)
  const columns = [ties.slice(0, half), ties.slice(half)]

  /*
   * The board only knows a slot's display name, which is not enough to identify anybody.
   *
   * There are six players called Chris on this site and six called Craig, so a slot reading "Chris"
   * is not a competitor — it is a coin toss. The seeding rows on the left already carry the CueVerse
   * ID, so the board looks the handle up by entrant and shows it as the identity, with the Preferred
   * Name alongside it where it adds something.
   */
  const identityOf = new Map<number, { cueverseId: string | null; name: string | null }>(
    seeding.map((r) => [r.entrantId, { cueverseId: r.cueverseId, name: r.name }]),
  )

  return (
    <div className="rounded-none border border-border p-3">
      <p id="draft-help" className="mb-2 text-xs text-muted-foreground">
        Drag a player onto another position to swap them, or click one and then the other — both do
        the same thing, so the board works without a mouse. Positions decided by an earlier match are
        not shown, because they cannot be set by hand.
      </p>
      <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
        {columns.map((column, c) => (
          <div key={c}>
            {/*
              Which half of the draw this is.
              Sixteen identical pills in two columns give no clue where one half ends and the other
              begins; naming the range makes the split readable at a glance.
            */}
            {column.length > 0 && (
              <p className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--gold)]/25 pb-1">
                {/*
                  Two halves of one bracket, not two brackets.
                  The wording says so explicitly, because "left" and "right" invite the reading that
                  these are separate draws.
                */}
                <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  Round 1 · {c === 0 ? 'Top half' : 'Bottom half'}
                </span>
                <span className="tabular shrink-0 text-[0.62rem] text-[var(--gold)]/70">
                  M{c === 0 ? 1 : half + 1}–M{c === 0 ? half : ties.length}
                </span>
              </p>
            )}
            <ul className="flex flex-col gap-3.5">
            {column.map((t) => {
              // The number is the match's place in the whole draw, not its place in this column.
              const i = c === 0 ? column.indexOf(t) : half + column.indexOf(t)
              return (
          <li key={t.matchId} className="flex items-center gap-2">
            {/* Short thin connector into the match pill. */}
            <span aria-hidden className="h-px w-3 shrink-0 bg-[var(--selected-surface)]" />
            <span
              className="shrink-0 cyber-clip-sm border border-[var(--gold)]/50 px-1.5 py-0.5 text-[0.65rem] font-semibold text-[var(--gold)]/80"
              title={`Round ${t.ref.round} · Match ${i + 1}`}
            >
              <span className="sr-only">Round {t.ref.round} · Match {i + 1}</span>
              <span aria-hidden>M{i + 1}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              {t.slots.map((s) => (
                <SlotButton
                  key={`${s.matchId}:${s.side}`}
                  slot={s}
                  identity={identityOf.get(s.entrantId ?? -1) ?? { cueverseId: null, name: s.entrantName }}
                  picked={!!picked && sameSlot(picked, s)}
                  dragging={!!dragging && sameSlot(dragging, s)}
                  droppable={!!dragging && !sameSlot(dragging, s) && canPlaceInto(entryKeys, s)}
                  anyDragging={!!dragging}
                  onPick={() => onPick({ matchId: s.matchId, side: s.side })}
                  onDragStart={() => onDragStart({ matchId: s.matchId, side: s.side })}
                  onDragEnd={onDragEnd}
                  onDrop={() => onDrop({ matchId: s.matchId, side: s.side })}
                />
              ))}
            </span>
          </li>
              )
            })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One position: a button first, draggable second.
 *
 * It stays a real <button> so it is reachable, focusable and operable from the keyboard whatever the
 * pointer is doing. Dragging is layered on top; nothing depends on it.
 */
function SlotButton({
  slot, identity, picked, dragging, droppable, anyDragging, onPick, onDragStart, onDragEnd, onDrop,
}: {
  slot: EntrySlot
  /**
   * The seated entrant's identity, resolved from the seeding rows.
   *
   * The slot itself only carries a display name, which on this site is not an identity — there are
   * six players called Chris. The handle comes from the entrant list the board was built from.
   */
  identity: { cueverseId: string | null; name: string | null }
  picked: boolean
  dragging: boolean
  /** A legal target for the card currently being dragged. */
  droppable: boolean
  anyDragging: boolean
  onPick: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDrop: () => void
}) {
  const empty = slot.entrantId == null
  const lines = identityLines({ cueverseId: identity.cueverseId, preferredName: identity.name })
  // While a drag is in progress, everything that is not a legal target says so rather than staying
  // neutral — an unmarked slot that silently refuses the drop reads as a broken interaction.
  const invalidTarget = anyDragging && !droppable && !dragging
  return (
    <button
      type="button"
      draggable={!empty}
      onClick={onPick}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `${slot.matchId}:${slot.side}`); onDragStart() }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { if (droppable) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
      onDrop={(e) => { if (droppable) { e.preventDefault(); onDrop() } }}
      aria-pressed={picked}
      aria-describedby="draft-help"
      aria-label={`${empty ? 'Bye' : identityText({ cueverseId: identity.cueverseId, preferredName: identity.name })}, seed ${slot.seed ?? 'none'}`}
      className={cn(
        'flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-xs transition-colors',
        !empty && 'cursor-grab active:cursor-grabbing',
        picked && 'border-[var(--bracket-focus)] bg-[var(--bracket-surface-raised)]',
        dragging && 'opacity-40',
        droppable && 'border-dashed border-[var(--bracket-focus)] bg-[var(--bracket-surface-raised)]',
        invalidTarget && 'cursor-not-allowed opacity-40',
        !picked && !droppable && !invalidTarget && 'border-[var(--bracket-outline)] bg-[var(--bracket-surface)] hover:border-[var(--bracket-focus)]/50',
      )}
    >
      <span className="tabular w-5 shrink-0 text-right text-[0.65rem] text-[var(--bracket-text-neutral)]">{slot.seed ?? ''}</span>
      {empty ? (
        <span className="min-w-0 flex-1 truncate italic text-[var(--bracket-text-muted)]">Bye</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          {/* A draft is a placement board: no tie has been played, so no identity is a winner and
              none of them is gold. */}
          <span className="truncate font-semibold text-[var(--bracket-text)]">{lines.primary}</span>
          {lines.secondary && (
            <span className="truncate text-[0.62rem] text-foreground/60">{lines.secondary}</span>
          )}
        </span>
      )}
    </button>
  )
}

/** Start Playoffs: what changes, said plainly. */
function StartDialog({
  seasonId, readiness, onCancel, onError,
}: {
  seasonId: number
  readiness: StartReadiness
  onCancel: () => void
  onError: (t: string) => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <Dialog labelledBy="start-playoffs-title" onCancel={onCancel}>
      <h2 id="start-playoffs-title" className="font-display text-lg font-bold text-foreground">Start Playoffs?</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>The bracket becomes <b className="text-foreground">public</b> on the Season page.</li>
        <li>Participants, seeds and bracket type lock for ordinary editing.</li>
        <li>
          {readiness.byes > 0
            ? `${readiness.byes} bye${readiness.byes === 1 ? '' : 's'} advance, with no score and no win recorded against them.`
            : 'No byes to advance at this size.'}
        </li>
        <li>Creator&rsquo;s correction tools can reopen the setup later if something needs changing.</li>
      </ul>
      {!readiness.ok && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">
          {readiness.problems.join(' ')}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onCancel} className={btnGhost}>Keep Editing</button>
        <button
          type="button"
          disabled={pending || !readiness.ok}
          onClick={() => start(async () => {
            const r = await startSeasonPlayoffsAction(seasonId)
            if (r.error) { onError(r.error); return }
            onCancel()
            router.refresh()
          })}
          className={btnGold}
        >
          {pending ? 'Starting…' : 'Start Playoffs'}
        </button>
      </div>
    </Dialog>
  )
}

function Confirm({
  title, body, confirmLabel, onCancel, onConfirm,
}: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <Dialog labelledBy="confirm-title" onCancel={onCancel}>
      <h2 id="confirm-title" className="font-display text-lg font-bold text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
        <button type="button" onClick={onConfirm} className={btnGold}>
          <Check className="mr-1 inline size-3.5" aria-hidden />{confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}

function Dialog({ labelledBy, onCancel, children }: { labelledBy: string; onCancel: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-none border border-border bg-card p-5 shadow-xl">
        {children}
      </div>
    </div>
  )
}

const btnGhost =
  'cyber-clip-sm border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60'
const btnGold =
  'cyber-clip-sm bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60'
