'use client'

import { X, Loader2 } from 'lucide-react'

import type { ExplorerRow } from '@/lib/stats/ladder-explorer'
import { completenessOf } from '@/lib/stats/rankings-facts'
import type { HeadToHeadPair } from '@/lib/stats/rankings-detail'
import type { ChampionshipMode } from '@/lib/stats/rankings-columns'
import { cn } from '@/lib/utils'

import { IdentityCell } from './identity-cell'
import { Tip } from './tooltip'

/**
 * Side-by-side comparison of two or three players.
 *
 * Everything here is the row the table already computed under the reader's current scope, view and
 * filters — so the comparison cannot disagree with the table it was opened from. The one figure
 * that is fetched separately is the direct head-to-head, because it is a fact about a PAIR and no
 * row can carry it.
 *
 * Head-to-head follows the same exclusions as everything else, because it reads the same ledger
 * rows: forfeits count as meetings and contribute no frames, and two players are only ever the same
 * person if the canonical identity records say so — nothing here matches on similar names.
 */

const COMPLETENESS_NOTE: Record<ReturnType<typeof completenessOf>, string> = {
  complete: 'Complete match and game data',
  partial: 'Some matches have no game score, so game figures cover only those that do',
  'match-only': 'Match results only — no game scores recorded',
  none: 'No recorded matches in this scope',
}

function Cell({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <td className={cn('px-3 py-1.5 text-right tabular-nums', muted && 'text-muted-foreground')}>{children}</td>
}

function Head({ label, tip }: { label: string; tip?: string }) {
  return (
    <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-normal text-muted-foreground">
      {tip ? <Tip text={tip}><span className="underline decoration-dotted underline-offset-2">{label}</span></Tip> : label}
    </th>
  )
}

export function ComparePanel({
  rows, mode, headToHead, loading, onRemove, onClear,
}: {
  rows: ExplorerRow[]
  mode: ChampionshipMode
  headToHead: HeadToHeadPair[]
  loading: boolean
  onRemove: (playerId: string) => void
  onClear: () => void
}) {
  if (rows.length === 0) return null

  const nameOf = (id: string) => {
    const r = rows.find((x) => x.playerId === id)
    return r?.preferredName || r?.cueverseId || 'Unknown'
  }

  const record = (w: number, l: number, d = 0) => `${w}–${l}${d > 0 ? `–${d}` : ''}`

  return (
    <section
      aria-label="Player comparison"
      className="mb-3 rounded-md border border-[var(--gold)]/40 bg-white/[0.03] p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Comparing {rows.length} player{rows.length === 1 ? '' : 's'}
          {rows.length === 1 && <span className="ml-2 font-normal text-muted-foreground">— select one more to compare</span>}
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="rounded px-2 py-1 text-xs text-muted-foreground underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          Clear comparison
        </button>
      </div>

      <div className="scrollbar-themed overflow-x-auto">
        <table className="w-full min-w-max text-xs">
          <thead>
            <tr>
              <td />
              {rows.map((r) => (
                <th key={r.playerId} scope="col" className="min-w-[9rem] px-3 pb-2 text-right align-bottom">
                  <div className="flex items-start justify-end gap-2">
                    <IdentityCell
                      identity={{ preferredName: r.preferredName, cueverseId: r.cueverseId, slug: r.slug }}
                      className="text-right"
                    />
                    <button
                      type="button"
                      onClick={() => onRemove(r.playerId)}
                      aria-label={`Remove ${r.preferredName || r.cueverseId} from the comparison`}
                      className="mt-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr><Head label="Official rank" tip="Standing in the current scope and record view. Unaffected by sorting or by pinning." />
              {rows.map((r) => <Cell key={r.playerId}>{r.rank}</Cell>)}</tr>
            <tr><Head label="Overall record" />
              {rows.map((r) => <Cell key={r.playerId}>{record(r.wins, r.losses, r.draws)}</Cell>)}</tr>
            <tr><Head label="Group record" />
              {rows.map((r) => <Cell key={r.playerId}>{record(r.groupWins, r.groupLosses)}</Cell>)}</tr>
            <tr><Head label="Playoff record" />
              {rows.map((r) => <Cell key={r.playerId}>{record(r.playoffWins, r.playoffLosses)}</Cell>)}</tr>
            <tr><Head label="Cup record" />
              {rows.map((r) => <Cell key={r.playerId}>{record(r.tournamentWins, r.tournamentLosses)}</Cell>)}</tr>
            <tr><Head label={mode === 'SC' ? 'Season Championships' : 'Cup Titles'} />
              {rows.map((r) => <Cell key={r.playerId}>{(mode === 'SC' ? r.seasonTitles : r.tournamentTitles) || '—'}</Cell>)}</tr>
            <tr><Head label="Finals reached" />
              {rows.map((r) => <Cell key={r.playerId}>{r.finalsAppearances || '—'}</Cell>)}</tr>
            <tr><Head label="Rating" />
              {rows.map((r) => <Cell key={r.playerId}>{r.rating}</Cell>)}</tr>
            <tr><Head label="Peak rating" tip="Highest rating actually reached in scope, from the rating ledger." />
              {rows.map((r) => <Cell key={r.playerId}>{r.peakRating}</Cell>)}</tr>
            <tr><Head label="GW–GL" tip="Games won and games lost, over the matches whose frames were recorded." />
              {rows.map((r) => <Cell key={r.playerId}>{r.gamesWon}–{r.gamesLost}</Cell>)}</tr>
            <tr><Head label="Game differential" />
              {rows.map((r) => <Cell key={r.playerId}>{r.gameDiff > 0 ? `+${r.gameDiff}` : r.gameDiff}</Cell>)}</tr>
            <tr><Head label="Longest winning run" />
              {rows.map((r) => <Cell key={r.playerId}>{r.longestStreak ? `W${r.longestStreak}` : '—'}</Cell>)}</tr>
            <tr><Head label="Data completeness" tip="Whether the figures above rest on complete match and game data." />
              {rows.map((r) => (
                <Cell key={r.playerId} muted>
                  <span className="text-[0.68rem]">{COMPLETENESS_NOTE[completenessOf(r)]}</span>
                </Cell>
              ))}</tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 border-t border-border pt-2">
        <h3 className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
          Direct head-to-head
        </h3>
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />Looking for meetings…
          </p>
        ) : rows.length < 2 ? (
          <p className="text-xs text-muted-foreground">Select a second player to see their meetings.</p>
        ) : headToHead.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No recorded meetings between these players.
          </p>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {headToHead.map((h) => (
              <li key={`${h.a}-${h.b}`} className="tabular-nums">
                <span className="font-medium">{nameOf(h.a)}</span>{' '}
                <span className="text-[var(--gold)]">{h.aWins}</span>
                {' – '}
                <span className="text-[var(--gold)]">{h.bWins}</span>{' '}
                <span className="font-medium">{nameOf(h.b)}</span>
                {h.draws > 0 && <span className="text-muted-foreground"> ({h.draws} drawn)</span>}
                {h.matchesWithGameData > 0
                  ? <span className="text-muted-foreground"> · games {h.aGames}–{h.bGames}</span>
                  : <span className="text-muted-foreground"> · game scores not recorded</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
