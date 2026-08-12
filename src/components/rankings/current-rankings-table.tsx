'use client'

import { Fragment, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { CurrentScoreRow } from '@/lib/stats/current-score'
import type { MatchResult } from '@/lib/stats/rating-engine'

function FormPips({ form }: { form: MatchResult[] }) {
  if (!form.length) return <span className="text-muted-foreground/50">—</span>
  return (
    <span className="inline-flex gap-1">
      {form.map((r, i) => (
        <span
          key={i}
          title={r === 'W' ? 'Win' : r === 'L' ? 'Loss' : 'Draw'}
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

function Trend({ trend }: { trend: number }) {
  if (trend > 0) return <span className="tabular font-medium text-success">▲ {trend}</span>
  if (trend < 0) return <span className="tabular font-medium text-destructive">▼ {Math.abs(trend)}</span>
  return <span className="text-muted-foreground/50">—</span>
}

const Th = ({ children, className, title }: { children?: React.ReactNode; className?: string; title?: string }) => (
  <th title={title} className={cn('px-3 py-2.5 text-left text-[0.62rem] font-semibold tracking-wider text-muted-foreground uppercase', className)}>
    {children}
  </th>
)
const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>
)

/**
 * Current ladder (hybrid performance score). Each row expands to a transparent,
 * point-by-point breakdown. Names alternate gold / warm-white; podium is gold.
 */
export function CurrentRankingsTable({ rows }: { rows: CurrentScoreRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-border bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
        No official matches inside the current window yet.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead className="border-b border-border bg-card/60">
          <tr>
            <Th className="w-12 text-center">#</Th>
            <Th>Player</Th>
            <Th className="text-right">Score</Th>
            <Th className="hidden text-right sm:table-cell">W–L</Th>
            <Th className="hidden text-right lg:table-cell">Win%</Th>
            <Th className="hidden text-center lg:table-cell">Group</Th>
            <Th className="hidden text-center lg:table-cell">Playoff</Th>
            <Th className="hidden text-center lg:table-cell">Titles</Th>
            <Th className="hidden text-center md:table-cell" title="Tournament titles">ST</Th>
            <Th className="hidden text-center md:table-cell" title="Tournament titles">CT</Th>
            <Th className="hidden text-center xl:table-cell" title="Quality wins">QW</Th>
            <Th className="hidden text-right md:table-cell">Form</Th>
            <Th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const podium = r.rank <= 3
            const nameColor = i % 2 === 0 ? 'text-brand' : 'text-warm-white'
            const expanded = open.has(r.id)
            return (
              <Fragment key={r.id}>
                <tr
                  onClick={() => toggle(r.id)}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-card/40"
                >
                  <Td className="text-center">
                    <span className={cn('tabular font-semibold', r.rank === 1 ? 'text-brand' : podium ? 'text-brand/80' : 'text-muted-foreground')}>
                      {r.rank}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-col">
                      <span className={cn('font-semibold', nameColor, podium && 'text-[0.95rem]')}>
                        {r.name}
                        {!r.resolved && (
                          <span className="ml-2 align-middle rounded bg-muted-foreground/10 px-1.5 py-0.5 text-[0.55rem] font-medium tracking-wide text-muted-foreground uppercase">
                            Unverified ID
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[0.7rem] text-muted-foreground sm:hidden">
                        <span className="tabular">{r.wins}–{r.losses}</span>
                        {r.seasonTitles > 0 && <span className="text-brand">{r.seasonTitles}× ST</span>}
                        {r.cupTitles > 0 && <span className="text-brand">{r.cupTitles}× CT</span>}
                      </span>
                    </div>
                  </Td>
                  <Td className="text-right"><span className="tabular text-base font-bold text-foreground">{r.score}</span></Td>
                  <Td className="hidden text-right tabular sm:table-cell">{r.wins}–{r.losses}{r.draws ? <span className="text-muted-foreground">–{r.draws}</span> : null}</Td>
                  <Td className="hidden text-right tabular lg:table-cell">{r.winPct}%</Td>
                  <Td className="hidden text-center tabular text-muted-foreground lg:table-cell">{r.groupW}–{r.groupL}{r.groupD ? `–${r.groupD}` : ''}</Td>
                  <Td className="hidden text-center tabular text-muted-foreground lg:table-cell">{r.playoffW}–{r.playoffL}</Td>
                  <Td className="hidden text-center tabular text-muted-foreground lg:table-cell">{r.cupW}–{r.cupL}</Td>
                  <Td className="hidden text-center md:table-cell">{r.seasonTitles > 0 ? <span className="tabular font-semibold text-brand">{r.seasonTitles}</span> : <span className="text-muted-foreground/40">—</span>}</Td>
                  <Td className="hidden text-center md:table-cell">{r.cupTitles > 0 ? <span className="tabular font-semibold text-brand">{r.cupTitles}</span> : <span className="text-muted-foreground/40">—</span>}</Td>
                  <Td className="hidden text-center tabular xl:table-cell">{r.qualityWins > 0 ? <span className="text-success">{r.qualityWins}</span> : <span className="text-muted-foreground/40">—</span>}</Td>
                  <Td className="hidden text-right md:table-cell"><FormPips form={r.recentForm} /></Td>
                  <Td className="text-center">
                    <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden />
                  </Td>
                </tr>
                {expanded && (
                  <tr className="border-b border-border/60 bg-card/20">
                    <td />
                    <td colSpan={12} className="px-4 py-3">
                      <div className="mb-2 flex items-center gap-2 text-[0.62rem] font-semibold tracking-wider text-muted-foreground uppercase">
                        Why {r.name} is ranked #{r.rank} · Trend <Trend trend={r.trend} />
                      </div>
                      <ul className="max-w-md space-y-1 text-sm">
                        {r.breakdown.map((l, j) => {
                          const total = l.label === 'Total'
                          return (
                            <li
                              key={j}
                              className={cn(
                                'flex items-center justify-between gap-6',
                                total && 'mt-1 border-t border-border pt-1.5 font-semibold',
                              )}
                            >
                              <span className={total ? 'text-foreground' : 'text-muted-foreground'}>{l.label}</span>
                              <span className={cn('tabular', total ? 'text-brand' : l.points >= 0 ? 'text-success' : 'text-destructive')}>
                                {l.points >= 0 ? '+' : ''}{l.points}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
