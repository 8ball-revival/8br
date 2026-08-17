'use client'

import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { PlayerName } from '@/components/identity/player-name'
import { identityLines, identityText } from '@/lib/identity/display'
import type { PublicGroupView, PublicGroupFixture } from '@/lib/competition/public'

type Tone = 'win' | 'loss' | 'pending' | 'none' | 'self'

/**
 * Classic pool-league group grid: every player is both a row and a column, each
 * cell is that head-to-head, with the standings frozen on the right. Colour-coded
 * (green win / red loss / yellow pending / grey not played), row+column highlight
 * on hover, and clicking a played cell opens the match details. Reuses the resolved
 * public group data (CueVerse IDs / preferred names only — no private data). Column headers show
 * the CueVerse ID alone for width; row headers carry the preferred name beneath it.
 */
export function GroupCrossTable({ group }: { group: PublicGroupView }) {
  const [hoverId, setHoverId] = useState<number | null>(null)
  const [selected, setSelected] = useState<PublicGroupFixture | null>(null)

  // Row/column order follows the standings (rank) when available, else seed order.
  const standingById = new Map(group.standings.map((s) => [s.registrationId, s]))
  const players = useMemo(() => {
    if (group.standings.length === group.players.length && group.standings.length > 0) {
      return [...group.standings].sort((a, b) => a.rank - b.rank)
        .map((s) => ({ id: s.registrationId, identity: { cueverseId: s.cueverseId, preferredName: s.displayName } }))
    }
    return group.players.map((p) => ({ id: p.registrationId, identity: { cueverseId: p.cueverseId, preferredName: p.displayName } }))
  }, [group])

  const identityById = useMemo(() => new Map(players.map((p) => [p.id, p.identity])), [players])
  const identityOf = (registrationId: number, fallback: string) =>
    identityText(identityById.get(registrationId) ?? { preferredName: fallback })

  // Fixture lookup by unordered pair.
  const byPair = useMemo(() => {
    const m = new Map<string, PublicGroupFixture>()
    for (const f of group.fixtures) m.set(pairKey(f.homeRegistrationId, f.awayRegistrationId), f)
    return m
  }, [group.fixtures])

  function cell(rowId: number, colId: number): { text: string; tone: Tone; fixture: PublicGroupFixture | null } {
    if (rowId === colId) return { text: '', tone: 'self', fixture: null }
    const f = byPair.get(pairKey(rowId, colId))
    if (!f) return { text: '—', tone: 'none', fixture: null }
    const rowIsHome = f.homeRegistrationId === rowId
    const rowGames = rowIsHome ? f.homeGames : f.awayGames
    const colGames = rowIsHome ? f.awayGames : f.homeGames
    if (f.decided && rowGames != null && colGames != null) {
      const rowWon = f.winner === (rowIsHome ? 'home' : 'away')
      return { text: `${rowGames}–${colGames}`, tone: rowWon ? 'win' : 'loss', fixture: f }
    }
    if (f.status === 'DISPUTED') return { text: 'Pending', tone: 'pending', fixture: f }
    return { text: 'Not played', tone: 'none', fixture: f }
  }

  const toneClass: Record<Tone, string> = {
    win: 'bg-success/15 text-success font-semibold',
    loss: 'bg-destructive/15 text-destructive',
    pending: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400',
    none: 'bg-muted/50 text-muted-foreground/70 text-[0.65rem]',
    self: 'bg-foreground/[0.06]',
  }
  const hl = (id: number) => hoverId != null && id === hoverId

  return (
    <div className="rounded-lg border border-border bg-card/40">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="font-display text-lg font-semibold">{group.name}</h3>
        <span className="flex items-center gap-2 text-[0.65rem] text-muted-foreground">
          <Legend className="bg-success/40" /> Win <Legend className="bg-destructive/40" /> Loss
          <Legend className="bg-yellow-500/40" /> Pending <Legend className="bg-muted-foreground/30" /> Not played
        </span>
      </div>

      <div className="flex">
        {/* Matrix (scrolls horizontally) */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 h-10 min-w-40 bg-card px-3 text-left text-xs font-medium text-muted-foreground">Player</th>
                {players.map((c) => (
                  <th
                    key={c.id}
                    className={cn('h-10 min-w-14 px-2 text-center text-[0.7rem] font-medium', hl(c.id) ? 'bg-brand/10 text-brand' : 'text-muted-foreground')}
                    onMouseEnter={() => setHoverId(c.id)}
                    onMouseLeave={() => setHoverId(null)}
                    title={identityText(c.identity)}
                  >
                    <span className="block max-w-16 truncate">{identityLines(c.identity).primary}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {players.map((row) => (
                <tr key={row.id} className={cn(hl(row.id) && 'bg-brand/5')}>
                  <th
                    scope="row"
                    className={cn('sticky left-0 z-10 h-10 min-w-40 border-t border-border bg-card px-3 text-left font-medium', hl(row.id) && 'text-brand')}
                    onMouseEnter={() => setHoverId(row.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    <PlayerName identity={row.identity} size="sm" className="max-w-40" emphasis="plain" />
                  </th>
                  {players.map((col) => {
                    const { text, tone, fixture } = cell(row.id, col.id)
                    const clickable = !!fixture && fixture.decided
                    return (
                      <td
                        key={col.id}
                        className={cn(
                          'h-10 min-w-14 border-t border-l border-border px-2 text-center tabular text-xs',
                          toneClass[tone],
                          (hl(row.id) || hl(col.id)) && 'ring-1 ring-inset ring-brand/40',
                          clickable && 'cursor-pointer hover:brightness-125',
                        )}
                        onMouseEnter={() => setHoverId(col.id)}
                        onMouseLeave={() => setHoverId(null)}
                        onClick={clickable ? () => setSelected(fixture) : undefined}
                        title={clickable ? 'View match details' : undefined}
                      >
                        {text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Standings (frozen on the right) */}
        <div className="shrink-0 border-l border-border">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="text-[0.7rem] text-muted-foreground">
                <th className="h-10 px-2 text-center font-medium">#</th>
                <th className="h-10 px-2 text-right font-medium">Pts</th>
                <th className="h-10 px-2 text-right font-medium">W–L</th>
                <th className="h-10 px-2 text-right font-medium">Games</th>
                <th className="h-10 px-2 text-right font-medium">Diff</th>
                <th className="h-10 px-2 text-right font-medium">Win%</th>
              </tr>
            </thead>
            <tbody>
              {players.map((row) => {
                const s = standingById.get(row.id)
                const winPct = s && s.played > 0 ? Math.round((s.wins / s.played) * 100) : 0
                return (
                  <tr
                    key={row.id}
                    className={cn(hl(row.id) && 'bg-brand/5', s?.qualified && 'bg-success/5')}
                    onMouseEnter={() => setHoverId(row.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    <td className="h-10 border-t border-border px-2 text-center tabular text-muted-foreground">{s?.rank ?? '—'}</td>
                    <td className="h-10 border-t border-border px-2 text-right tabular font-semibold">{s?.points ?? 0}</td>
                    <td className="h-10 border-t border-border px-2 text-right tabular">{s ? `${s.wins}–${s.losses}` : '—'}</td>
                    <td className="h-10 border-t border-border px-2 text-right tabular text-muted-foreground">{s ? `${s.gamesWon}–${s.gamesLost}` : '—'}</td>
                    <td className="h-10 border-t border-border px-2 text-right tabular">{s ? (s.gameDiff > 0 ? `+${s.gameDiff}` : s.gameDiff) : '—'}</td>
                    <td className="h-10 border-t border-border px-2 text-right tabular text-muted-foreground">{winPct}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Match details */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)} role="presentation">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="font-display text-lg font-semibold">Match details</h4>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)} aria-label="Close">✕</button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{group.name} · Round {selected.round}</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              {/* Resolve through the table's own identities so the modal names people the same way
                  the grid does, rather than falling back to the fixture's stored name. */}
              <span className={cn('font-medium', selected.winner === 'home' && 'text-success')}>
                {identityOf(selected.homeRegistrationId, selected.homeName)}
              </span>
              <span className="tabular text-lg font-bold">{selected.homeGames}–{selected.awayGames}</span>
              <span className={cn('text-right font-medium', selected.winner === 'away' && 'text-success')}>
                {identityOf(selected.awayRegistrationId, selected.awayName)}
              </span>
            </div>
            <div className="mt-3">
              <Badge variant={selected.status === 'DISPUTED' ? 'destructive' : 'success'}>
                {selected.status === 'COMPLETED' ? 'Completed' : selected.status === 'FORFEIT' ? 'Forfeit' : selected.status === 'NO_SHOW' ? 'No-show' : selected.status}
              </Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Legend({ className }: { className?: string }) {
  return <span className={cn('inline-block size-2.5 rounded-[2px] align-middle', className)} aria-hidden />
}

function pairKey(a: number, b: number) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}
