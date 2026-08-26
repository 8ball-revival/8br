'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Wand2, X, Copy, Check, AlertTriangle } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  previewGroupAssignAction, applyGroupAssignAction,
  previewGroupScoresAction, applyGroupScoresAction,
  previewAutoEntrantsAction, applyAutoEntrantsAction,
  previewArchiveSelectionAction, applyArchiveSelectionAction,
  previewArchivePlacementAction, applyArchivePlacementAction,
  previewPlacementAction, applyPlacementAction,
} from '@/lib/archive/actions'
import type { GroupAssignPlan, ScorePlan, AutoAssignBlocked } from '@/lib/archive/auto-assign'
import type { EntrantPlan } from '@/lib/archive/auto-entrants'
import type { PlayoffPlan, PlacementPlan } from '@/lib/archive/auto-playoffs'

/**
 * Auto Assign: the gold button, its preview, and the unresolved report.
 *
 * ── Preview first, always ────────────────────────────────────────────────────────────────────────
 * Clicking the button opens a dialog describing exactly what would change. Nothing is written until
 * Apply. That is not politeness — the archive is thirty thousand rows of somebody's history, and a
 * one-click rewrite of a Season with no chance to look at it first is how a mistake becomes
 * permanent before anybody notices.
 *
 * ── The unresolved list is the point ─────────────────────────────────────────────────────────────
 * A run that places thirty of forty entrants is a success only if the other ten are named, with the
 * reason. Everything that could not be resolved is listed, in plain language, and can be copied out.
 */

/**
 * The archive-assisted steps, in the order they are used.
 *
 * All of them share this panel: the same preview-then-apply shape, the same unresolved reporting,
 * the same dialog. Only the plan they render differs.
 *
 * `placement` is the one that runs LAST, on a bracket that already exists — the others build a
 * Season up to that point.
 */
type Mode = 'entrants' | 'groups' | 'scores' | 'playoffs' | 'placement' | 'archive-placement'

const isBlockedPlan = (v: unknown): v is AutoAssignBlocked =>
  typeof v === 'object' && v !== null && (v as { blocked?: boolean }).blocked === true

export function AutoAssignPanel({
  seasonId,
  mode,
  disabledReason,
}: {
  seasonId: number
  mode: Mode
  /** When the phase or the archive says no, the button explains rather than disappearing. */
  disabledReason?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<GroupAssignPlan | ScorePlan | EntrantPlan | PlayoffPlan | PlacementPlan | AutoAssignBlocked | null>(null)
  /** Replacing an arranged draft bracket is a second, deliberate confirmation. */
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Escape closes, and focus moves into the dialog when it opens — a dialog that leaves focus behind
  // is unusable by keyboard.
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function openPreview() {
    setResult(null)
    setPlan(null)
    setOpen(true)
    setConfirmReplace(false)
    startTransition(async () => {
      const p = mode === 'entrants' ? await previewAutoEntrantsAction(seasonId)
        : mode === 'groups' ? await previewGroupAssignAction(seasonId)
        : mode === 'scores' ? await previewGroupScoresAction(seasonId)
        : mode === 'placement' ? await previewPlacementAction(seasonId)
        : mode === 'archive-placement' ? await previewArchivePlacementAction(seasonId)
        : await previewArchiveSelectionAction(seasonId)
      setPlan(p as typeof plan)
    })
  }

  function apply() {
    startTransition(async () => {
      if (mode === 'entrants') {
        const r = await applyAutoEntrantsAction(seasonId)
        setResult(r.ok
          ? `Added ${r.added}. ${r.alreadyEntered} already entered, ${r.ambiguous} ambiguous, ${r.missing} with no account.`
          : r.error ?? 'That did not apply.')
      } else if (mode === 'playoffs') {
        /*
         * Selection only. This writes checkboxes and nothing else — no bracket is drawn, no slot
         * moves. `changed` is zero on a second run, which is how an operator can confirm their work
         * without manufacturing a history of changes.
         */
        const r = await applyArchiveSelectionAction(seasonId)
        setResult(r.ok
          ? (r.changed === 0
              ? `Already correct: ${r.selected} selected, ${r.excluded} unselected. Nothing changed.`
              : `Selected ${r.selected}, unselected ${r.excluded} (${r.changed} changed). `)
            + `${r.missing} missing, ${r.ambiguous} ambiguous.`
          : r.error ?? 'That did not apply.')
      } else if (mode === 'archive-placement') {
        const r = await applyArchivePlacementAction(seasonId, confirmReplace)
        setResult(r.ok
          ? `Placed ${r.placed} into the archived positions. `
            + `${r.unresolvedSlots} position(s) left for you, ${r.missing} missing, ${r.ambiguous} ambiguous.`
          : r.error ?? 'That did not apply.')
      } else if (mode === 'placement') {
        const r = await applyPlacementAction(seasonId)
        setResult(r.ok
          ? `Placed ${r.placed}.`
            + (r.skipped > 0 ? ` ${r.skipped} could not be confirmed — see the list above.` : ' Every archived player was confirmed.')
            + (r.displaced > 0 ? ` ${r.displaced} moved out of a seat you had set by hand.` : '')
          : r.error ?? 'That did not apply.')
      } else if (mode === 'groups') {
        const r = await applyGroupAssignAction(seasonId)
        setResult(r.ok
          ? `Placed ${r.placed}. ${r.alreadyCorrect} already correct, ${r.conflicts} left as you had them, ${r.unresolved} unresolved.`
          : r.error ?? 'That did not apply.')
      } else {
        const r = await applyGroupScoresAction(seasonId)
        setResult(r.ok
          ? `Applied ${r.applied}. ${r.alreadyMatched} already matched, ${r.conflicted} manual results untouched, ${r.unresolved} unresolved.`
          : r.error ?? 'That did not apply.')
      }
      router.refresh()
    })
  }

  const label = mode === 'entrants' ? 'Auto Add Entrants'
    : mode === 'groups' ? 'Assign Groups'
    : mode === 'scores' ? 'Fill Group Scores'
    : mode === 'placement' ? 'Place Entrants'
    : mode === 'archive-placement' ? 'Apply Archive Placement'
    : 'Select Playoff Entrants'

  const helper = mode === 'entrants'
    ? 'Finds this Season\u2019s archived players among existing accounts and enters them. Creates nobody.'
    : mode === 'groups'
      ? 'Places entrants you have already added into the groups the archive recorded.'
      : mode === 'scores'
        ? 'Fills verified archived group results for entrants already assigned to groups.'
        : mode === 'placement'
          ? 'Moves the players on this bracket into the positions the archive recorded. Places everyone it can confirm and names the rest.'
          : mode === 'archive-placement'
            ? 'Reproduces the archived draw: draws the private bracket if there is none, then seats every confirmed player in the exact position the archive recorded, including byes. Leaves anyone it cannot confirm for you. Nothing becomes public.'
          : 'Selects the archived playoff field and places it. Stops before Start Playoffs.'

  if (disabledReason) {
    return (
      <p className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        {disabledReason}
      </p>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        title={helper}
        className="inline-flex items-center gap-1.5 cyber-clip-sm bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <Wand2 className="size-4" aria-hidden />
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auto-assign-title"
            // Full height on a phone, a panel on a desktop. The body scrolls, not the page.
            className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg border border-border bg-card sm:max-h-[85vh] sm:max-w-3xl sm:cyber-clip"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
              <div className="min-w-0">
                <h2 id="auto-assign-title" className="font-display text-lg font-bold">{label}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{helper}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid size-8 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {pending && !plan && <p className="text-sm text-muted-foreground">Checking the archive…</p>}
              {result && <p className="rounded border border-border bg-muted/40 px-3 py-2 text-sm">{result}</p>}

              {plan && isBlockedPlan(plan) && (
                <p className="flex items-start gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {plan.reason}
                </p>
              )}

              {plan && !isBlockedPlan(plan) && !result && (
                mode === 'entrants' ? <EntrantPreview plan={plan as EntrantPlan} />
                  : mode === 'groups' ? <GroupPreview plan={plan as GroupAssignPlan} />
                  : mode === 'scores' ? <ScorePreview plan={plan as ScorePlan} />
                  : mode === 'placement' ? <PlacementPreview plan={plan as PlacementPlan} />
                  : <PlayoffPreview
                      plan={plan as PlayoffPlan}
                      confirmReplace={confirmReplace}
                      onConfirmReplace={setConfirmReplace}
                    />
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="cyber-clip-sm px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
              >
                {result ? 'Close' : 'Cancel'}
              </button>
              {plan && !isBlockedPlan(plan) && !result && (
                <button
                  type="button"
                  onClick={apply}
                  disabled={
                    pending
                    // A playoff plan that is refused, or an unconfirmed draft replacement, cannot apply.
                    || (mode === 'playoffs' && !!(plan as PlayoffPlan).refusal)
                    || (mode === 'playoffs'
                        && (plan as PlayoffPlan).draftPlacements > 0
                        && !confirmReplace)
                    || (mode === 'placement' && !!(plan as PlacementPlan).refusal)
                  }
                  className="cyber-clip-sm bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                >
                  {pending ? 'Applying…'
                    : mode === 'entrants' ? 'Add Matched Entrants'
                    : mode === 'playoffs' ? 'Build Bracket'
                    : mode === 'placement' ? 'Place Entrants'
                    : 'Apply Auto Assign'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Tally({ items }: { items: { label: string; value: number; tone?: 'good' | 'warn' }[] }) {
  return (
    <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="rounded border border-border bg-background/40 px-2 py-1.5">
          <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{i.label}</dt>
          <dd className={cn('text-lg font-bold tabular-nums',
            i.tone === 'good' && 'text-[var(--gold)]',
            i.tone === 'warn' && i.value > 0 && 'text-[var(--loss)]')}>
            {i.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function GroupPreview({ plan }: { plan: GroupAssignPlan }) {
  const report = [
    'UNRESOLVED ARCHIVE HANDLES',
    ...plan.unresolved.map((u) => `${u.rawHandle}\tgroup ${u.groupName}\tslot ${u.slot + 1}\t${u.reasonLabel}\t${u.message}`),
    '',
    'SELECTED ENTRANTS NOT IN THE ARCHIVE',
    ...plan.unusedEntrants.map((e) => `${e.displayName ?? ''}\t${e.cueverseId ?? ''}`),
  ].join('\n')

  return (
    <>
      <Tally items={[
        { label: 'Will place', value: plan.toPlace.length, tone: 'good' },
        { label: 'Already correct', value: plan.alreadyCorrect.length },
        { label: 'Conflicts', value: plan.conflicts.length, tone: 'warn' },
        { label: 'Unresolved', value: plan.unresolved.length, tone: 'warn' },
      ]} />

      <p className="mb-3 text-xs text-muted-foreground">
        The archive lists {plan.sourceParticipants} participants across {plan.sourceGroups} groups.
        Existing assignments you made by hand are kept.
      </p>

      {plan.toPlace.length > 0 && (
        <Section title={`Will be placed (${plan.toPlace.length})`}>
          <Table head={['Entrant', 'CueVerse ID', 'Archive handle', 'Group', 'Slot', 'Why']}>
            {plan.toPlace.map((p) => (
              <tr key={p.entrantId} className="border-b border-border/50">
                <Td>{p.displayName}</Td><Td mono>{p.cueverseId}</Td><Td mono>{p.rawHandle}</Td>
                <Td>{p.groupName}</Td><Td>{p.slot + 1}</Td>
                <Td muted>{p.reasonLabel}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {plan.conflicts.length > 0 && (
        <Section title={`Already placed somewhere else — left as they are (${plan.conflicts.length})`}>
          <Table head={['Entrant', 'Archive handle', 'You put them in', 'Archive says']}>
            {plan.conflicts.map((c) => (
              <tr key={c.entrantId} className="border-b border-border/50">
                <Td>{c.displayName}</Td><Td mono>{c.rawHandle}</Td>
                <Td>{c.currentGroup}</Td><Td>{c.archiveGroup}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {plan.unresolved.length > 0 && (
        <Section title={`Could not be placed (${plan.unresolved.length})`} report={report}>
          <Table head={['Archive handle', 'Group', 'Slot', 'Reason', 'Suggestions']}>
            {plan.unresolved.map((u) => (
              <tr key={`${u.rawHandle}-${u.groupName}-${u.slot}`} className="border-b border-border/50">
                <Td mono>{u.rawHandle}</Td><Td>{u.groupName}</Td><Td>{u.slot + 1}</Td>
                <Td muted>{u.reasonLabel}</Td>
                <Td muted>
                  {u.suggestions.length === 0 ? '—' : u.suggestions.map((s) => s.cueverseId ?? s.displayName).join(', ')}
                </Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {plan.unusedEntrants.length > 0 && (
        <Section title={`Entrants you added that the archive does not list (${plan.unusedEntrants.length})`}>
          <p className="mb-2 text-xs text-muted-foreground">Left exactly as they are — nothing is ever removed.</p>
          <Table head={['Entrant', 'CueVerse ID']}>
            {plan.unusedEntrants.map((e) => (
              <tr key={e.entrantId} className="border-b border-border/50">
                <Td>{e.displayName}</Td><Td mono>{e.cueverseId}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
    </>
  )
}

function ScorePreview({ plan }: { plan: ScorePlan }) {
  const shown = plan.rows.filter((r) => r.status !== 'already-matches')
  const report = [
    'GROUP RESULTS NOT APPLIED',
    ...plan.rows
      .filter((r) => !['will-apply', 'already-matches'].includes(r.status))
      .map((r) => `${r.groupName}\t${r.aHandle} v ${r.bHandle}\t${r.scoreA ?? '?'}-${r.scoreB ?? '?'}\t${r.statusLabel}`),
  ].join('\n')

  return (
    <>
      <Tally items={[
        { label: 'Will apply', value: plan.willApply, tone: 'good' },
        { label: 'Already match', value: plan.alreadyMatches },
        { label: 'Manual conflicts', value: plan.conflicts, tone: 'warn' },
        { label: 'Unresolved', value: plan.unresolved, tone: 'warn' },
      ]} />

      {plan.standingsOnly && (
        <p className="mb-3 rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Standings available; exact match-level scores unavailable. Nothing will be applied — a score
          invented from a table of totals would not be the result that was played.
        </p>
      )}
      <p className="mb-3 text-xs text-muted-foreground">
        Existing results you entered by hand are never overwritten.
      </p>

      <Section title={`Results (${shown.length} needing attention, ${plan.alreadyMatches} already correct)`} report={report}>
        <Table head={['Group', 'Pairing', 'Archive', 'Currently', 'Status']}>
          {shown.slice(0, 300).map((r, i) => (
            <tr key={`${r.groupName}-${r.aHandle}-${r.bHandle}-${i}`} className="border-b border-border/50">
              <Td>{r.groupName}</Td>
              <Td mono>{r.aHandle} v {r.bHandle}</Td>
              <Td>{r.scoreA != null ? `${r.scoreA}–${r.scoreB}` : '—'}</Td>
              <Td>{r.currentA != null ? `${r.currentA}–${r.currentB}` : '—'}</Td>
              <Td muted>{r.statusLabel}</Td>
            </tr>
          ))}
        </Table>
        {shown.length > 300 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the first 300 of {shown.length}. The copied report has every one.
          </p>
        )}
      </Section>
    </>
  )
}

function EntrantPreview({ plan }: { plan: EntrantPlan }) {
  const report = [
    'ARCHIVED PLAYERS WITH NO ACCOUNT',
    ...plan.missing.map((m) => m.rawHandle),
    '',
    'AMBIGUOUS',
    ...plan.ambiguous.map((a) => `${a.rawHandle}\t${a.candidates.map((c) => c.cueverseId ?? c.displayName).join(' | ')}`),
  ].join('\n')

  return (
    <>
      <Tally items={[
        { label: 'Will add', value: plan.toAdd.length, tone: 'good' },
        { label: 'Already entered', value: plan.alreadyEntered.length },
        { label: 'Ambiguous', value: plan.ambiguous.length, tone: 'warn' },
        { label: 'No account', value: plan.missing.length, tone: 'warn' },
      ]} />

      <p className="mb-3 text-xs text-muted-foreground">
        The archive lists {plan.sourceParticipants} people for this Season. Only existing accounts are
        entered — no Player, account or alias is created, and nobody is assigned to a group.
      </p>

      {plan.toAdd.length > 0 && (
        <Section title={`Will be added (${plan.toAdd.length})`}>
          <Table head={['Archive handle', 'Preferred Name', 'CueVerse ID', 'Why']}>
            {plan.toAdd.map((a) => (
              <tr key={a.playerId} className="border-b border-border/50">
                <Td mono>{a.rawHandle}</Td><Td>{a.displayName}</Td><Td mono>{a.cueverseId}</Td>
                <Td muted>{a.reasonLabel}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {plan.ambiguous.length > 0 && (
        <Section title={`More than one account could be these (${plan.ambiguous.length})`} report={report}>
          <Table head={['Archive handle', 'Possible accounts']}>
            {plan.ambiguous.map((a) => (
              <tr key={a.rawHandle} className="border-b border-border/50">
                <Td mono>{a.rawHandle}</Td>
                <Td muted>{a.candidates.map((c) => c.cueverseId ?? c.displayName).join(', ')}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {plan.missing.length > 0 && (
        <Section title={`No account exists for these (${plan.missing.length})`} report={report}>
          <p className="mb-2 text-xs text-muted-foreground">
            Listed by the exact archived handle, so they can be created by hand and this run repeated.
          </p>
          <Table head={['Archive handle', 'Closest existing accounts']}>
            {plan.missing.map((m) => (
              <tr key={m.rawHandle} className="border-b border-border/50">
                <Td mono>{m.rawHandle}</Td>
                <Td muted>
                  {m.suggestions.length === 0 ? '—' : m.suggestions.map((sg) => sg.cueverseId ?? sg.displayName).join(', ')}
                </Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {plan.alreadyEntered.length > 0 && (
        <Section title={`Already entered (${plan.alreadyEntered.length})`}>
          <Table head={['Archive handle', 'Preferred Name', 'CueVerse ID']}>
            {plan.alreadyEntered.map((a) => (
              <tr key={a.rawHandle} className="border-b border-border/50">
                <Td mono>{a.rawHandle}</Td><Td>{a.displayName}</Td><Td mono>{a.cueverseId}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
    </>
  )
}

/**
 * Place Entrants: what will move, and who could not be confirmed.
 *
 * The unconfirmed list is the reason this screen exists. Reproducing a fifteen-year-old draw is
 * mostly a matter of finding out which handles no longer resolve to anybody, so each one is named
 * with the reason rather than rolled into a count — a number tells you there is a problem, a name
 * tells you where to go and look.
 */
function PlacementPreview({ plan }: { plan: PlacementPlan }) {
  const moving = plan.place.filter((x) => !x.alreadyThere)
  const settled = plan.place.length - moving.length

  const REASONS: Record<PlacementPlan['skipped'][number]['reason'], string> = {
    'not-an-entrant': 'Not an entrant in this Season',
    ambiguous: 'More than one entrant could be them',
    'no-recorded-seat': 'The archive records no first-round seat',
    'slot-not-in-bracket': 'Their slot is not in this bracket',
    refused: 'The bracket refused the placement',
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        {plan.place.length} of {plan.place.length + plan.skipped.length} archived players can be placed
        {settled > 0 && <> — {settled} already sitting where the archive puts them</>}.
        {plan.bracketSize != null && <> The archive recorded a {plan.bracketSize}-player bracket.</>}
      </p>

      {plan.refusal && (
        <p className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {plan.refusal}
        </p>
      )}

      {moving.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5 text-foreground">Moving ({moving.length})</p>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-border bg-background/40 p-2">
            {moving.map((x) => (
              <li key={`${x.matchNo}:${x.side}`} className="flex items-baseline gap-2">
                <span className="tabular w-6 shrink-0 text-right text-xs text-muted-foreground">{x.seed ?? '–'}</span>
                <span className="min-w-0 flex-1 truncate">
                  {x.displayName ?? x.rawHandle}
                  {x.cueverseId && <span className="ml-1.5 text-xs text-muted-foreground">- {x.cueverseId}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  match {x.matchNo}{x.side === 'a' ? ' (top)' : ' (bottom)'}{x.bye ? ' · bye' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.skipped.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5 text-warning">Could not be confirmed ({plan.skipped.length})</p>
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded border border-warning/30 bg-warning/[0.06] p-2">
            {plan.skipped.map((x) => (
              <li key={x.rawHandle}>
                <span className="font-medium">{x.displayName ?? x.rawHandle}</span>
                {x.displayName && <span className="ml-1.5 text-xs text-muted-foreground">- {x.rawHandle}</span>}
                <span className="block text-xs text-muted-foreground">
                  {REASONS[x.reason]}{x.detail ? ` — ${x.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            Their positions are left exactly as they are. Nothing is guessed.
          </p>
        </div>
      )}

      {plan.displaced.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5 text-foreground">Moved out of a seat you set ({plan.displaced.length})</p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded border border-border bg-background/40 p-2">
            {plan.displaced.map((x) => (
              <li key={x.entrantId} className="truncate">
                {x.displayName ?? x.cueverseId}
                {x.displayName && x.cueverseId && <span className="ml-1.5 text-xs text-muted-foreground">- {x.cueverseId}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            The archive gives their seat to somebody else. They are taken off the bracket rather than
            moved somewhere it did not record.
          </p>
        </div>
      )}
    </div>
  )
}

function PlayoffPreview({
  plan,
  confirmReplace,
  onConfirmReplace,
}: {
  plan: PlayoffPlan
  confirmReplace: boolean
  onConfirmReplace: (v: boolean) => void
}) {
  // Not "did the archive record positions", but "can they be reproduced here" — see canPlaceExactly.
  const exactly = plan.canPlaceExactly
  const shortField = plan.placement === 'exact' && !plan.canPlaceExactly
  const report = [
    'ARCHIVED PLAYOFF PLAYERS NOT ENTERED IN THIS SEASON',
    ...plan.missing.map((m) => m.rawHandle),
    '',
    'AMBIGUOUS',
    ...plan.ambiguous.map((a) => `${a.rawHandle}\t${a.candidates.map((c) => c.cueverseId ?? c.displayName).join(' | ')}`),
  ].join('\n')

  return (
    <>
      <Tally items={[
        { label: 'In the playoffs', value: plan.include.length, tone: 'good' },
        { label: 'Will be unchecked', value: plan.exclude.length },
        { label: 'Not entered', value: plan.missing.length, tone: 'warn' },
        { label: 'Ambiguous', value: plan.ambiguous.length, tone: 'warn' },
      ]} />

      {plan.refusal && (
        <p className="mb-3 flex items-start gap-2 rounded border border-[var(--loss)]/40 bg-[var(--loss)]/5 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--loss)]" aria-hidden />
          {plan.refusal}
        </p>
      )}

      <p className="mb-3 rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {exactly
          ? `The archive records the full bracket: ${plan.bracketSize} slots, with each player's exact position.`
          : shortField
            ? `The archive records a ${plan.bracketSize}-slot bracket, but not everyone who played in it is `
              + 'an entrant here yet, and a smaller bracket has no slot to put them in. The right people '
              + 'will be selected and every position left empty. Add the missing accounts, enter them, and '
              + 'run this again to place everybody where the archive had them.'
            : 'The archive records WHO played but not where. Participants will be selected and every '
              + 'position left empty for you — its seeding for this Season is the viewer\u2019s own '
              + 'occurrence count, not a recorded order.'}
        {' '}This stops at playoff setup: nothing is published and no result is entered. You still press
        Start Playoffs yourself.
      </p>

      {plan.draftPlacements > 0 && (
        <label className="mb-3 flex items-start gap-2 rounded border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-3 py-2 text-xs">
          <input
            type="checkbox"
            checked={confirmReplace}
            onChange={(e) => onConfirmReplace(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            A draft bracket already holds <b>{plan.draftPlacements}</b> placement(s). Tick to replace
            it with the archived arrangement. Left unticked, nothing is rebuilt.
          </span>
        </label>
      )}

      <Section title={`Playoff field (${plan.include.length})`} report={report}>
        <Table head={exactly
          ? ['Archive handle', 'Player', 'CueVerse ID', 'Seed', 'Round', 'Slot', 'Bye']
          : ['Archive handle', 'Player', 'CueVerse ID', 'Currently in']}>
          {plan.include.slice(0, 200).map((i) => (
            <tr key={i.entrantId} className="border-b border-border/50">
              <Td mono>{i.rawHandle}</Td><Td>{i.displayName}</Td><Td mono>{i.cueverseId}</Td>
              {exactly ? (
                <>
                  <Td>{i.seed ?? '—'}</Td><Td>{i.firstRound}</Td>
                  <Td>{i.matchNo != null ? `${i.matchNo}${i.side ?? ''}` : '—'}</Td>
                  <Td muted>{i.bye ? 'Bye' : '—'}</Td>
                </>
              ) : (
                <Td muted>{i.alreadyIncluded ? 'Selected' : 'Not selected'}</Td>
              )}
            </tr>
          ))}
        </Table>
      </Section>

      {plan.missing.length > 0 && (
        <Section title={`Archived playoff players not entered in this Season (${plan.missing.length})`} report={report}>
          <p className="mb-2 text-xs text-muted-foreground">
            Add them with Auto Add Entrants, then run this again. They do not block the rest.
          </p>
          <Table head={['Archive handle']}>
            {plan.missing.map((m) => (
              <tr key={m.rawHandle} className="border-b border-border/50"><Td mono>{m.rawHandle}</Td></tr>
            ))}
          </Table>
        </Section>
      )}

      {plan.exclude.length > 0 && (
        <Section title={`Entrants not in the archived playoffs (${plan.exclude.length})`}>
          <p className="mb-2 text-xs text-muted-foreground">
            These stay entrants; they are only unchecked from the playoff field.
          </p>
          <Table head={['Player', 'CueVerse ID', 'Currently']}>
            {plan.exclude.slice(0, 200).map((e) => (
              <tr key={e.entrantId} className="border-b border-border/50">
                <Td>{e.displayName}</Td><Td mono>{e.cueverseId}</Td>
                <Td muted>{e.alreadyExcluded ? 'Already out' : 'Will be unchecked'}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {plan.unresolved.length > 0 && (
        <Section title="What the archive could not settle">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
            {plan.unresolved.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </Section>
      )}
    </>
  )
}

function Section({ title, children, report }: { title: string; children: React.ReactNode; report?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className="mb-5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {report && (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(report)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              } catch { /* a clipboard the browser will not grant is not worth an error */ }
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? 'Copied' : 'Copy report'}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/** Wide tables scroll inside their own box, so the dialog never scrolls sideways. */
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full min-w-[34rem] text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {head.map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, mono, muted }: { children: React.ReactNode; mono?: boolean; muted?: boolean }) {
  return (
    <td className={cn('px-2 py-1.5', mono && 'font-mono text-[0.7rem]', muted && 'text-muted-foreground')}>
      {children ?? '—'}
    </td>
  )
}
