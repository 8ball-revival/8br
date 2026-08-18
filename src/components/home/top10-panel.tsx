'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowRight, Crown, Info } from 'lucide-react'

import { fetchTop10Action } from '@/lib/home/top10-actions'
import type { Top10Option, Top10Result, Top10Row } from '@/lib/home/top10'

/**
 * The 8 Ball Registry Top 10.
 *
 * Historical, competition-derived ranking. Deliberately distinct in wording and treatment from the
 * CueVerse card further down the page, which mirrors an external live game leaderboard — two
 * different ranking systems shown on one page have to be told apart at a glance.
 *
 * The panel renders server-provided rows for the visitor's saved mode, then swaps modes in place via
 * a Server Action. No navigation, no page reload, and no ranking logic in the browser.
 */

const STORAGE_KEY = '8br.top10.mode'

/** Ranks 1–3 get metal accents; everything below is neutral so the top is what stands out. */
function rankTreatment(rank: number): { row: string; badge: string } {
  if (rank === 1) return { row: 'border-brand/30 bg-brand/[0.06]', badge: 'bg-brand/15 text-brand' }
  if (rank === 2) return { row: 'border-border', badge: 'bg-[#c0c4cc]/15 text-[#c8ccd4]' }
  if (rank === 3) return { row: 'border-border', badge: 'bg-[#b08d57]/15 text-[#c49a63]' }
  return { row: 'border-border', badge: 'bg-muted text-muted-foreground' }
}

function Row({ row }: { row: Top10Row }) {
  const treatment = rankTreatment(row.rank)
  // Preferred name leads, CueVerse ID beneath. With no preferred name the ID is the only line.
  const primary = row.name
  const secondary = row.handle && row.handle !== row.name ? row.handle : null

  return (
    <li className={`flex items-center gap-3 border-b px-3 py-2 last:border-b-0 ${treatment.row}`}>
      <span
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${treatment.badge}`}
      >
        {row.rank === 1 ? <Crown className="size-3.5" aria-hidden /> : row.rank}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {row.slug ? (
            <Link
              href={`/players/${row.slug}`}
              className="hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              {primary}
            </Link>
          ) : primary}
        </span>
        {secondary && <span className="block truncate text-xs text-muted-foreground">{secondary}</span>}
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums">{row.value}</span>
        {/* Spelled out, not just implied by equal numbers — a tie is a fact about the standing. */}
        {row.tied && <span className="block text-[0.65rem] uppercase tracking-wide text-muted-foreground">tied</span>}
      </span>
    </li>
  )
}

export function Top10Panel({
  options, initial,
}: { options: Top10Option[]; initial: Top10Result }) {
  const [result, setResult] = useState(initial)
  const [mode, setMode] = useState(initial.mode)
  const [pending, start] = useTransition()

  const load = useCallback((next: string) => {
    start(async () => {
      const data = await fetchTop10Action(next)
      setResult(data)
      setMode(data.mode)
    })
  }, [])

  // Restore the last mode used on this device. Runs after mount so the server render is never
  // different from the first client render — the saved value is a preference, not page content.
  useEffect(() => {
    let saved: string | null = null
    try { saved = window.localStorage.getItem(STORAGE_KEY) } catch { saved = null }
    if (!saved || saved === initial.mode) return
    // A saved mode for a Competition that has since been removed is no longer an option; the panel
    // falls back rather than asking the server for something that cannot be served.
    if (!options.some((o) => o.value === saved)) {
      try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* storage unavailable */ }
      return
    }
    load(saved)
  }, [initial.mode, options, load])

  const onChange = (next: string) => {
    try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* private mode; not fatal */ }
    load(next)
  }

  const groups: Top10Option['group'][] = ['Overall', 'Championship Type', 'By Competition']
  const activeLabel = options.find((o) => o.value === mode)?.label ?? 'All Competitions'

  return (
    <section
      aria-labelledby="home-top10-heading"
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card/40"
    >
      <div className="border-b border-border p-4">
        <h2 id="home-top10-heading" className="font-display text-sm font-bold uppercase tracking-[0.14em]">
          8 Ball Registry Top 10
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {activeLabel} · {result.metricLabel}
        </p>

        <label htmlFor="top10-mode" className="sr-only">Ranking mode</label>
        <select
          id="top10-mode"
          value={mode}
          disabled={pending}
          onChange={(e) => onChange(e.target.value)}
          className="mt-3 w-full rounded-md border border-input bg-card px-2.5 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {groups.map((group) => {
            const items = options.filter((o) => o.group === group)
            if (items.length === 0) return null
            return (
              <optgroup key={group} label={group}>
                {items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            )
          })}
        </select>
      </div>

      <div className={`flex-1 ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
        {result.unavailable ? (
          <div className="flex h-full flex-col justify-center gap-2 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Info className="size-3.5" aria-hidden />Not available yet
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{result.unavailable}</p>
          </div>
        ) : result.rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No completed competitions have produced a ranking for this view yet.
          </p>
        ) : (
          <ol className="divide-border">
            {result.rows.map((row) => <Row key={`${row.rank}-${row.playerId ?? row.name}`} row={row} />)}
          </ol>
        )}
      </div>

      <div className="border-t border-border p-3">
        <Link
          href={result.href}
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          View full rankings <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  )
}
