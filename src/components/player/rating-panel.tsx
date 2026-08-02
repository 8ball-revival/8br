import { Activity, Trophy } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { RatingProfile } from '@/lib/stats/rankings'
import type { MatchResult } from '@/lib/stats/rating-engine'

function Stat({ label, value, accent, sub }: { label: string; value: React.ReactNode; accent?: boolean; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className={cn('tabular text-2xl font-bold tracking-tight', accent ? 'text-gold' : 'text-foreground')}>{value}</div>
      <div className="mt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      {sub && <div className="mt-0.5 text-[0.7rem] text-muted-foreground/80">{sub}</div>}
    </div>
  )
}

function FormPips({ form }: { form: MatchResult[] }) {
  if (!form.length) return <span className="text-muted-foreground/50">—</span>
  return (
    <span className="inline-flex gap-1">
      {form.map((r, i) => (
        <span
          key={i}
          className={cn(
            'size-4 rounded-[3px] text-center text-[0.6rem] font-bold leading-4',
            r === 'W' && 'bg-success/20 text-success',
            r === 'L' && 'bg-destructive/20 text-destructive',
            r === 'D' && 'bg-muted-foreground/20 text-muted-foreground',
          )}
        >
          {r}
        </span>
      ))}
    </span>
  )
}

const ordinal = (n: number | null) => (n == null ? '—' : `#${n}`)

/**
 * Competitive-rating transparency. The public "current" standing is the hybrid
 * Current Ranking Score (rolling 365 days) with a full point-by-point breakdown —
 * answering "why am I ranked here?". The Glicko lifetime peak is shown as a secondary
 * All-Time metric.
 */
export function RatingPanel({ profile }: { profile: RatingProfile }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Current Score"
          value={profile.inCurrentWindow ? profile.score : '—'}
          accent
          sub={profile.inCurrentWindow ? 'rolling 365 days' : 'no matches in last 365 days'}
        />
        <Stat label="Current Rank" value={ordinal(profile.currentRank)} sub={profile.inCurrentWindow ? 'live ladder' : 'not active'} />
        <Stat label="Season Titles" value={profile.seasonTitles} sub="in window" />
        <Stat label="Cup Titles" value={profile.cupTitles} sub="in window" />
        <Stat label="Quality Wins" value={profile.qualityWins} sub="vs champions" />
        <Stat
          label="All-Time Peak"
          value={profile.peakRating ?? '—'}
          sub={profile.peakAchievedAt ? `Glicko · ${profile.peakAchievedAt.year}` : 'Glicko rating'}
        />
      </div>

      {profile.inCurrentWindow && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card/40 px-4 py-3 text-sm">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Activity className="size-4 text-gold" aria-hidden /> Record:
            <span className="tabular text-foreground">{profile.wins}–{profile.losses}{profile.draws ? `–${profile.draws}` : ''}</span>
            <span className="text-muted-foreground">({profile.winPct}%)</span>
          </span>
          <span className="tabular text-muted-foreground">Group {profile.groupRecord.w}–{profile.groupRecord.l}{profile.groupRecord.d ? `–${profile.groupRecord.d}` : ''}</span>
          <span className="tabular text-muted-foreground">Playoffs {profile.playoffRecord.w}–{profile.playoffRecord.l}</span>
          <span className="tabular text-muted-foreground">Cups {profile.cupRecord.w}–{profile.cupRecord.l}</span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">Form: <FormPips form={profile.recentForm} /></span>
        </div>
      )}

      {profile.scoreBreakdown.length > 0 ? (
        <div>
          <h3 className="eyebrow mb-3 flex items-center gap-2 text-muted-foreground">
            <Trophy className="size-3.5 text-gold" aria-hidden /> Current Ranking Score — breakdown
          </h3>
          <ul className="max-w-md space-y-1 text-sm">
            {profile.scoreBreakdown.map((l, i) => {
              const total = l.label === 'Total'
              return (
                <li
                  key={i}
                  className={cn('flex items-center justify-between gap-6', total && 'mt-1 border-t border-border pt-1.5 font-semibold')}
                >
                  <span className={total ? 'text-foreground' : 'text-muted-foreground'}>{l.label}</span>
                  <span className={cn('tabular', total ? 'text-gold' : l.points >= 0 ? 'text-success' : 'text-destructive')}>
                    {l.points >= 0 ? '+' : ''}{l.points}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="rounded-md border border-border bg-card/40 px-3 py-2 text-sm text-muted-foreground">
          No official matches in the current 365-day window.
          {profile.peakRating != null && ` All-Time peak Glicko rating: ${profile.peakRating}${profile.bestYearEndRank ? ` (best year-end rank #${profile.bestYearEndRank})` : ''}.`}
        </p>
      )}
    </div>
  )
}
