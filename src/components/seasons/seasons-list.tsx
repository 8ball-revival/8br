'use client'

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Diamond, Search } from 'lucide-react'

import type { SeasonSummary } from '@/lib/seasons/service'
import { SeasonCard } from './season-card'

/**
 * The Seasons landing list: Active & Upcoming, then Season Championship History.
 *
 * All three filters (search, Competition Year, Competition) live in the URL query string rather
 * than component state, so a filtered view can be linked, bookmarked and survives a refresh.
 * Filtering is client-side over the already-loaded list; only the query string changes, so there is
 * no refetch and Competition Year ordering from the server is preserved throughout.
 */
export function SeasonsList({ seasons }: { seasons: SeasonSummary[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const q = params.get('q') ?? ''
  const year = params.get('year') ?? 'all'
  const competition = params.get('competition') ?? 'all'

  /** Write one filter into the URL, dropping it entirely when it returns to the default. */
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const years = useMemo(() => [...new Set(seasons.map((s) => s.year))].sort((a, b) => b - a), [seasons])
  // Only Competitions actually represented by a Season appear in the filter.
  const competitions = useMemo(() => {
    const bySlug = new Map<string, { slug: string; name: string }>()
    for (const s of seasons) bySlug.set(s.competition.slug, { slug: s.competition.slug, name: s.competition.name })
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [seasons])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return seasons.filter((x) => {
      if (year !== 'all' && String(x.year) !== year) return false
      if (competition !== 'all' && x.competition.slug !== competition) return false
      if (!needle) return true
      // Search the champion by either half of their identity, not just the preferred name.
      return `${x.title} ${x.subtitle ?? ''} ${x.championName ?? ''} ${x.championHandle ?? ''} ${x.competition.name}`.toLowerCase().includes(needle)
    })
  }, [seasons, q, year, competition])

  const active = filtered.filter((s) => s.isActive)
  const completed = filtered.filter((s) => s.isCompleted)

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Search seasons or champions…"
            className="w-full max-w-xs rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm sm:w-72"
          />
        </div>
        <select value={year} onChange={(e) => setParam('year', e.target.value)} aria-label="Filter by Competition Year" className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={competition} onChange={(e) => setParam('competition', e.target.value)} aria-label="Filter by Competition" className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="all">All Competitions</option>
          {competitions.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
      </div>

      <Section title="Active & Upcoming" seasons={active} empty="No active or upcoming Seasons right now." />

      <div>
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-[var(--gold-soft)]">
          <Diamond className="size-4 fill-[var(--gold-soft)] text-[var(--gold-soft)] drop-shadow-[0_0_5px_rgba(230,196,99,0.7)]" aria-hidden />
          Season Championship History
        </h2>
        {completed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed Seasons yet — the first champion will be crowned soon.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {completed.map((s) => <SeasonCard key={s.number} season={s} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, seasons, empty }: { title: string; seasons: SeasonSummary[]; empty: string }) {
  return (
    <div>
      <h2 className="mb-4 font-display text-lg font-bold text-foreground">{title}</h2>
      {seasons.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {seasons.map((s) => <SeasonCard key={s.number} season={s} />)}
        </div>
      )}
    </div>
  )
}
