'use client'

import { useMemo, useState } from 'react'
import { Diamond, Search } from 'lucide-react'

import type { SeasonSummary } from '@/lib/seasons/service'
import { SeasonCard } from './season-card'

/** The Seasons landing list: Active & Upcoming, then Season Championship History, with search + year filter. */
export function SeasonsList({ seasons }: { seasons: SeasonSummary[] }) {
  const [q, setQ] = useState('')
  const [year, setYear] = useState<'all' | number>('all')

  const years = useMemo(() => [...new Set(seasons.map((s) => s.year))].sort((a, b) => b - a), [seasons])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return seasons.filter((x) => {
      if (year !== 'all' && x.year !== year) return false
      if (!s) return true
      return `${x.title} ${x.subtitle ?? ''} ${x.championName ?? ''}`.toLowerCase().includes(s)
    })
  }, [seasons, q, year])

  const active = filtered.filter((s) => s.isActive)
  const completed = filtered.filter((s) => s.isCompleted)

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search seasons or champions…"
            className="w-full max-w-xs rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm sm:w-72"
          />
        </div>
        <select value={String(year)} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
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
