'use client'

import { useState } from 'react'
import { ChevronDown, GitBranch, Trophy, Users } from 'lucide-react'

import { GroupStandings } from '@/components/seasons/group-standings'
import { DoubleElimBracket } from '@/components/seasons/double-elim'
import { SeasonBracket } from '@/components/seasons/season-bracket'
import { cn } from '@/lib/utils'
import type { ArchiveSeason, SeasonDivision } from '@/lib/seasons/archive'
import type { BracketRound } from '@/lib/cups/service'

function toBracketRounds(div: SeasonDivision): BracketRound[] {
  return (div.playoff?.rounds ?? []).map((r) => ({
    name: r.name,
    matches: r.matches.map((m) => ({
      a: m.a ?? undefined,
      b: m.b ?? undefined,
      winner: m.winner ?? undefined,
      note: m.note,
    })),
  }))
}

function championLabels(season: ArchiveSeason): string[] {
  return season.divisions
    .map((d) => d.champion)
    .filter((c): c is { name: string; handle?: string } => Boolean(c))
    .map((c) => (c.handle && c.handle !== c.name ? `${c.name} · ${c.handle}` : c.name))
}

function Collapsible({
  id,
  title,
  icon: Icon,
  meta,
  defaultOpen = true,
  children,
}: {
  id?: string
  title: string
  icon: typeof Users
  meta?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section id={id} className="scroll-mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mb-3 flex w-full items-center gap-2 border-b border-border pb-2 text-left transition-colors hover:text-gold"
      >
        <Icon className="size-4 text-gold" aria-hidden />
        <span className="eyebrow text-foreground">{title}</span>
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
        <ChevronDown className={cn('ml-auto size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} aria-hidden />
      </button>
      {open && children}
    </section>
  )
}

function SeasonDashboard({ season }: { season: ArchiveSeason }) {
  const multiDiv = season.divisions.length > 1
  const champs = championLabels(season)

  return (
    <div className="space-y-8">
      {/* Season header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{season.label}</h2>
        {champs.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gold">
            <Trophy className="size-4" aria-hidden />
            {champs.join(' · ')}
          </span>
        )}
      </div>

      {/* In-page jump nav */}
      <nav aria-label="Season sections" className="-mt-4 flex flex-wrap gap-2">
        {[
          { href: '#groups', label: 'Groups' },
          { href: '#playoffs', label: 'Playoffs' },
        ].map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {l.label}
          </a>
        ))}
      </nav>

      {season.divisions.map((div, i) => (
        <div key={i} className="space-y-6">
          {multiDiv && <p className="eyebrow text-gold">Division {div.division}</p>}

          <Collapsible id={i === 0 ? 'groups' : undefined} title="Groups" icon={Users} meta="Round robin">
            <GroupStandings groups={div.groups} />
          </Collapsible>

          <section id={i === 0 ? 'playoffs' : undefined} className="scroll-mt-6">
            <div className="mb-3 flex items-center gap-2 border-b border-border pb-2">
              <GitBranch className="size-4 text-gold" aria-hidden />
              <span className="eyebrow text-foreground">Playoffs</span>
              <span className="text-xs text-muted-foreground">
                {div.doubleElim ? 'Double elimination' : 'Single elimination'}
              </span>
            </div>
            {div.doubleElim ? (
              <DoubleElimBracket winners={div.doubleElim.winners} losers={div.doubleElim.losers} />
            ) : div.playoff ? (
              <SeasonBracket rounds={toBracketRounds(div)} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {div.playoffNote ?? 'No playoff bracket recorded for this division.'}
              </p>
            )}
          </section>
        </div>
      ))}
    </div>
  )
}

/**
 * A year's worth of seasons: chips pick which season's dashboard is shown (one at a
 * time), and the selected season renders as a full stacked dashboard (Groups over
 * Playoffs). Changing the chip swaps the dashboard client-side without navigating.
 */
export function SeasonYear({ seasons }: { seasons: ArchiveSeason[] }) {
  const [selectedId, setSelectedId] = useState(seasons[0]?.seasonId ?? '')
  const season = seasons.find((s) => s.seasonId === selectedId) ?? seasons[0]

  if (!season) {
    return <p className="text-sm text-muted-foreground">No seasons recorded for this year.</p>
  }

  return (
    <div className="space-y-6">
      {seasons.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Seasons this year">
          {seasons.map((s) => {
            const isActive = s.seasonId === season.seasonId
            return (
              <button
                key={s.seasonId}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setSelectedId(s.seasonId)}
                className={cn(
                  'rounded-md border px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  isActive
                    ? 'border-gold/50 bg-gold/10 text-gold'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                Season {s.period}
              </button>
            )
          })}
        </div>
      )}

      {season.pending || season.divisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Data for {season.label} is being entered — coming soon.
        </p>
      ) : (
        <SeasonDashboard season={season} />
      )}
    </div>
  )
}
