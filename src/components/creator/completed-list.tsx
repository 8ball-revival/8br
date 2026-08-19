'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { ExternalLink, Gem, RotateCcw, Search, Trophy } from 'lucide-react'

import type { CompletedPage } from '@/lib/creator/completed'
import { cn } from '@/lib/utils'

/**
 * Completed records, as a management table.
 *
 * ── Why a table and not cards ────────────────────────────────────────────────────────────────────
 * There will be a hundred of these. A card grid answers "browse what exists", which is the public
 * Archives' job; this answers "find the one I need to correct", which needs columns you can scan
 * down. So: one compact row per record, tabular figures, and the filters above it.
 *
 * ── The nesting problem, and how it is avoided ───────────────────────────────────────────────────
 * The row navigates to Creator AND carries a link to the public archive. A link inside a link is
 * invalid markup, so the row is not an anchor and neither link is nested in the other. Both are
 * real anchors — middle-click and modifier-click open tabs the way a reader expects — and the row
 * gets its wide click target from a handler that forwards a plain click on empty space to the
 * title's destination, while ignoring clicks that began inside another control.
 *
 * The first attempt stretched the title link across the row with an `::after` overlay pinned to a
 * `position: relative` table row. It worked on the desktop and broke the page on a phone: the
 * absolutely-positioned overlay escaped the horizontal scroll container and dragged the document
 * 531px wider than the viewport. A click handler has no such geometry.
 */
export function CompletedList({ page }: { page: CompletedPage }) {
  const router = useRouter()
  const params = useSearchParams()

  const update = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k)
      else next.set(k, v)
    }
    // Changing what is being asked returns to the first page — page 4 of a different question is
    // not where anybody wants to land.
    if (!('page' in patch)) next.delete('page')
    router.push(`/creator/completed${next.toString() ? `?${next}` : ''}`, { scroll: false })
  }, [params, router])

  const get = (k: string) => params.get(k) ?? ''
  const type = get('type') || 'all'
  const anyFilter = ['comp', 'year', 'division', 'q'].some((k) => get(k) !== '') || type !== 'all'

  return (
    <>
      {/* ── Type ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border bg-card/40 p-0.5 text-xs" role="group" aria-label="Record type">
          {([
            ['all', 'All', page.facets.counts.all],
            ['seasons', 'Seasons', page.facets.counts.seasons],
            ['cups', 'Cups', page.facets.counts.tournaments],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              aria-pressed={type === id}
              onClick={() => update({ type: id === 'all' ? null : id })}
              className={cn('rounded px-2.5 py-1 font-medium transition-colors',
                type === id ? 'bg-[var(--gold)] text-[var(--primary-foreground)]' : 'text-muted-foreground hover:text-foreground')}
            >
              {label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>

        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            defaultValue={get('q')}
            onKeyDown={(e) => { if (e.key === 'Enter') update({ q: (e.target as HTMLInputElement).value }) }}
            onBlur={(e) => { if (e.target.value !== get('q')) update({ q: e.target.value }) }}
            placeholder="Title, competition or champion"
            aria-label="Search completed records by title, competition or champion"
            className="w-56 rounded border border-input bg-card py-1 pl-7 pr-2 text-xs outline-none focus-visible:border-[var(--gold)]"
          />
        </label>

        {page.facets.competitions.length > 1 && (
          <Select label="Competition" value={get('comp')} onChange={(v) => update({ comp: v })}
            options={page.facets.competitions.map((c) => ({ value: String(c.id), label: c.name }))} />
        )}
        <Select label="Year" value={get('year')} onChange={(v) => update({ year: v })}
          options={page.facets.years.map((y) => ({ value: String(y), label: String(y) }))} />
        {page.facets.divisions.length > 0 && (
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
            onClick={() => update({ type: null, comp: null, year: null, division: null, q: null })}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <RotateCcw className="size-3" aria-hidden />Reset filters
          </button>
        )}

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {page.total} {page.total === 1 ? 'record' : 'records'}
        </span>
      </div>

      {/* ── The table ────────────────────────────────────────────────────── */}
      {page.rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {anyFilter ? 'No completed records match these filters.' : 'Nothing has been completed yet.'}
        </p>
      ) : (
        <div className="scrollbar-themed overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <caption className="sr-only">
              Completed Seasons and Cups. Selecting a row opens it in Creator; the archive
              link opens the public read-only page.
            </caption>
            <thead>
              <tr>
                {['Type', 'Competition', 'Season / Cup', 'Year', 'Division', 'Entrants', 'Champion', 'Data', 'Completed', ''].map((h, i) => (
                  <th
                    key={h || 'actions'}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap border-b border-border bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground',
                      ['Year', 'Entrants'].includes(h) && 'text-right',
                      i === 0 && 'pl-3',
                    )}
                  >
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((r) => {
                const Icon = r.kind === 'season' ? Gem : Trophy
                return (
                  <tr
                    key={`${r.kind}-${r.id}`}
                    onClick={(e) => {
                      // Only a plain click on the row itself. A click that started inside a link or
                      // a button belongs to that control, and a modified click is the reader asking
                      // for a new tab — which the anchors already handle.
                      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                      if ((e.target as HTMLElement).closest('a,button')) return
                      router.push(r.href)
                    }}
                    className="cursor-pointer transition-colors hover:bg-white/[0.04] focus-within:bg-white/[0.04]"
                  >
                    <td className="whitespace-nowrap border-b border-border/60 px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Icon className="size-3.5" aria-hidden />
                        {r.kind === 'season' ? 'Season' : 'Cup'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                      {r.competition}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2">
                      {/*
                        The row's link. `after:absolute after:inset-0` stretches its hit area over
                        the whole row without nesting anything inside another anchor, so the row
                        behaves like a row while staying one real link.
                      */}
                      <Link
                        href={r.href}
                        // The row's accessible name: a reader tabbing through hears which record
                        // this row is and that opening it goes to Creator, not the public page.
                        aria-label={`Open ${r.title} in Creator`}
                        className="font-medium hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gold)]/60"
                      >
                        {r.title}
                        {r.number != null && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">Season {r.number}</span>
                        )}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-right tabular-nums">
                      {r.year ?? '—'}
                    </td>
                    <td className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                      {r.division ?? '—'}
                    </td>
                    <td className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-right tabular-nums">
                      {r.entrants || '—'}
                    </td>
                    <td className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-[var(--gold)]">
                      {r.champion ?? '—'}
                    </td>
                    <td className="whitespace-nowrap border-b border-border/60 px-3 py-2">
                      {/* Never colour alone: the state is spelled out. */}
                      <span className={cn('text-xs', r.completeness === 'partial' ? 'text-muted-foreground' : 'text-foreground')}>
                        {r.completeness === 'partial' ? 'Partial historical' : 'Full data'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-xs tabular-nums text-muted-foreground">
                      {r.completedAt
                        ? new Date(r.completedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-right">
                      {/*
                        Above the row link on the z-axis, so a click here is a click here. Without
                        `relative z-10` the stretched overlay above would swallow it and send the
                        reader to Creator instead of the archive.
                      */}
                      <Link
                        href={r.publicHref}
                        className="inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                        aria-label={`View the public archive page for ${r.title}`}
                      >
                        <ExternalLink className="size-3" aria-hidden />
                        <span className="hidden sm:inline">View Public Archive</span>
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {page.pages > 1 && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-center gap-1">
          <PageButton label="Previous" disabled={page.page <= 1} onClick={() => update({ page: String(page.page - 1) })} />
          <span className="px-3 text-xs tabular-nums text-muted-foreground">
            Page {page.page} of {page.pages}
          </span>
          <PageButton label="Next" disabled={page.page >= page.pages} onClick={() => update({ page: String(page.page + 1) })} />
        </nav>
      )}
    </>
  )
}

function PageButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
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
