'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Trophy, Flame, Snowflake, ChevronsRight, ChevronsLeft, Diamond } from 'lucide-react'

import { cn } from '@/lib/utils'

// Local, client-safe row shape (structurally matches LadderRow in the server-only ladder service).
interface TrophyEntry { tournamentId: number; number: number | null; name: string; date: string | null; slug: string }
interface SeasonTrophyView { seasonNumber: number; title: string; date: string | null; slug: string }
export interface LadderRowView {
  seasonTitles: SeasonTrophyView[]
  playerId: string
  name: string
  cueverseId: string | null
  slug: string | null
  rank: number
  rating: number
  wins: number
  losses: number
  winPct: number
  streak: number
  trophies: TrophyEntry[]
  highestRank: number
  highestRating: number
  longestWinStreak: number
  idleDays: number | null
}

/** Signed streak: green up, red down, neutral zero; fire ≥6 win, snowflake ≥6 loss (no icon at ±5). */
function StreakCell({ streak }: { streak: number }) {
  if (streak === 0) return <span className="tabular text-muted-foreground">0</span>
  const win = streak > 0
  const mag = Math.abs(streak)
  const icon = mag >= 6 ? (win ? <Flame className="size-3.5" aria-hidden /> : <Snowflake className="size-3.5" aria-hidden />) : null
  const label = `${mag}-match ${win ? 'winning' : 'losing'} streak`
  return (
    <span className={cn('inline-flex items-center gap-1 tabular font-semibold', win ? 'text-success' : 'text-destructive')} title={label} aria-label={label}>
      {mag}
      {icon}
    </span>
  )
}

/** Season Championships — the glowing diamond, distinct from tournament trophies. */
function Diamonds({ seasons }: { seasons: SeasonTrophyView[] }) {
  if (!seasons?.length) return null
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${seasons.length} Season Championship${seasons.length === 1 ? '' : 's'}`}>
      {seasons.slice(0, 5).map((s) => (
        <Link key={s.seasonNumber} href={s.slug} title={s.title} className="transition-transform hover:scale-110">
          <Diamond className="size-3.5 fill-[#e6c463] text-[#e6c463] drop-shadow-[0_0_4px_rgba(230,196,99,0.8)]" aria-hidden />
        </Link>
      ))}
      {seasons.length > 5 && <span className="tabular text-xs font-semibold text-[#e6c463]">×{seasons.length}</span>}
    </span>
  )
}

function Trophies({ trophies }: { trophies: TrophyEntry[] }) {
  if (trophies.length === 0) return <span className="text-muted-foreground/50">—</span>
  const fmt = (t: TrophyEntry) => `${t.name}${t.date ? ` · ${new Date(t.date).toLocaleDateString()}` : ''}`
  if (trophies.length > 5) {
    const list = trophies.map(fmt).join('\n')
    return (
      <span className="inline-flex items-center gap-0.5" title={list} aria-label={`${trophies.length} tournament wins`}>
        <Trophy className="size-4" style={{ color: '#d4a94a' }} aria-hidden />
        <span className="tabular text-xs font-semibold text-foreground">×{trophies.length}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${trophies.length} tournament win${trophies.length === 1 ? '' : 's'}`}>
      {trophies.map((t) => (
        <Link key={t.tournamentId} href={t.slug} title={fmt(t)} className="transition-transform hover:scale-110" aria-label={`Won ${t.name}`}>
          <Trophy className="size-4" style={{ color: '#d4a94a' }} aria-hidden />
        </Link>
      ))}
    </span>
  )
}

const TH = 'px-2.5 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground'
const TD = 'px-2.5 py-2 align-middle'

export function LadderTable({ rows }: { rows: LadderRowView[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="overflow-x-auto scrollbar-brand rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border bg-card/50">
          <tr>
            <th className={cn(TH, 'w-12 text-center')}>Rank</th>
            <th className={TH}>Name</th>
            <th className={cn(TH, 'text-center')}>Wins</th>
            <th className={cn(TH, 'text-center')}>Losses</th>
            <th className={cn(TH, 'text-center')}>Rating</th>
            <th className={cn(TH, 'text-center')}>Win %</th>
            <th className={cn(TH, 'text-center')}>Streak</th>
            <th className={cn(TH, 'text-center')}>Tournament Wins</th>
            {expanded && (
              <>
                <th className={cn(TH, 'border-l border-border/60 bg-brand/[0.06] text-center')} colSpan={4}>
                  Highest Achieved
                </th>
              </>
            )}
            <th className={cn(TH, 'w-10 text-center')}>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Collapse Highest Achieved columns' : 'Show Highest Achieved columns'}
                aria-expanded={expanded}
                className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {expanded ? <ChevronsLeft className="size-4" /> : <ChevronsRight className="size-4" />}
              </button>
            </th>
          </tr>
          {expanded && (
            <tr className="border-b border-border bg-brand/[0.04] text-[0.65rem] uppercase tracking-wide text-muted-foreground">
              <th colSpan={8} />
              <th className="border-l border-border/60 px-2.5 py-1 text-center">Rank</th>
              <th className="px-2.5 py-1 text-center">Rating</th>
              <th className="px-2.5 py-1 text-center">Streak</th>
              <th className="px-2.5 py-1 text-center">Idle</th>
              <th />
            </tr>
          )}
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={expanded ? 13 : 9} className="px-2.5 py-8 text-center text-muted-foreground">No ranked players yet — the ladder fills in as tournaments are completed.</td></tr>
          )}
          {rows.map((r, idx) => (
            // Alternating rows: even (first) = fully-opaque matte surface (the darker Group Stage row
            // shade, theme-aware); odd = genuinely transparent so the page shows through. Applied to the
            // <tr> so it spans every column; the thin divider borders keep transparent rows easy to follow.
            <tr key={r.playerId} className={cn('border-b border-border/50 last:border-0 hover:bg-card/30', idx % 2 === 0 ? 'bg-surface' : 'bg-transparent')}>
              <td className={cn(TD, 'text-center')}><span className={cn('tabular font-semibold', r.rank <= 3 ? 'text-brand' : 'text-muted-foreground')}>{r.rank}</span></td>
              <td className={TD}>
                {r.slug ? (
                  <Link href={`/players/${encodeURIComponent(r.slug)}`} className="font-medium text-foreground hover:text-brand">
                    {r.name}
                    {r.cueverseId && r.cueverseId !== r.name && <span className="ml-1.5 text-xs text-muted-foreground">{r.cueverseId}</span>}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{r.name}</span>
                )}
              </td>
              <td className={cn(TD, 'text-center tabular')}>{r.wins}</td>
              <td className={cn(TD, 'text-center tabular')}>{r.losses}</td>
              <td className={cn(TD, 'text-center')}><span className="tabular font-semibold text-foreground">{r.rating}</span></td>
              <td className={cn(TD, 'text-center tabular text-muted-foreground')}>{r.winPct.toFixed(1)}%</td>
              <td className={cn(TD, 'text-center')}><StreakCell streak={r.streak} /></td>
              <td className={cn(TD, 'text-center')}><span className="inline-flex items-center gap-1"><Diamonds seasons={r.seasonTitles} /><Trophies trophies={r.trophies} /></span></td>
              {expanded && (
                <>
                  <td className={cn(TD, 'border-l border-border/60 bg-brand/[0.03] text-center tabular text-muted-foreground')}>{r.highestRank || '—'}</td>
                  <td className={cn(TD, 'bg-brand/[0.03] text-center tabular text-muted-foreground')}>{r.highestRating}</td>
                  <td className={cn(TD, 'bg-brand/[0.03] text-center tabular text-muted-foreground')}>{r.longestWinStreak}</td>
                  <td className={cn(TD, 'bg-brand/[0.03] text-center tabular text-muted-foreground')}>{r.idleDays == null ? '—' : r.idleDays}</td>
                </>
              )}
              <td className={TD} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
