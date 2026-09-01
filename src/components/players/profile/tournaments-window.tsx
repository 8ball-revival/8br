'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { TournamentEntry, ProfileAchievement } from '@/lib/players/profile'
import {
  Figure, ItemSelector, MatchTable, ResultPill, RosterOnlyNotice, SubViews, recordText, signed,
} from './window-parts'

/**
 * A player's Tournaments — the same interaction as Seasons, over a different record.
 *
 * ── Not every tournament has a bracket ──────────────────────────────────────────────────────────
 * The site runs single elimination, double elimination, Swiss, groups-and-playoffs and round robin.
 * A Swiss event has rounds and no bracket; a round robin has neither. So the Bracket Path view is
 * offered only when the records actually contain round labels for this player, and what it draws is
 * the rounds they appeared in — from their own matches — rather than a bracket shape assumed from
 * the format.
 *
 * ── Teams ───────────────────────────────────────────────────────────────────────────────────────
 * Team name and teammates come from the tournament's own team roster, not from the match rows: a
 * match row knows who a team played, not who was on it.
 */
export function TournamentsWindow({
  tournaments, achievements, selectedId, onSelect,
}: {
  tournaments: TournamentEntry[]
  achievements: ProfileAchievement[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const [view, setView] = useState<'overview' | 'path' | 'matches'>('overview')
  const scrollBox = useRef(0)

  const selected = useMemo(
    () => tournaments.find((t) => t.tournamentId === selectedId) ?? tournaments[0] ?? null,
    [tournaments, selectedId],
  )

  const items = tournaments.map((t) => ({
    key: String(t.tournamentId),
    title: t.name,
    meta: t.participation === 'roster-only'
      ? 'Entered; no match records'
      : `${recordText(t.record)} · ${t.matchesPlayed} match${t.matchesPlayed === 1 ? '' : 'es'}`,
    badge: t.isChampion ? 'Winner' : null,
    dimmed: t.participation === 'roster-only',
  }))

  return (
    <div className="grid h-full grid-rows-[auto_1fr] lg:grid-cols-[16rem_1fr] lg:grid-rows-1">
      <ItemSelector
        items={items}
        selectedKey={selected ? String(selected.tournamentId) : null}
        onSelect={(k) => onSelect(Number(k))}
        label="Tournaments"
        retainScroll={scrollBox}
      />

      <div className="min-w-0 overflow-auto">
        {!selected ? (
          <p className="p-4 text-sm text-muted-foreground">No Tournaments recorded for this player.</p>
        ) : (
          <>
            <header className="border-b border-border px-3 py-3">
              <h4 className="font-display text-base font-bold text-foreground">{selected.name}</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {selected.year != null ? `${selected.year} · ` : ''}
                {humanFormat(selected.format)}
                {' · '}{selected.participantFormat === 'TEAM' ? 'Team' : 'Individual'}
                {' · '}{humanState(selected.status)}
                {selected.href !== '#' && (
                  <> {' · '}<Link href={selected.href} className="text-brand hover:text-brand-soft">Tournament page</Link></>
                )}
              </p>
            </header>

            {selected.participation === 'roster-only' ? (
              <div className="p-3"><RosterOnlyNotice what="Tournament" /></div>
            ) : (
              <>
                <SubViews
                  views={[
                    { key: 'overview', label: 'Overview' },
                    // Offered only when there are round labels to draw. A round robin has none.
                    { key: 'path', label: 'Round Progression', disabled: selected.path.length === 0 },
                    { key: 'matches', label: `Matches (${selected.matchesPlayed})` },
                  ]}
                  active={view}
                  onChange={(k) => setView(k as typeof view)}
                />

                {view === 'overview' && (
                  <div className="p-3">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                      <Figure label="Final placement" value={selected.placement} />
                      <Figure label="Record (W–L)" value={recordText(selected.record)} />
                      <Figure label="Win %" value={selected.winPct != null ? `${selected.winPct.toFixed(1)}%` : null} />
                      <Figure label="Matches" value={String(selected.matchesPlayed)} />
                      <Figure label="Format" value={humanFormat(selected.format)} />
                      <Figure label="Type" value={selected.participantFormat === 'TEAM' ? 'Team' : 'Individual'} />
                      <Figure
                        label="Rating change"
                        value={signed(selected.ratingChange)}
                        tone={selected.ratingChange == null ? undefined : selected.ratingChange > 0 ? 'up' : selected.ratingChange < 0 ? 'down' : undefined}
                      />
                      {selected.teamName && <Figure label="Team" value={selected.teamName} />}
                    </dl>

                    {selected.participantFormat === 'TEAM' && (
                      <div className="mt-4 border-t border-border pt-3">
                        <h5 className="eyebrow text-foreground">Team</h5>
                        <p className="mt-1 text-sm text-foreground">{selected.teamName ?? 'Team name not recorded'}</p>
                        {selected.teammates.length > 0 ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            With {selected.teammates.join(', ')}
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-muted-foreground">No teammates recorded for this team.</p>
                        )}
                      </div>
                    )}

                    <TournamentAchievements href={selected.href} achievements={achievements} />
                  </div>
                )}

                {view === 'path' && (
                  <div className="p-3">
                    <ol className="space-y-2">
                      {selected.path.map((step, i) => (
                        <li key={`${step.round}-${i}`} className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-2 last:border-b-0">
                          <span className="min-w-[9rem] text-sm font-semibold text-foreground">{step.round}</span>
                          <ResultPill result={step.result} />
                          <span className="text-sm text-muted-foreground">vs {step.opponent}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="mt-3 text-xs text-muted-foreground">
                      The rounds this player actually appeared in, from their recorded matches.
                    </p>
                  </div>
                )}

                {view === 'matches' && (
                  <MatchTable matches={selected.matches} emptyText="No matches recorded for this Tournament." />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TournamentAchievements({ href, achievements }: { href: string; achievements: ProfileAchievement[] }) {
  const mine = achievements.filter((a) => a.kind === 'tournament-title' && a.href === href)
  if (mine.length === 0) return null
  return (
    <div className="mt-4 border-t border-border pt-3">
      <h5 className="eyebrow text-foreground">Earned in this Tournament</h5>
      <ul className="mt-2 space-y-1">
        {mine.map((a) => (
          <li key={a.id} className="text-sm">
            <span className="font-semibold text-[var(--gold)]">{a.title}</span>
            <span className="text-muted-foreground"> — {a.caption}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function humanFormat(format: string | null): string {
  if (!format) return 'Format not recorded'
  const map: Record<string, string> = {
    SINGLE_ELIM: 'Single elimination',
    DOUBLE_ELIM: 'Double elimination',
    SWISS: 'Swiss',
    ROUND_ROBIN: 'Round robin',
    GROUPS_PLAYOFFS: 'Groups + playoffs',
  }
  return map[format] ?? format.replace(/_/g, ' ').toLowerCase()
}

function humanState(state: string): string {
  const map: Record<string, string> = {
    COMPLETED: 'Completed',
    IN_PROGRESS: 'In progress',
    UPCOMING: 'Upcoming',
    CANCELLED: 'Cancelled',
  }
  return map[state] ?? state.replace(/_/g, ' ').toLowerCase()
}
