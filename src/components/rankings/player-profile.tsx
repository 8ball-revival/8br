'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Trophy, Flame, Snowflake } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityLines } from '@/lib/identity/display'

// Client-safe shapes (structurally match the server-only ladder profile types).
interface TrophyEntry { tournamentId: number; number: number | null; name: string; date: string | null; slug: string }
interface LadderRowView { rank: number; rating: number; wins: number; losses: number; winPct: number; streak: number; trophies: TrophyEntry[]; highestRank: number; highestRating: number; longestWinStreak: number; idleDays: number | null }
interface ProfileMatch { tournamentId: number; tournamentName: string; tournamentNumber: number | null; date: string | null; stage: string; roundLabel: string | null; opponentName: string; isTeamMatch: boolean; score: string | null; status: 'WIN' | 'LOSS' | 'DRAW' | 'FORFEIT'; preRating: number; ratingChange: number; postRating: number; link: string }
interface ProfileTournament { tournamentId: number; name: string; number: number | null; date: string | null; format: string | null; participantFormat: string; teamName: string | null; wins: number; losses: number; draws: number; ratingChange: number; wonTournament: boolean; placement: string | null; link: string }
export interface PlayerProfileView {
  playerId: string
  name: string
  cueverseId: string | null
  allTime: LadderRowView | null
  current: LadderRowView | null
  tournamentsPlayed: number
  bestFinish: string | null
  tournaments: ProfileTournament[]
  matches: ProfileMatch[]
}

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—')
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

function StreakInline({ streak }: { streak: number }) {
  if (streak === 0) return <span className="tabular text-muted-foreground">0</span>
  const win = streak > 0, mag = Math.abs(streak)
  return (
    <span className={cn('inline-flex items-center gap-1 tabular font-semibold', win ? 'text-success' : 'text-destructive')}>
      {win ? 'W' : 'L'}{mag}
      {mag >= 6 && (win ? <Flame className="size-3.5" aria-hidden /> : <Snowflake className="size-3.5" aria-hidden />)}
    </span>
  )
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-foreground">{value}</p>
      {sub != null && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

const TABS = ['Overview', 'Tournaments', 'Match History'] as const
type Tab = (typeof TABS)[number]

export function PlayerProfile({ profile }: { profile: PlayerProfileView }) {
  const [tab, setTab] = useState<Tab>('Overview')
  const a = profile.allTime
  const c = profile.current

  return (
    <div>
      <div className="mb-5">
        {/* The CueVerse ID is the headline identity; the preferred name sits under it. */}
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {identityLines({ cueverseId: profile.cueverseId, preferredName: profile.name }).primary}
        </h1>
        {identityLines({ cueverseId: profile.cueverseId, preferredName: profile.name }).secondary && (
          <p className="text-sm text-muted-foreground">
            {identityLines({ cueverseId: profile.cueverseId, preferredName: profile.name }).secondary}
          </p>
        )}
      </div>

      <div role="tablist" aria-label="Profile sections" className="mb-4 inline-flex rounded-lg border border-border bg-card/40 p-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', tab === t ? 'bg-brand text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Current Rank" value={c ? `#${c.rank}` : '—'} sub="rolling 365 days" />
          <Stat label="Current Rating" value={c ? c.rating : '—'} />
          <Stat label="All-Time Rank" value={a ? `#${a.rank}` : '—'} />
          <Stat label="All-Time Rating" value={a ? a.rating : '—'} />
          <Stat label="Highest Rank" value={a?.highestRank || '—'} sub="all-time" />
          <Stat label="Highest Rating" value={a?.highestRating ?? '—'} sub="all-time" />
          <Stat label="Tournaments" value={profile.tournamentsPlayed} />
          <Stat label="Tournament Wins" value={
            (a?.trophies.length ?? 0) === 0 ? <span className="text-muted-foreground/60">—</span>
              : <span className="inline-flex items-center gap-1">{Math.min(a!.trophies.length, 5) && [...Array(Math.min(a!.trophies.length, 5))].map((_, i) => <Trophy key={i} className="size-4" style={{ color: 'var(--gold)' }} />)}{a!.trophies.length > 5 && <span className="text-sm">×{a!.trophies.length}</span>}</span>
          } />
          <Stat label="Record (W–L)" value={a ? `${a.wins}–${a.losses}` : '—'} />
          <Stat label="Win %" value={a ? `${a.winPct.toFixed(1)}%` : '—'} />
          <Stat label="Current Streak" value={c ? <StreakInline streak={c.streak} /> : '—'} />
          <Stat label="Longest Win Streak" value={a?.longestWinStreak ?? '—'} />
          <Stat label="Best Finish" value={profile.bestFinish ?? '—'} />
          <Stat label="Idle" value={a?.idleDays == null ? '—' : `${a.idleDays} day${a.idleDays === 1 ? '' : 's'}`} />
        </div>
      )}

      {tab === 'Tournaments' && (
        <div className="overflow-x-auto scrollbar-brand rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-card/50 text-left text-[0.7rem] uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-2.5 py-2">Tournament</th><th className="px-2.5 py-2">Date</th><th className="px-2.5 py-2">Format</th><th className="px-2.5 py-2">Team</th><th className="px-2.5 py-2 text-center">Record</th><th className="px-2.5 py-2 text-center">Rating</th><th className="px-2.5 py-2 text-center">Result</th></tr>
            </thead>
            <tbody>
              {profile.tournaments.length === 0 && <tr><td colSpan={7} className="px-2.5 py-6 text-center text-muted-foreground">No tournaments yet.</td></tr>}
              {profile.tournaments.map((t) => (
                <tr key={t.tournamentId} className="border-b border-border/50 last:border-0 hover:bg-card/30">
                  <td className="px-2.5 py-2"><Link href={t.link} className="font-medium text-foreground hover:text-brand">{t.name}</Link></td>
                  <td className="px-2.5 py-2 text-muted-foreground">{fmtDate(t.date)}</td>
                  <td className="px-2.5 py-2 text-muted-foreground">{(t.format ?? '—').replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="px-2.5 py-2 text-muted-foreground">{t.teamName ?? '—'}</td>
                  <td className="px-2.5 py-2 text-center tabular">{t.wins}–{t.losses}{t.draws ? `–${t.draws}` : ''}</td>
                  <td className={cn('px-2.5 py-2 text-center tabular', t.ratingChange > 0 ? 'text-success' : t.ratingChange < 0 ? 'text-destructive' : 'text-muted-foreground')}>{signed(t.ratingChange)}</td>
                  <td className="px-2.5 py-2 text-center">{t.wonTournament ? <span className="inline-flex items-center gap-1 font-medium text-foreground"><Trophy className="size-3.5" style={{ color: 'var(--gold)' }} /> Champion</span> : <span className="text-muted-foreground">{t.placement ?? '—'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Match History' && (
        <div className="overflow-x-auto scrollbar-brand rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border bg-card/50 text-left text-[0.7rem] uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-2.5 py-2">Tournament</th><th className="px-2.5 py-2">Date</th><th className="px-2.5 py-2">Stage</th><th className="px-2.5 py-2">Opponent</th><th className="px-2.5 py-2 text-center">Score</th><th className="px-2.5 py-2 text-center">Result</th><th className="px-2.5 py-2 text-center">Rating</th></tr>
            </thead>
            <tbody>
              {profile.matches.length === 0 && <tr><td colSpan={7} className="px-2.5 py-6 text-center text-muted-foreground">No matches yet.</td></tr>}
              {profile.matches.map((m, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-card/30">
                  <td className="px-2.5 py-2"><Link href={m.link} className="text-foreground hover:text-brand">{m.tournamentName}</Link></td>
                  <td className="px-2.5 py-2 text-muted-foreground">{fmtDate(m.date)}</td>
                  <td className="px-2.5 py-2 text-muted-foreground">{m.roundLabel ?? m.stage}</td>
                  <td className="px-2.5 py-2">{m.opponentName}</td>
                  <td className="px-2.5 py-2 text-center tabular">{m.score ?? '—'}</td>
                  <td className="px-2.5 py-2 text-center">
                    <span className={cn('font-semibold', m.status === 'WIN' ? 'text-success' : m.status === 'LOSS' ? 'text-destructive' : 'text-muted-foreground')}>{m.status === 'FORFEIT' ? 'FF' : m.status[0]}</span>
                  </td>
                  <td className="px-2.5 py-2 text-center tabular">
                    <span className={cn(m.ratingChange > 0 ? 'text-success' : m.ratingChange < 0 ? 'text-destructive' : 'text-muted-foreground')}>{signed(m.ratingChange)}</span>
                    <span className="ml-1 text-xs text-muted-foreground">→ {m.postRating}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
