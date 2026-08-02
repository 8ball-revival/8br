import { cn } from '@/lib/utils'
import type { TeamTie, TiePlayer } from '@/lib/cups/fixtures'

/** Which side won an individual match: numeric compare, or W beats DQ. */
function matchWinner(home?: string, away?: string): 'home' | 'away' | null {
  if (!home && !away) return null
  if (home === 'W' || away === 'DQ') return 'home'
  if (away === 'W' || home === 'DQ') return 'away'
  const h = Number(home)
  const a = Number(away)
  if (!Number.isNaN(h) && !Number.isNaN(a)) return h > a ? 'home' : a > h ? 'away' : null
  return null
}

function PlayerName({ player, won, align }: { player: TiePlayer; won: boolean; align: 'left' | 'right' }) {
  return (
    <div className={cn('min-w-0', align === 'right' ? 'text-right' : 'text-left')}>
      <div className={cn('flex items-center gap-1.5', align === 'right' && 'justify-end')}>
        {player.captain && align === 'left' && <CaptainTag />}
        <span className={cn('truncate text-sm leading-tight', won ? 'font-semibold text-gold' : 'text-foreground')}>
          {player.name}
        </span>
        {player.captain && align === 'right' && <CaptainTag />}
      </div>
      {player.handle && <div className="truncate text-[0.65rem] leading-tight text-muted-foreground">{player.handle}</div>}
    </div>
  )
}

function CaptainTag() {
  return (
    <span
      className="shrink-0 rounded-sm border border-gold/40 px-1 text-[0.5rem] font-semibold uppercase leading-[1.4] tracking-wide text-gold"
      title="Team captain"
    >
      C
    </span>
  )
}

function Score({ value, won }: { value?: string; won: boolean }) {
  return (
    <span className={cn('tabular w-6 text-center text-sm', won ? 'font-bold text-gold' : 'text-muted-foreground')}>
      {value ?? '–'}
    </span>
  )
}

function Tie({ tie }: { tie: TeamTie }) {
  const homeWon = tie.winner === 'home'
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
        <span className="eyebrow text-muted-foreground">{tie.round}</span>
        <div className="flex items-center gap-2 text-sm">
          <span className={cn('font-semibold', homeWon ? 'text-gold' : 'text-muted-foreground')}>{tie.home}</span>
          <span className="tabular text-muted-foreground">
            {tie.homeWins}–{tie.awayWins}
          </span>
          <span className={cn('font-semibold', !homeWon ? 'text-gold' : 'text-muted-foreground')}>{tie.away}</span>
        </div>
      </div>
      <ul className="divide-y divide-border/60">
        {tie.matches.map((m, i) => {
          const w = matchWinner(m.homeScore, m.awayScore)
          return (
            <li key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2">
              <PlayerName player={m.home} won={w === 'home'} align="right" />
              <div className="flex items-center gap-1">
                <Score value={m.homeScore} won={w === 'home'} />
                <span className="text-[0.65rem] text-muted-foreground">{m.note ? '·' : '-'}</span>
                <Score value={m.awayScore} won={w === 'away'} />
              </div>
              <PlayerName player={m.away} won={w === 'away'} align="left" />
              {m.note && <p className="col-span-3 text-center text-[0.55rem] uppercase tracking-wide text-muted-foreground">{m.note}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Per-tie individual match logs for team-format cups (5v5, 2v2). */
export function TeamTies({ ties }: { ties: TeamTie[] }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {ties.map((tie, i) => (
        <Tie key={i} tie={tie} />
      ))}
    </div>
  )
}
