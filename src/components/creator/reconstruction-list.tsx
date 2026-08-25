'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  PROGRESS_OPTIONS, ARCHIVE_OPTIONS, progressSummary,
  type ReconstructionRow, type ReconstructionQuery,
} from '@/lib/creator/reconstruction-filters'

/**
 * The historical reconstruction list.
 *
 * ── Rows, not tiles ──────────────────────────────────────────────────────────────────────────────
 * Eighty-eight of anything is a list you scan, not a wall you browse. Each row is one line of
 * identity and one line of progress, so twenty fit on a screen and the differences between them are
 * the part that stands out.
 *
 * ── Filters live in the URL ──────────────────────────────────────────────────────────────────────
 * Every control writes a query parameter and the server does the filtering, so a filtered view can
 * be bookmarked and shared, survives a refresh, and moves under Back and Forward the way a reader
 * expects. Holding this in component state would lose all four.
 */
export function ReconstructionList({
  rows,
  total,
  query,
  years,
}: {
  rows: ReconstructionRow[]
  total: number
  query: ReconstructionQuery
  years: number[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function withParams(next: Record<string, string | null>) {
    const out = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') out.delete(k)
      else out.set(k, v)
    }
    const qs = out.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  const go = (next: Record<string, string | null>) => router.push(withParams(next), { scroll: false })
  const filtered = rows.length !== total

  return (
    <section aria-labelledby="reconstructions-heading">
      <h2 id="reconstructions-heading" className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        Historical reconstructions
        <span className="text-xs font-normal text-muted-foreground">Being rebuilt by hand from an archive</span>
        <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">
          {filtered ? `${rows.length} of ${total}` : total}
        </span>
      </h2>

      {/* The controls wrap rather than scroll: on a phone they stack into rows of two. */}
      <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card/40 p-2">
        <Field label="Year">
          <select
            value={query.year ?? ''}
            onChange={(e) => go({ year: e.target.value || null })}
            className="w-full rounded border border-input bg-card px-2 py-1 text-xs"
          >
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>

        <Field label="Division">
          <select
            value={query.division ?? ''}
            onChange={(e) => go({ division: e.target.value || null })}
            className="w-full rounded border border-input bg-card px-2 py-1 text-xs"
          >
            <option value="">Both</option>
            <option value="A">Division A</option>
            <option value="B">Division B</option>
          </select>
        </Field>

        <Field label="Progress">
          <select
            value={query.progress ?? ''}
            onChange={(e) => go({ progress: e.target.value || null })}
            className="w-full rounded border border-input bg-card px-2 py-1 text-xs"
          >
            <option value="">Any progress</option>
            {PROGRESS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>

        <Field label="Archive data">
          <select
            value={query.archive ?? ''}
            onChange={(e) => go({ archive: e.target.value || null })}
            className="w-full rounded border border-input bg-card px-2 py-1 text-xs"
          >
            <option value="">Any archive data</option>
            {ARCHIVE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>

        <form
          className="flex min-w-0 flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const v = new FormData(e.currentTarget).get('q')
            go({ q: typeof v === 'string' && v.trim() ? v.trim() : null })
          }}
        >
          <Field label="Season or title">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                name="q"
                type="search"
                defaultValue={query.q ?? ''}
                placeholder="e.g. 5 or 2011"
                aria-label="Search by Season number or title"
                className="w-full rounded border border-input bg-card py-1 pl-6 pr-2 text-xs"
              />
            </div>
          </Field>
        </form>

        {(query.year || query.division || query.progress || query.archive || query.q) && (
          <Link
            href={pathname}
            className="rounded px-2 py-1 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No reconstructions match these filters.
        </p>
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/40">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={r.href}
                className="flex flex-col gap-1 px-3 py-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.7rem] text-muted-foreground">
                    {progressSummary(r).map((bit, i) => (
                      <span
                        key={i}
                        className={cn(
                          i > 0 && 'before:mr-2 before:content-["·"]',
                          /Auto Assign unavailable|unresolved|No archive/.test(bit) && 'text-[var(--loss)]',
                        )}
                      >
                        {bit}
                      </span>
                    ))}
                  </span>
                </span>

                {r.sharedStage && (
                  <AlertTriangle className="size-4 shrink-0 text-[var(--loss)]" aria-label="Shared group stage" />
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-[8rem] flex-1 sm:flex-none">
      <span className="mb-0.5 block text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
