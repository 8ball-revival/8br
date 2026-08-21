import Link from 'next/link'
import { AlertTriangle, ExternalLink, Gem, Lock, Trophy, Unlock } from 'lucide-react'

import type { CompletionReview } from '@/lib/competition/correction'
import { CorrectionControls } from './correction-controls'
import { cn } from '@/lib/utils'

/**
 * One completed (or reopened) record, inside Creator.
 *
 * Locked by default. Opening this page is a READ — it runs the completion review and nothing else,
 * writes no audit row, touches no lifecycle and changes no ranking. That has to be true rather than
 * merely intended, because "I only looked at it" is exactly the moment a record must not move.
 *
 * The banner changes with the state, and says the consequence rather than the status: a reader
 * needs to know what this record is currently DOING — sitting in the Archives and counting, or
 * withdrawn and waiting — more than they need to know which enum value it holds.
 */
export function RecordDetail({
  review, publicHref, sections,
}: {
  review: CompletionReview
  publicHref: string
  /** Where corrections are actually made. Reuses the existing management surfaces. */
  sections: { label: string; href: string; hint: string }[]
}) {
  const reopened = review.reopenedAt != null
  const Icon = review.kind === 'season' ? Gem : Trophy

  return (
    <div className="space-y-5">
      {/* ── State banner ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          'rounded-lg border p-4',
          reopened ? 'border-[var(--streak-cold)]/50 bg-white/[0.03]' : 'border-[var(--gold)]/40 bg-white/[0.03]',
        )}
      >
        <p className="flex items-start gap-2 text-sm font-semibold">
          {reopened
            ? <><Unlock className="mt-0.5 size-4 shrink-0 text-[var(--streak-cold)]" aria-hidden />Reopened for Corrections</>
            : <><Lock className="mt-0.5 size-4 shrink-0 text-[var(--gold)]" aria-hidden />Completed</>}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {reopened ? (
            <>
              This record has left the Archives and is not contributing to the Rankings, player
              profiles or championship evidence while it is open. Nothing has been deleted. Complete
              and republish it when the correction is done.
            </>
          ) : (
            <>
              This record is completed and currently contributes to Archives and Rankings. Reopen it
              only when a correction is required.
            </>
          )}
        </p>
        {reopened && review.finalisedAt && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Previously completed{' '}
            {new Date(review.finalisedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
            {' · '}reopened{' '}
            {new Date(review.reopenedAt!).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
          </p>
        )}

        <div className="mt-3">
          <CorrectionControls
            kind={review.kind}
            id={review.id}
            title={review.title}
            reopenedAt={review.reopenedAt}
            errors={review.errors}
          />
        </div>
      </div>

      {/* ── The record ───────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
          <Icon className="size-4 text-[var(--gold)]" aria-hidden />
          {review.title}
        </h2>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Competition" value={review.competition} />
          <Field label="Historical year" value={review.year ?? '—'} />
          {review.number != null && <Field label="Season number" value={review.number} />}
          {review.division && <Field label="Division" value={`Division ${review.division}`} />}
          <Field label="Structure" value={review.format} />
          <Field label="Entrants" value={review.entrants || '—'} />
          <Field label="Champion" value={review.champion ?? '—'} gold />
          <Field label="Runner-up" value={review.runnerUp ?? '—'} />
          <Field label="Final score" value={review.finalScore ?? '—'} />
          <Field
            label={review.award === 'SC' ? 'Season Championship' : 'Tournament Title'}
            value={review.champion ? `Awarded to ${review.champion}` : 'None'}
          />
          <Field label="Data status" value={review.completeness === 'partial' ? 'Partial Historical Data' : 'Full Data'} />
          <Field
            label="Finalised"
            value={review.finalisedAt
              ? new Date(review.finalisedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
              : '—'}
          />
        </dl>
      </section>

      {/* ── Ranking contribution ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Ranking contribution</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Field label="Eligible matches" value={review.eligibleMatches} />
          <Field
            label="Excluded"
            value={review.excludedMatches}
            hint="Byes, administrative advancements, forfeits and no-contests. None of them move a rating."
          />
          <Field
            label="Currently contributing"
            value={review.ledgerRows === 0 ? 'Nothing — withdrawn' : `${review.ledgerRows} rated results`}
          />
        </dl>
      </section>

      {/* ── Warnings and blockers ────────────────────────────────────────── */}
      {(review.errors.length > 0 || review.warnings.length > 0) && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 text-[var(--streak-cold)]" aria-hidden />
            Review
          </h2>
          {review.errors.length > 0 && (
            <ul className="mb-2 space-y-1 text-sm text-[var(--streak-cold)]">
              {review.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {review.warnings.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {review.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </section>
      )}

      {/* ── Where corrections are made ───────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">
          {reopened ? 'Make corrections' : 'Record sections'}
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {reopened
            ? 'These are the existing management surfaces — the same ones used while the competition was running. Corrections are made there and reviewed back here.'
            : 'Read-only while completed. Reopen the record to change any of these.'}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className={cn(
                'rounded-md border border-border p-3 transition-colors',
                'hover:border-[var(--gold)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
                !reopened && 'opacity-70',
              )}
            >
              <span className="block text-sm font-medium">{s.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
            </Link>
          ))}
        </div>
      </section>

      <Link
        href={publicHref}
        className="inline-flex items-center gap-1.5 rounded text-sm text-[var(--gold)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <ExternalLink className="size-3.5" aria-hidden />
        View public archive page
      </Link>
    </div>
  )
}

function Field({ label, value, gold, hint }: {
  label: string
  value: string | number
  gold?: boolean
  hint?: string
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', gold && 'font-semibold text-[var(--gold)]')}>{value}</dd>
      {hint && <p className="mt-0.5 text-[0.68rem] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  )
}
