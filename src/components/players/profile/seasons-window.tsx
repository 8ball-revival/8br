'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { SeasonEntry, ProfileAchievement } from '@/lib/players/profile'
import {
  Figure, ItemSelector, MatchTable, RosterOnlyNotice, SubViews, played, recordText, signed,
} from './window-parts'

/**
 * A player's Seasons, one at a time, from the records that exist for each.
 *
 * ── Every figure here is a sum of matches ───────────────────────────────────────────────────────
 * Record, win percentage, group and playoff splits, rating change, best streak — all of them are
 * computed from that player's Rating Ledger rows for that Season, which is one row per completed
 * match. Nothing is carried over from a placing or a champion field.
 *
 * A Season with no match records shows no figures at all and says why. See `RosterOnlyNotice`.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────────────────────────
 * Group finish. A group placing comes from the group table — everyone's results against everyone
 * else — and cannot be derived from one player's rows. Rather than infer it from their record,
 * which would be wrong whenever a tiebreak decided it, the field is omitted and the Group Stage view
 * links to the Season, where the real table is.
 */
export function SeasonsWindow({
  seasons, achievements, selectedId, onSelect,
}: {
  seasons: SeasonEntry[]
  achievements: ProfileAchievement[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const [view, setView] = useState<'overview' | 'group' | 'playoffs' | 'matches'>('overview')
  const scrollBox = useRef(0)

  const selected = useMemo(
    () => seasons.find((s) => s.seasonId === selectedId) ?? seasons[0] ?? null,
    [seasons, selectedId],
  )

  const items = seasons.map((s) => ({
    key: String(s.seasonId),
    title: `${s.name} · ${s.year}`,
    meta: s.participation === 'roster-only'
      ? 'Roster only'
      : `${recordText(s.record)} · ${s.matchesPlayed} match${s.matchesPlayed === 1 ? '' : 'es'}`,
    badge: s.isChampion ? 'Champion' : null,
    dimmed: s.participation === 'roster-only',
  }))

  return (
    <div className="grid h-full grid-rows-[auto_1fr] lg:grid-cols-[16rem_1fr] lg:grid-rows-1">
      <ItemSelector
        items={items}
        selectedKey={selected ? String(selected.seasonId) : null}
        onSelect={(k) => onSelect(Number(k))}
        label="Seasons"
        retainScroll={scrollBox}
      />

      <div className="min-w-0 overflow-auto">
        {!selected ? (
          <p className="p-4 text-sm text-muted-foreground">No Seasons recorded for this player.</p>
        ) : (
          <>
            <header className="border-b border-border px-3 py-3">
              <h4 className="font-display text-base font-bold text-foreground">
                {selected.name} · {selected.year}
              </h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {selected.competition}
                {selected.division ? ` · Division ${selected.division}` : ''}
                {' · '}{humanState(selected.status)}
                {' · '}{selected.platform === 'YAHOO' ? 'Yahoo' : 'CueVerse'}
                {' · '}
                <Link href={selected.href} className="text-brand hover:text-brand-soft">Season page</Link>
              </p>
            </header>

            {selected.participation === 'roster-only' ? (
              <div className="p-3">
                <RosterOnlyNotice what="Season" />
              </div>
            ) : (
              <>
                <SubViews
                  views={[
                    { key: 'overview', label: 'Overview' },
                    { key: 'group', label: 'Group Stage', disabled: played(selected.groupRecord) === 0 },
                    { key: 'playoffs', label: 'Playoffs', disabled: played(selected.playoffRecord) === 0 },
                    { key: 'matches', label: `Matches (${selected.matchesPlayed})` },
                  ]}
                  active={view}
                  onChange={(k) => setView(k as typeof view)}
                />

                {view === 'overview' && (
                  <div className="p-3">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                      <Figure label="Final placement" value={selected.placement} />
                      <Figure label="Record (W–L–D)" value={recordText(selected.record)} />
                      <Figure label="Win %" value={selected.winPct != null ? `${selected.winPct.toFixed(1)}%` : null} />
                      <Figure label="Matches" value={String(selected.matchesPlayed)} />
                      <Figure label="Group record" value={recordText(selected.groupRecord)} />
                      <Figure label="Playoff record" value={recordText(selected.playoffRecord)} />
                      <Figure label="Playoff finish" value={selected.playoffFinish} />
                      <Figure
                        label="Rating change"
                        value={signed(selected.ratingChange)}
                        tone={selected.ratingChange == null ? undefined : selected.ratingChange > 0 ? 'up' : selected.ratingChange < 0 ? 'down' : undefined}
                      />
                      <Figure label="Rating start → end" value={selected.ratingBefore != null ? `${selected.ratingBefore} → ${selected.ratingAfter}` : null} />
                      <Figure label="Best win streak" value={selected.bestWinStreak ? `W${selected.bestWinStreak}` : '—'} />
                      {/*
                        Games are only known for matches whose frames were entered. Showing a total
                        that silently covers three of fifteen matches would read as a season total.
                      */}
                      <Figure
                        label="Games (W–L)"
                        value={selected.gamesWon != null ? `${selected.gamesWon}–${selected.gamesLost}` : null}
                      />
                      <Figure label="Group finish" value={selected.groupFinish} />
                    </dl>

                    {selected.gamesWon != null && selected.matchesWithGameData < selected.matchesPlayed && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Game totals cover the {selected.matchesWithGameData} of {selected.matchesPlayed} matches
                        whose frames were recorded.
                      </p>
                    )}
                    {selected.gamesWon == null && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        No frame scores were recorded for this Season, so game totals are unavailable.
                      </p>
                    )}

                    <SeasonAchievements seasonId={selected.seasonId} href={selected.href} achievements={achievements} />
                  </div>
                )}

                {view === 'group' && (
                  <div>
                    <div className="px-3 pt-3">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                        <Figure label="Group record" value={recordText(selected.groupRecord)} />
                        <Figure label="Group matches" value={String(played(selected.groupRecord))} />
                        <Figure label="Group finish" value={selected.groupFinish} />
                      </dl>
                      <p className="mt-2 text-xs text-muted-foreground">
                        A group placing is decided by the whole group table, not by one player&apos;s results —
                        see the <Link href={selected.href} className="text-brand hover:text-brand-soft">Season page</Link> for the standings.
                      </p>
                    </div>
                    <MatchTable
                      matches={selected.matches.filter((m) => m.stage !== 'PLAYOFF')}
                      emptyText="No group matches recorded for this Season."
                    />
                  </div>
                )}

                {view === 'playoffs' && (
                  <div>
                    <div className="px-3 pt-3">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                        <Figure label="Playoff record" value={recordText(selected.playoffRecord)} />
                        <Figure label="Playoff finish" value={selected.playoffFinish} />
                        <Figure label="Playoff matches" value={String(played(selected.playoffRecord))} />
                      </dl>
                    </div>
                    <MatchTable
                      matches={selected.matches.filter((m) => m.stage === 'PLAYOFF')}
                      emptyText="This player did not reach the playoffs in this Season."
                    />
                  </div>
                )}

                {view === 'matches' && (
                  <MatchTable matches={selected.matches} emptyText="No matches recorded for this Season." />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** Titles won in this Season, from the achievements the profile already holds. */
function SeasonAchievements({ seasonId, href, achievements }: {
  seasonId: number
  href: string
  achievements: ProfileAchievement[]
}) {
  // Matched by the Season's own link, which is how the trophy list identifies a Season.
  const mine = achievements.filter((a) => a.kind === 'season-title' && (a.href === href || a.id.endsWith(`/${seasonId}`)))
  if (mine.length === 0) return null
  return (
    <div className="mt-4 border-t border-border pt-3">
      <h5 className="eyebrow text-foreground">Earned in this Season</h5>
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

/** SEASON_LIFECYCLE states, in words. Unknown values pass through rather than becoming "Unknown". */
function humanState(state: string): string {
  const map: Record<string, string> = {
    COMPLETED: 'Completed',
    IN_PROGRESS: 'In progress',
    PLAYOFFS: 'Playoffs',
    GROUP_STAGE: 'Group stage',
    PLAYOFF_SETUP: 'Playoff setup',
    REGISTRATION_OPEN: 'Registration open',
    REGISTRATION_CLOSED: 'Registration closed',
    REGISTRATION_SCHEDULED: 'Registration scheduled',
    CANCELLED: 'Cancelled',
  }
  return map[state] ?? state.replace(/_/g, ' ').toLowerCase()
}
