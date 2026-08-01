'use client'

import { useState } from 'react'
import { GitBranch, Trophy, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Bracket } from '@/components/cups/bracket'
import { DoubleElimBracket } from '@/components/seasons/double-elim'
import { GroupStandings } from '@/components/seasons/group-standings'
import type { ArchiveSeason, SeasonDivision } from '@/lib/seasons/archive'
import type { BracketRound } from '@/lib/cups/fixtures'

type View = 'groups' | 'playoffs' | null

// Adapt archive playoff rounds (nullable a/b) to the shared cup Bracket shape.
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

export function SeasonRow({ season }: { season: ArchiveSeason }) {
  const [view, setView] = useState<View>(null)
  const pending = season.pending || season.divisions.length === 0
  const champions = season.divisions
    .map((d) => d.champion)
    .filter((c): c is { name: string; handle?: string } => Boolean(c))
    .map((c) => (c.handle && c.handle !== c.name ? `${c.name} · ${c.handle}` : c.name))

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-display text-lg font-bold tracking-tight">{season.label}</h3>
          {champions.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-sm text-gold">
              <Trophy className="size-3.5" aria-hidden />
              {champions.join(' · ')}
            </span>
          )}
        </div>

        {pending ? (
          <span className="text-xs text-muted-foreground">Data being entered — coming soon</span>
        ) : (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={view === 'groups' ? 'default' : 'outline'}
              aria-pressed={view === 'groups'}
              onClick={() => setView((v) => (v === 'groups' ? null : 'groups'))}
            >
              <Users className="size-4" aria-hidden /> Groups
            </Button>
            <Button
              size="sm"
              variant={view === 'playoffs' ? 'default' : 'outline'}
              aria-pressed={view === 'playoffs'}
              onClick={() => setView((v) => (v === 'playoffs' ? null : 'playoffs'))}
            >
              <GitBranch className="size-4" aria-hidden /> Playoffs
            </Button>
          </div>
        )}
      </div>

      {view && !pending && (
        <div className="space-y-6 border-t border-border p-4">
          {season.divisions.map((div, i) => (
            <div key={i}>
              {div.division !== 'single' && (
                <p className="eyebrow mb-3 text-gold">Division {div.division}</p>
              )}
              {view === 'groups' ? (
                <GroupStandings groups={div.groups} />
              ) : div.doubleElim ? (
                <DoubleElimBracket winners={div.doubleElim.winners} losers={div.doubleElim.losers} />
              ) : div.playoff ? (
                <Bracket rounds={toBracketRounds(div)} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {div.playoffNote ?? 'No playoff bracket recorded for this division.'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
