'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Settings2, X, AlertTriangle, ShieldAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Creator Settings: the things about a record that are true at every stage.
 *
 * ── Why it is a panel and not a page ─────────────────────────────────────────────────────────────
 * Settings are wanted DURING the work — halfway through assigning groups, somebody notices the
 * division is wrong. Sending them to a separate screen means losing their place and coming back to
 * find it. So it opens over the stage and closes again, and the stage is still there underneath.
 *
 * ── Four sections, in order of how often they are needed ─────────────────────────────────────────
 * Record Details is a typo fix. Format describes what the record IS and mostly cannot change once
 * play has begun. Display and Rankings decide who sees it and whether it counts. Corrections is the
 * way back to an earlier stage, and the Danger Zone is at the bottom because that is where a
 * destructive control belongs — after everything somebody might have been looking for instead.
 */

export interface SettingsSummary {
  kind: 'season' | 'tournament'
  id: number
  title: string
  competition: string
  competitionYear: number
  /** Seasons only. */
  number?: number | null
  division?: string | null
  /** What the record IS: individual/teams, structure, elimination rule, race lengths. */
  formatLines: string[]
  publiclyVisible: boolean
  countsTowardRankings: boolean
  /** Read-only here: it is a site-wide policy, changed in Site Settings. */
  registrationPolicy: 'ADMIN_ONLY' | 'MEMBERS_ALLOWED'
  lifecycleState: string
  /** Whether play has produced data that a format change would invalidate. */
  hasDependentData: boolean
  /** Only an Owner or Head Admin sees the Danger Zone. */
  canDelete: boolean
}

export function CreatorSettings({
  summary,
  onSaveDisplay,
  onSaveDetails,
}: {
  summary: SettingsSummary
  /** Server action: the two switches that are safe to change at any stage. */
  onSaveDisplay: (patch: { publiclyVisible: boolean; countsTowardRankings: boolean }) => Promise<{ ok?: boolean; error?: string }>
  /**
   * Server action for the Competition Year, where the record has no other way to correct it.
   *
   * A Season states its year on the Setup stage and can be corrected there. A Tournament cannot: the
   * create form defaults the year to the current one, and a Tournament reconstructed from the
   * archive keeps that default unless somebody notices — which is how a 2006 event ends up filed
   * under 2026. Passing this makes the row editable; leaving it out keeps the row read-only.
   */
  onSaveDetails?: (patch: { name?: string; competitionYear?: number }) => Promise<{ ok?: boolean; error?: string }>
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(String(summary.competitionYear))
  const [title, setTitle] = useState(summary.title)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [visible, setVisible] = useState(summary.publiclyVisible)
  const [counts, setCounts] = useState(summary.countsTowardRankings)
  const closeRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /*
   * Renaming is safe at any point in the lifecycle, including after completion.
   *
   * A title is a label. It decides nothing: not a result, not a champion, not a rating, not who
   * qualified. A Tournament reconstructed from the archive under a working name should not have to
   * go through the reopen-and-recomplete cycle to be called what it was actually called.
   */
  const saveTitle = () => {
    if (!onSaveDetails) return
    const next = title.trim()
    if (!next) { setMsg('A Tournament needs a title.'); return }
    if (next === summary.title) { setMsg('Saved.'); return }
    start(async () => {
      const r = await onSaveDetails({ name: next })
      setMsg(r.error ?? 'Saved.')
      if (!r.error) router.refresh()
    })
  }

  const saveYear = () => {
    if (!onSaveDetails) return
    const n = Number(year)
    // Checked again on the server; this only spares an obviously-wrong value the round trip.
    if (!Number.isInteger(n) || n < 1900 || n > 2100) { setMsg('Competition Year must be between 1900 and 2100.'); return }
    if (n === summary.competitionYear) { setMsg('Saved.'); return }
    start(async () => {
      const r = await onSaveDetails({ competitionYear: n })
      setMsg(r.error ?? 'Saved.')
      if (!r.error) router.refresh()
    })
  }

  const saveDisplay = (next: { publiclyVisible: boolean; countsTowardRankings: boolean }) => {
    start(async () => {
      const r = await onSaveDisplay(next)
      setMsg(r.error ?? 'Saved.')
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 cyber-clip-sm border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <Settings2 className="size-3.5" aria-hidden /> Settings
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Settings — ${summary.title}`}
          className="fixed inset-0 z-50 flex justify-end bg-black/60 p-0 sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="flex h-full w-full flex-col overflow-hidden border border-border bg-card sm:max-w-lg sm:cyber-clip">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold">Settings</h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{summary.title}</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close settings"
                className="grid size-8 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 text-sm">
              {msg && <p className="rounded border border-border bg-muted/40 px-3 py-2">{msg}</p>}

              <Section title="Record Details">
                {onSaveDetails ? (
                  <div className="space-y-1.5">
                    <label htmlFor="creator-record-title" className="text-muted-foreground">Title</label>
                    <div className="flex items-center gap-2">
                      <input
                        id="creator-record-title"
                        type="text"
                        value={title}
                        disabled={pending}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveTitle() } }}
                        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                      />
                      <button
                        type="button"
                        onClick={saveTitle}
                        disabled={pending || !title.trim() || title.trim() === summary.title}
                        className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <Row label="Title" value={summary.title} />
                )}
                <Row label="Competition" value={summary.competition} />
                {onSaveDetails ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="creator-competition-year" className="text-muted-foreground">
                      Competition Year
                    </label>
                    <span className="flex items-center gap-2">
                      <input
                        id="creator-competition-year"
                        type="number"
                        inputMode="numeric"
                        min={1900}
                        max={2100}
                        value={year}
                        disabled={pending}
                        onChange={(e) => setYear(e.target.value)}
                        className="w-20 rounded border border-border bg-background px-2 py-1 text-right font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                      />
                      <button
                        type="button"
                        onClick={saveYear}
                        disabled={pending || year === String(summary.competitionYear)}
                        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                      >
                        Save
                      </button>
                    </span>
                  </div>
                ) : (
                  <Row label="Competition Year" value={String(summary.competitionYear)} />
                )}
                {summary.number != null && <Row label="Season Number" value={String(summary.number)} />}
                {summary.kind === 'season' && <Row label="Division" value={summary.division?.trim() || 'No Division'} />}
                <p className="pt-1 text-xs text-muted-foreground">
                  {onSaveDetails
                    ? 'The title and the Competition Year describe this record rather than decide anything about it, so both can be corrected at any stage — including after completion. Renaming changes a label only: the number, results, champion and Rankings are untouched.'
                    : 'Editing these re-checks the duplicate rule — one record per competition, year, number and division. Change them from the Setup stage.'}
                </p>
              </Section>

              <Section title="Format">
                {summary.formatLines.map((l) => (
                  <p key={l} className="text-muted-foreground">{l}</p>
                ))}
                {summary.hasDependentData && (
                  <p className="mt-1 flex items-start gap-2 rounded border border-warning/30 bg-warning/[0.06] px-3 py-2 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Play has produced results. Changing the format now would invalidate them, so it is
                    done from the Setup stage with an impact preview rather than from here.
                  </p>
                )}
              </Section>

              <Section title="Display and Rankings">
                <Toggle
                  label="Publicly visible"
                  hint="Whether anyone outside Creator can see this record at all. Draft groups and draft brackets are never exposed by this switch — their visibility follows the lifecycle."
                  checked={visible}
                  disabled={pending}
                  onChange={(v) => { setVisible(v); saveDisplay({ publiclyVisible: v, countsTowardRankings: counts }) }}
                />
                <Toggle
                  label="Counts toward Rankings"
                  hint="Whether results from this record contribute to the ladder. Turning it off withdraws its contribution; turning it back on restores it."
                  checked={counts}
                  disabled={pending}
                  onChange={(v) => { setCounts(v); saveDisplay({ publiclyVisible: visible, countsTowardRankings: v }) }}
                />
                <Row
                  label="Member registration"
                  value={summary.registrationPolicy === 'MEMBERS_ALLOWED' ? 'Members allowed' : 'Admin only'}
                />
                <p className="text-xs text-muted-foreground">
                  Inherited from the site-wide policy in Site Settings. There is no per-record override:
                  two places to set one rule is one place too many.
                </p>
              </Section>

              <Section title="Corrections">
                <p className="text-muted-foreground">
                  Changing entrants, scores, standings, brackets or the Champion means reopening the
                  stage that owns them. Metadata — a title, a badge, a description — does not.
                </p>
                <p className="text-xs text-muted-foreground">
                  Reopening a completed record moves it back to Manage Open, withdraws its Rankings and
                  title contribution while it is being corrected, and keeps its public page visible with
                  an Under Correction notice. Recompleting replays the contribution exactly once.
                </p>
              </Section>

              {summary.canDelete && (
                <Section title="Danger Zone" tone="danger">
                  <p className="flex items-start gap-2 text-xs text-destructive">
                    <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Permanent deletion removes this record, every dependent result, its titles and its
                    Rankings contribution, and cannot be undone. It asks for the full title first and
                    shows exactly what will be removed.
                  </p>
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Section({ title, tone, children }: { title: string; tone?: 'danger'; children: React.ReactNode }) {
  return (
    <section>
      <h3 className={cn('eyebrow mb-2', tone === 'danger' ? 'text-destructive' : 'text-foreground')}>{title}</h3>
      <div className={cn('space-y-1.5 cyber-clip border p-3', tone === 'danger' ? 'border-destructive/30 bg-destructive/[0.04]' : 'border-border bg-background/40')}>
        {children}
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </p>
  )
}

function Toggle({
  label, hint, checked, disabled, onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="py-1">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="font-medium text-foreground">{label}</span>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 shrink-0 accent-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        />
      </label>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
