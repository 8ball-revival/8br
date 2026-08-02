import { cn } from '@/lib/utils'
import type { RankingRow } from '@/lib/stats/rankings'
import type { MatchResult } from '@/lib/stats/rating-engine'

/** Confidence from RD: fuller = more established. */
function Confidence({ rd, provisional }: { rd: number; provisional: boolean }) {
  const tier = rd <= 75 ? 3 : rd <= 120 ? 2 : rd <= 200 ? 1 : 0
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('size-1.5 rounded-full', i < tier ? 'bg-gold' : 'bg-muted-foreground/25')}
          />
        ))}
      </span>
      {provisional && (
        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[0.6rem] font-medium tracking-wide text-warning uppercase">
          Prov
        </span>
      )}
    </span>
  )
}

function Trend({ trend, provisional }: { trend: number; provisional: boolean }) {
  // A provisional player's per-period swing is large and noisy — don't over-signal it.
  if (provisional || trend === 0) return <span className="text-muted-foreground/50">—</span>
  return trend > 0 ? (
    <span className="tabular font-medium text-success">▲ {trend}</span>
  ) : (
    <span className="tabular font-medium text-destructive">▼ {Math.abs(trend)}</span>
  )
}

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

const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th className={cn('px-3 py-2.5 text-left text-[0.62rem] font-semibold tracking-wider text-muted-foreground uppercase', className)}>
    {children}
  </th>
)
const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>
)

/**
 * Premium competitive ladder. Names alternate gold / warm-white (bracket style) for
 * readability; the podium is emphasised in gold. `allTime` switches the rating column
 * to peak details.
 */
export function RankingsTable({ rows, allTime = false }: { rows: RankingRow[]; allTime?: boolean }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-border bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
        No ranked players for this view yet.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead className="border-b border-border bg-card/60">
          <tr>
            <Th className="w-14 text-center">#</Th>
            <Th>Player</Th>
            <Th className="text-right">{allTime ? 'Peak' : 'Rating'}</Th>
            <Th className="hidden text-right md:table-cell">{allTime ? 'Peak CR' : 'CR'}</Th>
            <Th className="hidden lg:table-cell">Confidence</Th>
            <Th className="hidden text-right sm:table-cell">W–L</Th>
            <Th className="hidden text-right lg:table-cell">Win%</Th>
            <Th className="hidden text-center lg:table-cell">S</Th>
            <Th className="hidden text-center lg:table-cell">C</Th>
            <Th className="hidden text-center sm:table-cell">Titles</Th>
            {!allTime && <Th className="text-right">Trend</Th>}
            <Th className="hidden text-right md:table-cell">{allTime ? 'Peak when' : 'Form'}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const podium = r.rank <= 3
            const nameColor = i % 2 === 0 ? 'text-gold' : 'text-warm-white'
            return (
              <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-card/40">
                <Td className="text-center">
                  <span
                    className={cn(
                      'tabular font-semibold',
                      r.rank === 1 ? 'text-gold' : podium ? 'text-gold/80' : 'text-muted-foreground',
                    )}
                  >
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
                    {/* mobile-only secondary line */}
                    <span className="mt-0.5 flex items-center gap-2 text-[0.7rem] text-muted-foreground sm:hidden">
                      <span className="tabular">{r.wins}–{r.losses}</span>
                      {r.titles > 0 && <span className="text-gold">{r.titles}🏆</span>}
                    </span>
                  </div>
                </Td>
                <Td className="text-right">
                  <span className="tabular text-base font-bold text-foreground">
                    {allTime ? r.peakRating ?? '—' : r.rating}
                  </span>
                </Td>
                <Td className="hidden text-right md:table-cell">
                  <span className="tabular text-muted-foreground">{allTime ? r.peakCR ?? '—' : r.cr}</span>
                </Td>
                <Td className="hidden lg:table-cell">
                  <Confidence rd={r.rd} provisional={r.provisional} />
                </Td>
                <Td className="hidden text-right sm:table-cell">
                  <span className="tabular">
                    {r.wins}–{r.losses}
                    {r.draws > 0 && <span className="text-muted-foreground">–{r.draws}</span>}
                  </span>
                </Td>
                <Td className="hidden text-right tabular lg:table-cell">{r.winPct}%</Td>
                <Td className="hidden text-center tabular text-muted-foreground lg:table-cell">{r.seasonsPlayed}</Td>
                <Td className="hidden text-center tabular text-muted-foreground lg:table-cell">{r.cupsPlayed}</Td>
                <Td className="hidden text-center sm:table-cell">
                  {r.titles > 0 ? <span className="tabular font-semibold text-gold">{r.titles}</span> : <span className="text-muted-foreground/40">—</span>}
                </Td>
                {!allTime && (
                  <Td className="text-right">
                    <Trend trend={r.trend} provisional={r.provisional} />
                  </Td>
                )}
                <Td className="hidden text-right md:table-cell">
                  {allTime ? (
                    <span className="text-[0.7rem] text-muted-foreground">
                      {r.peakAchievedAt ? `${r.peakAchievedAt.year}` : '—'}
                    </span>
                  ) : (
                    <FormPips form={r.recentForm} />
                  )}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
