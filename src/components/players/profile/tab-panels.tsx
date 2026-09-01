'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { HeadToHeadRow, ProfileAchievement, ProfileMatchRow } from '@/lib/players/profile'
import { ResultPill, Td, Th } from './window-parts'
import { cn } from '@/lib/utils'

/**
 * The two tabs beside Overview, and the Achievements window.
 *
 * All three read the same verified records the rest of the profile does. Nothing here computes a
 * new statistic — Match History lists the ledger, Head to Head groups it by opponent, and
 * Achievements shows what the player already holds.
 */

/** Every verified match, newest first. */
export function MatchHistoryPanel({ matches }: { matches: ProfileMatchRow[] }) {
  const [scope, setScope] = useState<'all' | 'season' | 'tournament'>('all')
  const [shown, setShown] = useState(60)

  const filtered = useMemo(
    () => (scope === 'all' ? matches : matches.filter((m) => m.kind === scope)),
    [matches, scope],
  )
  const visible = filtered.slice(0, shown)

  if (matches.length === 0) {
    return (
      <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">
        No completed matches are recorded for this player. Where the archive holds a roster entry but
        no matches, the Seasons window says so for that Season.
      </p>
    )
  }

  return (
    <section aria-label="Match history" className="dl-surface border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="eyebrow text-foreground">
          {filtered.length} verified match{filtered.length === 1 ? '' : 'es'}
        </h3>
        <div role="group" aria-label="Filter matches" className="flex gap-1">
          {([['all', 'All'], ['season', 'Seasons'], ['tournament', 'Tournaments']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setScope(key); setShown(60) }}
              aria-pressed={scope === key}
              className={cn(
                'border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                scope === key ? 'border-[var(--gold)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Date</Th>
              <Th>Competition</Th>
              <Th>Phase</Th>
              <Th>Opponent</Th>
              <Th className="text-right">Score</Th>
              <Th>Result</Th>
              <Th className="text-right">Rating</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m.sequence} className="border-b border-border/50 last:border-b-0">
                <Td className="whitespace-nowrap text-muted-foreground">{m.at.slice(0, 10)}</Td>
                <Td>
                  {m.competitionHref ? (
                    <Link href={m.competitionHref} className="text-brand hover:text-brand-soft">{m.competitionLabel}</Link>
                  ) : m.competitionLabel}
                </Td>
                <Td className="text-muted-foreground">
                  {m.stage === 'PLAYOFF' ? 'Playoffs' : 'Group'}
                  {m.roundLabel && <span className="block text-xs">{m.roundLabel}</span>}
                </Td>
                <Td className="text-foreground">
                  {m.opponentHref ? (
                    <Link href={m.opponentHref} className="text-brand hover:text-brand-soft">{m.opponentName}</Link>
                  ) : m.opponentName}
                </Td>
                <Td className="text-right tabular-nums text-foreground">{m.score ?? '—'}</Td>
                <Td><ResultPill result={m.result} isForfeit={m.isForfeit} /></Td>
                <Td className="text-right tabular-nums">
                  <span className={m.ratingChange > 0 ? 'text-[var(--win,inherit)]' : m.ratingChange < 0 ? 'text-[var(--loss,inherit)]' : 'text-muted-foreground'}>
                    {m.ratingChange > 0 ? `+${m.ratingChange}` : m.ratingChange}
                  </span>
                  <span className="ml-2 text-muted-foreground">{m.ratingAfter}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* A career can be hundreds of matches; the rest is one press away rather than 400 rows deep. */}
      {visible.length < filtered.length && (
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={() => setShown((n) => n + 120)}
            className="border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground transition-colors hover:border-[var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            Show more ({filtered.length - visible.length} remaining)
          </button>
        </div>
      )}
    </section>
  )
}

/** Every opponent this player has a recorded meeting with. */
export function HeadToHeadPanel({ rows }: { rows: HeadToHeadRow[] }) {
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const filtered = term ? rows.filter((r) => r.opponentName.toLowerCase().includes(term)) : rows

  if (rows.length === 0) {
    return (
      <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">
        No head-to-head records yet. These are built from completed matches, so a player with no
        recorded matches has none.
      </p>
    )
  }

  return (
    <section aria-label="Head to head" className="dl-surface border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="eyebrow text-foreground">{rows.length} opponents</h3>
        <div>
          <label htmlFor="h2h-filter" className="sr-only">Filter opponents by name</label>
          <input
            id="h2h-filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter opponents"
            className="border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Opponent</Th>
              <Th className="text-right">Played</Th>
              <Th className="text-right">W–L–D</Th>
              <Th className="text-right">Win %</Th>
              <Th>Last met</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.opponentId ?? r.opponentName} className="border-b border-border/50 last:border-b-0">
                <Td className="text-foreground">
                  {r.opponentId ? (
                    <Link href={`/players/${encodeURIComponent(r.opponentId)}`} className="text-brand hover:text-brand-soft">
                      {r.opponentName}
                    </Link>
                  ) : (
                    /* An archive handle nobody has matched to a profile. Shown, not linked to a 404. */
                    r.opponentName
                  )}
                </Td>
                <Td className="text-right tabular-nums text-muted-foreground">{r.played}</Td>
                <Td className="text-right tabular-nums text-foreground">
                  {r.wins}–{r.losses}{r.draws > 0 ? `–${r.draws}` : ''}
                </Td>
                <Td className={cn(
                  'text-right tabular-nums font-semibold',
                  r.winPct >= 50 ? 'text-[var(--win,inherit)]' : 'text-[var(--loss,inherit)]',
                )}>
                  {r.winPct.toFixed(1)}%
                </Td>
                <Td className="text-muted-foreground">
                  {r.lastMet.slice(0, 10)}
                  {r.lastCompetition && <span className="block text-xs">{r.lastCompetition}</span>}
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><Td className="text-muted-foreground" colSpan={5}>No opponent matches “{query}”.</Td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * The achievements this player holds.
 *
 * Deliberately a listing of existing data and not a new system. The larger rebuild is a later pass;
 * awarding anything here would create records this task was told not to create.
 */
export function AchievementsWindow({ achievements }: { achievements: ProfileAchievement[] }) {
  if (achievements.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No achievements recorded for this player yet. Championships and awards appear here as the
        records earn them.
      </p>
    )
  }
  return (
    <ul className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {achievements.map((a) => (
        <li key={a.id} className="border border-border p-3">
          <p className="flex items-baseline justify-between gap-2">
            <span className="font-display text-sm font-bold text-[var(--gold)]">{a.title}</span>
            {a.when && <span className="shrink-0 text-xs text-muted-foreground">{a.when}</span>}
          </p>
          <p className="mt-1 text-sm text-foreground">{a.caption}</p>
          {a.detail && a.detail !== a.caption && (
            <p className="mt-1 text-xs text-muted-foreground">{a.detail}</p>
          )}
          {a.href && (
            <Link href={a.href} className="mt-2 inline-block text-xs text-brand hover:text-brand-soft">
              View
            </Link>
          )}
        </li>
      ))}
    </ul>
  )
}
