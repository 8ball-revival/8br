'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Wand2, X, Copy, Check, AlertTriangle } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  previewGroupAssignAction, applyGroupAssignAction,
  previewGroupScoresAction, applyGroupScoresAction,
} from '@/lib/archive/actions'
import type { GroupAssignPlan, ScorePlan, AutoAssignBlocked } from '@/lib/archive/auto-assign'

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

type Mode = 'groups' | 'scores'

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
  const [plan, setPlan] = useState<GroupAssignPlan | ScorePlan | AutoAssignBlocked | null>(null)
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
    startTransition(async () => {
      const p = mode === 'groups'
        ? await previewGroupAssignAction(seasonId)
        : await previewGroupScoresAction(seasonId)
      setPlan(p)
    })
  }

  function apply() {
    startTransition(async () => {
      if (mode === 'groups') {
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

  const label = mode === 'groups' ? 'Auto Assign' : 'Auto Assign'
  const helper = mode === 'groups'
    ? 'Places entrants you have already added into the groups the archive recorded.'
    : 'Fills verified archived group results for entrants already assigned to groups.'

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
        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
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
            className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-lg border border-border bg-card sm:max-h-[85vh] sm:max-w-3xl sm:rounded-lg"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
              <div className="min-w-0">
                <h2 id="auto-assign-title" className="font-display text-lg font-bold">
                  {mode === 'groups' ? 'Auto Assign — group placement' : 'Auto Assign — group results'}
                </h2>
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
                mode === 'groups'
                  ? <GroupPreview plan={plan as GroupAssignPlan} />
                  : <ScorePreview plan={plan as ScorePlan} />
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
              >
                {result ? 'Close' : 'Cancel'}
              </button>
              {plan && !isBlockedPlan(plan) && !result && (
                <button
                  type="button"
                  onClick={apply}
                  disabled={pending}
                  className="rounded-full bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                >
                  {pending ? 'Applying…' : 'Apply Auto Assign'}
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
