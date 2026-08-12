import type { Metadata } from 'next'
import { AlertTriangle, TrendingUp } from 'lucide-react'

import { pageMetadata } from '@/lib/site'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { RankingsTable } from '@/components/rankings/rankings-table'
import { CurrentRankingsTable } from '@/components/rankings/current-rankings-table'
import { ViewTabs, YearSelector } from '@/components/rankings/view-tabs'
import {
  getHistoricalRankings,
  getAllTimeRankings,
  getRankingYears,
} from '@/lib/stats/rankings'
import { getCurrentScoreRankings } from '@/lib/stats/current-score'
import { applyLinkedIdentities } from '@/lib/stats/linked-identity'
import { cupStore, loadCupContext } from '@/lib/cups/prime'

export const metadata: Metadata = pageMetadata({
  title: 'Rankings',
  description:
    'The official 8 Ball Revival competitive ladder — a Glicko-2 rating computed live from every official Season and Cup. Current, historical, and all-time strength.',
  path: '/rankings',
})

type SP = Promise<{ view?: string; year?: string }>

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-gold" /> Elite / podium</span>
      <span className="inline-flex items-center gap-1.5"><span className="text-success">▲</span> Rating up</span>
      <span className="inline-flex items-center gap-1.5"><span className="text-destructive">▼</span> Rating down</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-success/20 text-center text-[0.6rem] font-bold leading-3 text-success">W</span>/<span className="size-3 rounded-[3px] bg-destructive/20 text-center text-[0.6rem] font-bold leading-3 text-destructive">L</span> Recent form</span>
      <span className="inline-flex items-center gap-1.5"><span className="rounded bg-warning/10 px-1.5 py-0.5 text-[0.6rem] font-medium tracking-wide text-warning uppercase">Prov</span> Provisional (small sample)</span>
    </div>
  )
}

function WarningBanner({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null
  return (
    <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/[0.06] px-4 py-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <ul className="space-y-1 text-sm text-muted-foreground">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

export default async function RankingsPage({ searchParams }: { searchParams: SP }) {
  cupStore.enterWith(await loadCupContext()) // resolve the live Cup revision before cup-derived rankings
  const sp = await searchParams
  const view = sp.view === 'historical' ? 'historical' : sp.view === 'all-time' ? 'all-time' : 'current'
  const years = getRankingYears()

  let intro: React.ReactNode = null
  let table: React.ReactNode = null
  let warnings: string[] = []

  if (view === 'current') {
    const data = getCurrentScoreRankings()
    warnings = data.warnings
    intro = (
      <p className="max-w-3xl text-sm text-muted-foreground">
        Official competition during the previous {data.window?.days} days — a true rolling window, not a
        calendar-year ranking. Players are ranked by a transparent performance score that values Season
        playoffs above group play above cups, weights later playoff rounds more, and accounts for losses
        and opponent quality. Click any player to see exactly where every point came from.
      </p>
    )
    table = <CurrentRankingsTable rows={await applyLinkedIdentities(data.rows)} />
  } else if (view === 'all-time') {
    const data = getAllTimeRankings()
    intro = (
      <p className="max-w-3xl text-sm text-muted-foreground">
        The same rating engine across every official Season and Cup in history, ranked by each player&apos;s
        highest <strong className="text-foreground">established</strong> conservative rating (RD ≤ 100 and at
        least 20 rated matches at that point). This measures competitive strength over the complete history of
        the game — it is <strong className="text-foreground">not</strong> the Hall of Fame.
      </p>
    )
    table = (
      <div className="space-y-4">
        <RankingsTable rows={await applyLinkedIdentities(data.rows)} allTime />
        {data.unranked && data.unranked.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {data.unranked.length} further players have competed but never reached an established rating
            (RD ≤ 100 with ≥ 20 matches), so they do not yet hold an all-time peak.
          </p>
        )}
      </div>
    )
  } else {
    const year = sp.year && years.includes(Number(sp.year)) ? Number(sp.year) : years[0]
    const data = year ? getHistoricalRankings(year) : { rows: [] }
    intro = (
      <div className="space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          The ladder exactly as it stood at the end of {year ?? '—'} — a snapshot of the continuous rating
          timeline, showing players active that year. Continuity is preserved: this reflects where players
          actually stood at that point in time.
        </p>
        {year != null && <YearSelector years={years} active={year} />}
      </div>
    )
    table = <RankingsTable rows={await applyLinkedIdentities(data.rows)} />
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Rankings' }]}
        title="Rankings"
        description="The official competitive ladder — who is the strongest player right now. A live Glicko-2 rating derived entirely from official Season and Cup results."
      />
      <Container className="space-y-6 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <ViewTabs mode={view} />
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="size-3.5 text-gold" aria-hidden /> Live rating · recalculated from match data
          </span>
        </div>

        {intro}
        <WarningBanner warnings={warnings} />
        {table}
        <Legend />
      </Container>
    </>
  )
}
