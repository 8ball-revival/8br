'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { ProfileAchievement, ProfileMatchRow } from '@/lib/players/profile'
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
                {/* As precise as the record allows: "2005" for the archive, a full date for a live match. */}
                <Td className="whitespace-nowrap text-muted-foreground">{m.dateLabel}</Td>
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

/*
  The old Head to Head table used to live here: every opponent, always rendered.

  It moved to `head-to-head-panel.tsx` and now starts empty behind a player picker — 112 rows of
  one-match rivalries from 2007 was not a comparison, it was a wall.
*/

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
