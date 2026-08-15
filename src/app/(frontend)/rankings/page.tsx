import type { Metadata } from 'next'
import Link from 'next/link'

import { getLadder, type LadderView } from '@/lib/stats/ladder'
import { LadderTable } from '@/components/rankings/ladder-table'
import { HowRankingsWork } from '@/components/rankings/how-rankings-work'
import { pageMetadata } from '@/lib/site'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic' // ladder reflects the latest completed tournaments

export const metadata: Metadata = pageMetadata({
  title: 'Rankings',
  description: 'The World Cue Championships Rating ladder — a standard Elo system over every completed tournament match.',
  path: '/rankings',
})

const VIEWS: { key: LadderView; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'all-time', label: 'All Time' },
]

export default async function RankingsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams
  const view: LadderView = sp.view === 'all-time' ? 'all-time' : 'current'
  const rows = await getLadder(view)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {/* Heading + a small Current / All Time slider. */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Rankings</h1>
        <nav aria-label="Rankings view" className="inline-flex rounded-md border border-border bg-card/40 p-0.5 text-xs">
          {VIEWS.map((v) => {
            const active = v.key === view
            return (
              <Link
                key={v.key}
                href={`/rankings?view=${v.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded px-2.5 py-1 font-medium transition-colors',
                  active ? 'bg-brand text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <LadderTable rows={rows} />

      {/* Explanation + summary below the list, so the rankings are the immediate focus. */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <HowRankingsWork />
        <span className="ml-auto text-xs text-muted-foreground">
          {view === 'current' ? 'Rolling 365-day ladder' : 'All completed tournaments'} · {rows.length} player{rows.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  )
}
