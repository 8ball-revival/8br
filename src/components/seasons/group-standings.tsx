'use client'

import { useState } from 'react'
import { ChevronDown, Crown, Disc, Flame, Star, Swords, Target, Triangle, Zap, type LucideIcon } from 'lucide-react'

import { GroupDetail } from '@/components/seasons/group-detail'
import { cn } from '@/lib/utils'
import type { SeasonGroup, SeasonStandingRow } from '@/lib/seasons/archive'

// Per-group accents from the project's chart tokens (gold/blue/green/purple/red),
// applied subtly for a little life while staying on the dark theme.
const THEMES: { color: string; Icon: LucideIcon }[] = [
  { color: 'var(--chart-1)', Icon: Crown }, // A · gold
  { color: 'var(--chart-2)', Icon: Swords }, // B · blue
  { color: 'var(--chart-4)', Icon: Triangle }, // C · green
  { color: 'var(--chart-3)', Icon: Disc }, // D · purple
  { color: 'var(--chart-5)', Icon: Flame }, // E · red
  { color: 'var(--chart-2)', Icon: Star }, // F+
  { color: 'var(--chart-3)', Icon: Zap },
  { color: 'var(--chart-4)', Icon: Target },
]

function themeFor(letter: string) {
  const i = letter.toUpperCase().charCodeAt(0) - 65
  return THEMES[((i % THEMES.length) + THEMES.length) % THEMES.length]
}

// #1 → gold (+ crown); banned/withdrew/kicked → red; made playoffs → baby blue; else white.
function nameClass(row: SeasonStandingRow, isFirst: boolean): string {
  if (row.banned) return 'text-destructive'
  if (isFirst) return 'text-gold'
  if (row.advanced) return 'text-[var(--chart-2)]'
  return 'text-foreground'
}

/**
 * Group overview: a compact standings card per group (the excellent at-a-glance
 * view). Clicking a card expands a full-width deep-dive beneath the grid — one at a
 * time — with the H2H matrix, matches, qualification, and stats.
 */
export function GroupStandings({ groups }: { groups: SeasonGroup[] }) {
  const [openLetter, setOpenLetter] = useState<string | null>(null)

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No group stage recorded for this division.</p>
  }
  const open = groups.find((g) => g.letter === openLetter) ?? null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
        {groups.map((g) => {
          const t = themeFor(g.letter)
          const mix = (pct: number) => `color-mix(in oklch, ${t.color} ${pct}%, transparent)`
          const Icon = t.Icon
          const isOpen = g.letter === openLetter
          const toggle = () => setOpenLetter((l) => (l === g.letter ? null : g.letter))
          return (
            <div
              key={g.letter}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} Group ${g.letter} details`}
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  toggle()
                }
              }}
              className={cn(
                'cursor-pointer overflow-hidden rounded-lg border bg-card outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
                isOpen && 'ring-1 ring-gold/50',
              )}
              style={{ borderColor: isOpen ? mix(55) : mix(22) }}
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span
                  className="flex size-6 items-center justify-center rounded-md border"
                  style={{ color: t.color, backgroundColor: mix(12), borderColor: mix(30) }}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <span className="font-display text-sm font-semibold">Group {g.letter}</span>
                <ChevronDown
                  className={cn('ml-auto size-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
                  aria-hidden
                />
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[0.6rem] tracking-wide text-muted-foreground uppercase">
                    <th className="px-2 py-1 text-left font-medium">#</th>
                    <th className="py-1 text-left font-medium">Player</th>
                    <th className="px-1 py-1 text-right font-medium">P</th>
                    <th className="px-1 py-1 text-right font-medium">W</th>
                    <th className="px-1 py-1 text-right font-medium">L</th>
                    <th className="px-2 py-1 text-right font-medium">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => {
                    const first = i === 0 && !r.banned
                    const nc = nameClass(r, first)
                    return (
                      <tr key={i} className="border-t border-border/60">
                        <td className="tabular px-2 py-1 align-top text-muted-foreground">{i + 1}</td>
                        <td className="max-w-0 py-1 pr-2">
                          <div className={cn('flex items-center gap-1 font-medium', nc)}>
                            <span className="truncate">{r.name}</span>
                            {first && <Crown className="size-3 shrink-0" aria-hidden />}
                          </div>
                          {r.handle && r.handle !== r.name && (
                            <div className="truncate text-[0.6rem] leading-tight text-muted-foreground">{r.handle}</div>
                          )}
                        </td>
                        <td className="tabular px-1 py-1 text-right align-top text-muted-foreground">{r.played}</td>
                        <td className="tabular px-1 py-1 text-right align-top">{r.wins}</td>
                        <td className="tabular px-1 py-1 text-right align-top">{r.losses}</td>
                        <td className={cn('tabular px-2 py-1 text-right align-top font-semibold', nc)}>{r.points}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>

      {open && <GroupDetail key={open.letter} group={open} />}
    </div>
  )
}
