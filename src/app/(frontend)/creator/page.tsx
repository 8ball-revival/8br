import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, ExternalLink, Plus } from 'lucide-react'

import { Wide } from '@/components/primitives'
import { requireCreator } from '@/lib/creator/access'
import { listCreatorProjects, BUCKETS, type CreatorProject } from '@/lib/creator/projects'
import { listReconstructions } from '@/lib/creator/reconstruction-list'
import { parseQuery, applyQuery } from '@/lib/creator/reconstruction-filters'
import { ReconstructionList } from '@/components/creator/reconstruction-list'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Creator', robots: { index: false } }

/**
 * The Creator dashboard.
 *
 * Organised by WHERE THE WORK IS rather than by record type, because "what needs me next" is the
 * question somebody opening this page is asking. A Season taking entrants and a Tournament taking
 * entrants are the same job; a completed Season and a live one are not.
 *
 * Authorisation is re-checked here rather than left to a layout: a layout gate is a rendering gate,
 * and it does not run for the data this page loads.
 */
export default async function CreatorDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireCreator()
  const sp = await searchParams
  const projects = await listCreatorProjects()
  const byBucket = new Map(BUCKETS.map((b) => [b.id, projects.filter((p) => p.bucket === b.id)]))

  /*
   * The reconstruction shells get their own filtered list.
   *
   * They are counted in the hundreds where every other bucket is counted in single figures, so the
   * generic bucket rendering would bury the rest of the dashboard under them. Filtering happens on
   * the server from the URL, so a filtered view is shareable and survives Back.
   */
  const reconstructions = await listReconstructions()
  const query = parseQuery(sp)
  const visibleReconstructions = applyQuery(reconstructions, query)
  const reconstructionYears = [...new Set(reconstructions.map((r) => r.year).filter((y): y is number => y != null))].sort()

  return (
    <Wide name="creator" className="py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Creator</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create, reconstruct and manage every Season and Cup. Nothing here is public until
            you make it so.
          </p>
        </div>
        <Link
          href="/creator/new"
          className="inline-flex items-center gap-2 rounded-md bg-[var(--gold)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          <Plus className="size-4" aria-hidden />Create New
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Nothing yet. <Link href="/creator/new" className="text-[var(--gold)] hover:underline">Create a Season or Cup</Link> to begin.
        </p>
      ) : (
        <div className="space-y-6">
          {reconstructions.length > 0 && (
            <ReconstructionList
              rows={visibleReconstructions}
              total={reconstructions.length}
              query={query}
              years={reconstructionYears}
            />
          )}

          {BUCKETS.map((b) => {
            // Reconstructions have their own filtered section above.
            if (b.id === 'reconstruction') return null
            const list = byBucket.get(b.id) ?? []
            if (list.length === 0) return null

            // Completed records are a MANAGEMENT LIST, not tiles. There will be a hundred of them,
            // and a grid of cards is for browsing what exists — which is the public Archives' job.
            // The dashboard shows the count and hands over to the table.
            if (b.id === 'completed') {
              return (
                <section key={b.id}>
                  <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                    {b.label}
                    <span className="text-xs font-normal text-muted-foreground">{b.hint}</span>
                    <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">{list.length}</span>
                  </h2>
                  <Link
                    href="/creator/completed"
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-[var(--gold)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        Manage {list.length} completed {list.length === 1 ? 'record' : 'records'}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Search, filter and open any completed Season or Cup to correct it.
                      </span>
                    </span>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </section>
              )
            }

            return (
              <section key={b.id}>
                <h2 className={cn(
                  'mb-2 flex items-baseline gap-2 text-sm font-semibold',
                  b.id === 'attention' && 'text-[var(--streak-cold)]',
                )}>
                  {b.id === 'attention' && <AlertTriangle className="size-4" aria-hidden />}
                  {b.label}
                  <span className="text-xs font-normal text-muted-foreground">{b.hint}</span>
                  <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">{list.length}</span>
                </h2>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((p) => <ProjectRow key={`${p.kind}-${p.id}`} project={p} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </Wide>
  )
}

function ProjectRow({ project: p }: { project: CreatorProject }) {
  return (
    <div className={cn(
      'flex flex-col gap-1.5 rounded-lg border bg-card p-3',
      p.warning ? 'border-[var(--streak-cold)]/50' : 'border-border',
    )}>
      <div className="flex items-start justify-between gap-2">
        <Link
          href={p.href}
          className="min-w-0 rounded font-medium hover:text-[var(--gold)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          <span className="block truncate">{p.title}</span>
        </Link>
        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide text-muted-foreground">
          {p.kind}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {p.competition}
        {p.year != null && <> · {p.year}</>}
        {p.division && <> · Division {p.division}</>}
        {p.entrants > 0 && <> · {p.entrants} entrants</>}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 text-[0.65rem]">
        <span className="rounded-full border border-border px-1.5 py-0.5 text-muted-foreground">
          {p.lifecycle.replaceAll('_', ' ').toLowerCase()}
        </span>
        {p.reconstruction && (
          <span className="rounded-full border border-[var(--gold)]/40 px-1.5 py-0.5 text-[var(--gold)]">reconstruction</span>
        )}
        {p.completeness === 'partial' && (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-muted-foreground">partial data</span>
        )}
        {!p.publiclyVisible && (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-muted-foreground">private</span>
        )}
        {p.publicHref && (
          <Link
            href={p.publicHref}
            className="inline-flex items-center gap-1 rounded text-muted-foreground hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <ExternalLink className="size-3" aria-hidden />public page
          </Link>
        )}
      </div>

      {p.warning && (
        <p className="text-[0.68rem] leading-snug text-[var(--streak-cold)]">{p.warning}</p>
      )}
    </div>
  )
}
