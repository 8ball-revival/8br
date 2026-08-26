'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { RotateCcw, Search } from 'lucide-react'

import type { ArchivePage } from '@/lib/competition/surface'
import { CompetitionCardView } from './competition-card'
import { cn } from '@/lib/utils'

/**
 * Filters, sorting and paging for an archive listing.
 *
 * All of it lives in the query string, so an archive view can be linked and the back button works.
 * The server does the filtering — with a hundred reconstructed Seasons coming, filtering a fully
 * loaded list in the browser would mean shipping the whole archive to render one page of it.
 *
 * Facets are built from the ARCHIVED SET, so the only years and competitions offered are ones that
 * will actually return something. An option that selects nothing reads as missing data.
 */
export function ArchiveBrowser({
  page, kind, showDivision = false,
}: {
  page: ArchivePage
  kind: 'seasons' | 'cups'
  showDivision?: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()

  const update = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    }
    // Any change to what is being filtered returns to the first page — page 4 of a different
    // question is not where anybody wants to land.
    if (!('page' in patch)) next.delete('page')
    router.push(`/${kind}${next.toString() ? `?${next}` : ''}`, { scroll: false })
  }, [params, router, kind])

  const get = (k: string) => params.get(k) ?? ''
  const anyFilter = ['comp', 'year', 'division', 'q', 'player'].some((k) => get(k) !== '')

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-none border border-border bg-card/30 px-2.5 py-2">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            defaultValue={get('q')}
            onKeyDown={(e) => { if (e.key === 'Enter') update({ q: (e.target as HTMLInputElement).value }) }}
            onBlur={(e) => { if (e.target.value !== get('q')) update({ q: e.target.value }) }}
            placeholder="Search titles"
            aria-label={`Search archived ${kind} by title`}
            className="w-44 rounded border border-input bg-card py-1 pl-7 pr-2 text-xs outline-none focus-visible:border-[var(--gold)]"
          />
        </label>

        <label className="relative">
          <input
            type="search"
            defaultValue={get('player')}
            onKeyDown={(e) => { if (e.key === 'Enter') update({ player: (e.target as HTMLInputElement).value }) }}
            onBlur={(e) => { if (e.target.value !== get('player')) update({ player: e.target.value }) }}
            placeholder="Champion or runner-up"
            aria-label="Search by champion or runner-up"
            className="w-48 rounded border border-input bg-card px-2 py-1 text-xs outline-none focus-visible:border-[var(--gold)]"
          />
        </label>

        {page.facets.competitions.length > 1 && (
          <Select label="Competition" value={get('comp')} onChange={(v) => update({ comp: v })}
            options={page.facets.competitions.map((c) => ({ value: String(c.id), label: c.name }))} />
        )}
        <Select label="Year" value={get('year')} onChange={(v) => update({ year: v })}
          options={page.facets.years.map((y) => ({ value: String(y), label: String(y) }))} />
        {showDivision && page.facets.divisions.length > 0 && (
          <Select label="Division" value={get('division')} onChange={(v) => update({ division: v })}
            options={page.facets.divisions.map((d) => ({ value: d, label: `Division ${d}` }))} />
        )}

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Sort</span>
          <select
            value={get('sort') || 'newest'}
            onChange={(e) => update({ sort: e.target.value === 'newest' ? null : e.target.value })}
            aria-label="Sort order"
            className="rounded border border-input bg-card px-1.5 py-1 text-xs outline-none focus-visible:border-[var(--gold)]"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>

        {anyFilter && (
          <button
            type="button"
            onClick={() => update({ comp: null, year: null, division: null, q: null, player: null })}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <RotateCcw className="size-3" aria-hidden />Reset filters
          </button>
        )}

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {page.total} {page.total === 1 ? 'record' : 'records'}
        </span>
      </div>

      {page.cards.length === 0 ? (
        <p className="rounded-none border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {anyFilter
            ? 'No archived records match these filters.'
            : `No ${kind} have been completed yet.`}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {page.cards.map((c) => <CompetitionCardView key={`${c.kind}-${c.id}`} card={c} />)}
        </div>
      )}

      {page.pages > 1 && (
        <nav aria-label="Pagination" className="mt-5 flex items-center justify-center gap-1">
          <PageLink label="Previous" disabled={page.page <= 1} onClick={() => update({ page: String(page.page - 1) })} />
          <span className="px-3 text-xs tabular-nums text-muted-foreground">
            Page {page.page} of {page.pages}
          </span>
          <PageLink label="Next" disabled={page.page >= page.pages} onClick={() => update({ page: String(page.page + 1) })} />
        </nav>
      )}
    </>
  )
}

function PageLink({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded border border-border px-3 py-1 text-xs transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-[var(--gold)]/40 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
      )}
    >
      {label}
    </button>
  )
}

function Select({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        disabled={options.length === 0}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="max-w-[11rem] rounded border border-input bg-card px-1.5 py-1 text-xs text-foreground outline-none focus-visible:border-[var(--gold)] disabled:opacity-40"
      >
        <option value="">{options.length === 0 ? `No ${label.toLowerCase()}s` : `All ${label.toLowerCase()}s`}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
