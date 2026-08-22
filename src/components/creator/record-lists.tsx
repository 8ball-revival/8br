import Link from 'next/link'
import { ArrowLeft, Crown, AlertTriangle } from 'lucide-react'

import { Wide } from '@/components/primitives'
import type { CreatorRecordRow } from '@/lib/creator/landing'

/**
 * The two ways Creator lists records.
 *
 * Open records are few and each is a job in progress, so they get a tile with its stage on it. There
 * are hundreds of completed ones and they are looked up rather than browsed, so those get a compact
 * table. Presenting either the way the other wants would be unusable at its own scale.
 */

function ListFrame({
  title,
  blurb,
  count,
  children,
}: {
  title: string
  blurb: string
  count: number
  children: React.ReactNode
}) {
  return (
    <Wide name="creator" className="py-6">
      <Link
        href="/creator"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to Creator
      </Link>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        <span className="tabular text-sm text-muted-foreground">{count}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
      <div className="mt-5">{children}</div>
    </Wide>
  )
}

/** Records still being run. Each tile says where it is, and opens there. */
export function OpenRecordList({
  title,
  blurb,
  rows,
  emptyHref,
  emptyLabel,
}: {
  title: string
  blurb: string
  rows: CreatorRecordRow[]
  emptyHref: string
  emptyLabel: string
}) {
  return (
    <ListFrame title={title} blurb={blurb} count={rows.length}>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          Nothing open.{' '}
          <Link href={emptyHref} className="text-[var(--gold)] hover:underline">{emptyLabel}</Link>
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <Link
                href={r.href}
                className="flex h-full flex-col gap-1 rounded-lg border border-border bg-card/40 px-4 py-3 transition-colors hover:border-[var(--gold)]/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
              >
                <span className="truncate text-sm font-semibold text-foreground">{r.title}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="rounded-full border border-brand/30 bg-brand/[0.08] px-2 py-0.5 text-brand">{r.status}</span>
                  {r.entrants > 0 && <span className="tabular">{r.entrants} entrants</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ListFrame>
  )
}

/**
 * Finished records, as a table.
 *
 * The champion is the column people scan for, so it carries the crown and the forfeit marker: a
 * title won because the opponent did not appear is still a title, and the list is one of the places
 * that has to say which of the two it was.
 */
export function CompletedRecordList({
  title,
  blurb,
  rows,
}: {
  title: string
  blurb: string
  rows: CreatorRecordRow[]
}) {
  return (
    <ListFrame title={title} blurb={blurb} count={rows.length}>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          Nothing completed yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-card/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Record</th>
                <th scope="col" className="px-3 py-2 font-medium">Champion</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Entrants</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="border-t border-border/60 hover:bg-card/40">
                  <td className="px-3 py-2">
                    <Link
                      href={r.href}
                      className="font-medium text-foreground hover:text-[var(--gold)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.champion ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Crown className="size-3.5 text-[var(--gold)]" aria-hidden />
                        <span className="truncate">{r.champion}</span>
                        {r.finalsForfeit && (
                          <span
                            title="Championship awarded after the opponent forfeited the Final."
                            className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/[0.08] px-1.5 py-px text-[0.65rem] font-semibold uppercase tracking-wide text-warning"
                          >
                            <AlertTriangle className="size-3" aria-hidden /> FF
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-muted-foreground">{r.entrants || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListFrame>
  )
}
