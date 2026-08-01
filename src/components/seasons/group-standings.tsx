import { Crown, Disc, Flame, Star, Swords, Target, Triangle, Zap, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SeasonGroup, SeasonStandingRow } from '@/lib/seasons/archive'

// Per-group accents drawn from the project's own chart tokens (gold/blue/green/
// purple/red — already tuned to the dark theme), applied subtly for a little life.
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

/** Round-robin group standings — one themed table per group, ranked by points. */
export function GroupStandings({ groups }: { groups: SeasonGroup[] }) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No group stage recorded for this division.</p>
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => {
        const t = themeFor(g.letter)
        const mix = (pct: number) => `color-mix(in oklch, ${t.color} ${pct}%, transparent)`
        const Icon = t.Icon
        return (
          <div key={g.letter} className="overflow-hidden rounded-lg border bg-card" style={{ borderColor: mix(22) }}>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span
                className="flex size-6 items-center justify-center rounded-md border"
                style={{ color: t.color, backgroundColor: mix(12), borderColor: mix(30) }}
              >
                <Icon className="size-3.5" aria-hidden />
              </span>
              <span className="font-display text-sm font-semibold">Group {g.letter}</span>
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
  )
}
