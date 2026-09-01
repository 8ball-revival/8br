'use client'

import { useState } from 'react'
import type { PlayerProfilePage } from '@/lib/players/profile'
import { themeVars } from '@/lib/players/theme'
import { ProfileTabs } from './profile-tabs'
import { ExpandingCards } from './expanding-cards'
import { SeasonsWindow } from './seasons-window'
import { TournamentsWindow } from './tournaments-window'
import { AchievementsWindow, MatchHistoryPanel } from './tab-panels'
import { HeadToHeadPanel } from './head-to-head-panel'
import { IdentityHeader } from './identity-header'
import { AppearanceEditor } from './appearance-editor'
import { TableFrame } from './table-frame'
import { cn } from '@/lib/utils'

/**
 * The whole profile: one framed window between the site header and footer.
 *
 * ── One surface, one frame ──────────────────────────────────────────────────────────────────────
 * Everything below sits inside a single pool-table frame on a single background. The sections are
 * rectangles ON that surface rather than cards floating over the page — same border, same corner,
 * same padding, same gap, all declared once in `player-profile.css` so they cannot drift apart.
 *
 * ── The theme is scoped to this element ─────────────────────────────────────────────────────────
 * The player's colours are written as `--pf-*` custom properties on `.pf-root` and read by the CSS
 * beneath it. One profile therefore styles one subtree: it cannot reach the header, the footer, or
 * anybody else's profile. The editor writes to this same element for its live preview, so the
 * preview is the real thing rather than a mock-up that could disagree with it.
 *
 * ── Why the selections live here ────────────────────────────────────────────────────────────────
 * An expanded window unmounts when it closes. Holding the chosen Season and Tournament one level
 * above it is what makes reopening return to where the reader was.
 */
export function PlayerProfileView({
  data, shareUrl, canEdit, cueverseCard, cueverseWindow,
}: {
  data: PlayerProfilePage
  shareUrl: string
  canEdit: boolean
  cueverseCard: React.ReactNode
  cueverseWindow: React.ReactNode
}) {
  const { identity, career, current, allTime, seasons, tournaments, achievements } = data

  const [seasonId, setSeasonId] = useState<number | null>(seasons[0]?.seasonId ?? null)
  const [tournamentId, setTournamentId] = useState<number | null>(tournaments[0]?.tournamentId ?? null)
  const [editing, setEditing] = useState(false)

  /*
    The first data row: Current and All-Time, side by side and equal.

    Passed to `ExpandingCards` as `before` rather than rendered beside it, so an expanded window
    covers the whole Overview area — the profile opening up, rather than its lower half.
  */
  const summaryRow = (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
      <section className="pf-panel md:col-span-6">
        <h3 className="pf-heading">Current (Last 365 Days)</h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Figure label="Rank" value={current ? `#${current.rank}` : '—'} />
          <Figure label="Rating" value={current ? String(current.rating) : '—'} accent />
          <Figure label="Record" value={recordText(career.record)} />
          <Figure label="Win %" value={`${career.winPct.toFixed(1)}%`} />
        </dl>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Figure label="Streak" value={streakText(career.currentStreak)} accent />
          <Figure
            label="Longest Win Streak"
            value={career.longestWinStreak > 0 ? `W${career.longestWinStreak}` : '—'}
            wide
          />
        </dl>
        {!current && (
          <p className="mt-2 text-xs" style={{ color: 'var(--pf-muted)' }}>
            No matches inside the current window, so there is no current rank.
          </p>
        )}
      </section>

      <section className="pf-panel md:col-span-6">
        <h3 className="pf-heading">All-Time</h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Figure label="Rank" value={allTime ? `#${allTime.rank}` : '—'} />
          <Figure label="Rating" value={allTime ? String(allTime.rating) : '—'} accent />
          <Figure label="Highest Rank" value={allTime?.highestRank ? `#${allTime.highestRank}` : '—'} />
          <Figure label="Highest Rating" value={allTime?.highestRating ? String(allTime.highestRating) : '—'} />
        </dl>
      </section>
    </div>
  )

  const overview = (
    <ExpandingCards
      before={summaryRow}
      cards={[
        {
          key: 'career',
          title: '8 Ball Registry Career',
          actionLabel: 'View Matches',
          span: 'md:col-span-6',
          preview: <CareerPreview data={data} />,
          window: <div className="p-3"><MatchHistoryPanel matches={data.matches} /></div>,
          disabled: data.matches.length === 0,
        },
        {
          key: 'seasons',
          title: 'Seasons',
          span: 'md:col-span-3',
          preview: <SeasonsPreview data={data} />,
          window: (
            <SeasonsWindow
              seasons={seasons}
              achievements={achievements}
              selectedId={seasonId}
              onSelect={setSeasonId}
            />
          ),
          disabled: seasons.length === 0,
        },
        {
          key: 'tournaments',
          title: 'Tournaments',
          span: 'md:col-span-3',
          preview: <TournamentsPreview data={data} />,
          window: (
            <TournamentsWindow
              tournaments={tournaments}
              achievements={achievements}
              selectedId={tournamentId}
              onSelect={setTournamentId}
            />
          ),
          disabled: tournaments.length === 0,
        },
        {
          key: 'achievements',
          title: 'Achievements',
          span: 'md:col-span-4',
          preview: <AchievementsPreview data={data} />,
          window: <AchievementsWindow achievements={achievements} />,
          disabled: achievements.length === 0,
        },
        {
          key: 'cueverse',
          title: 'CueVerse Career',
          span: 'md:col-span-8',
          preview: cueverseCard,
          window: cueverseWindow,
        },
      ]}
    />
  )

  return (
    <div
      className="pf-root"
      // The player's own colours, scoped to this element and nothing above it.
      style={themeVars(identity.theme) as React.CSSProperties}
    >
      <TableFrame>
        <div className="flex flex-col gap-3 p-3 sm:p-4">
          <IdentityHeader
            identity={identity}
            rank={current?.rank ?? allTime?.rank ?? null}
            rating={current?.rating ?? allTime?.rating ?? null}
            shareUrl={shareUrl}
            canEdit={canEdit}
            onEdit={() => setEditing((v) => !v)}
          />

          {/* Only ever rendered for someone the server has already cleared to edit. */}
          {canEdit && editing && (
            <AppearanceEditor
              playerId={identity.playerId}
              playerName={identity.name}
              onClose={() => setEditing(false)}
            />
          )}

          <ProfileTabs
            tabs={[
              { key: 'overview', label: 'Overview', panel: overview },
              { key: 'matches', label: 'Match History', panel: <MatchHistoryPanel matches={data.matches} /> },
              {
                key: 'h2h',
                label: 'Head to Head',
                panel: (
                  <HeadToHeadPanel
                    rows={data.headToHead}
                    matches={data.matches}
                    selfName={identity.name}
                  />
                ),
              },
            ]}
          />
        </div>
      </TableFrame>
    </div>
  )
}

const recordText = (r: { wins: number; losses: number; draws: number }) =>
  `${r.wins}–${r.losses}${r.draws > 0 ? `–${r.draws}` : ''}`

const streakText = (n: number) => (n === 0 ? '—' : n > 0 ? `W${n}` : `L${Math.abs(n)}`)

function CareerPreview({ data }: { data: PlayerProfilePage }) {
  const c = data.career
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Figure label="Record" value={recordText(c.record)} />
        <Figure label="Win %" value={`${c.winPct.toFixed(1)}%`} />
        <Figure label="Matches" value={String(c.matchesPlayed)} />
        <Figure label="Longest Win Streak" value={c.longestWinStreak > 0 ? `W${c.longestWinStreak}` : '—'} />
        <Figure label="Groups" value={recordText(c.groupRecord)} />
        <Figure label="Playoffs" value={`${c.playoffRecord.wins}–${c.playoffRecord.losses}`} />
      </dl>
      <p className="mt-2 text-xs" style={{ color: 'var(--pf-muted)' }}>
        Every figure is the sum of completed, recorded matches.
      </p>
    </div>
  )
}

function SeasonsPreview({ data }: { data: PlayerProfilePage }) {
  const c = data.career
  const newest = data.seasons.filter((s) => s.participation === 'verified')[0] ?? null
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Figure label="Seasons Played" value={String(c.seasonsPlayed)} />
        <Figure label="Titles" value={String(c.seasonTitles)} />
      </dl>
      {newest && (
        <p className="mt-2 text-xs" style={{ color: 'var(--pf-muted)' }}>
          Most recent: <span style={{ color: 'var(--pf-text)' }}>{newest.name} · {newest.year}</span>
          {newest.record && ` — ${recordText(newest.record)}`}
        </p>
      )}
      {/* Roster-only entries are named separately: being entered is not the same as having a record. */}
      {c.seasonsRostered > 0 && (
        <p className="mt-1 text-xs" style={{ color: 'var(--pf-muted)' }}>
          {c.seasonsRostered} further Season{c.seasonsRostered === 1 ? '' : 's'} on the roster with no
          recorded matches.
        </p>
      )}
    </div>
  )
}

function TournamentsPreview({ data }: { data: PlayerProfilePage }) {
  const c = data.career
  const newest = data.tournaments[0] ?? null
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Figure label="Tournaments" value={String(c.tournamentsPlayed)} />
        <Figure label="Wins" value={String(c.tournamentTitles)} />
      </dl>
      {newest ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--pf-muted)' }}>
          Most recent: <span style={{ color: 'var(--pf-text)' }}>{newest.name}</span>
          {newest.record && ` — ${newest.record.wins}–${newest.record.losses}`}
        </p>
      ) : (
        <p className="mt-2 text-xs" style={{ color: 'var(--pf-muted)' }}>
          No Tournament records for this player.
        </p>
      )}
    </div>
  )
}

function AchievementsPreview({ data }: { data: PlayerProfilePage }) {
  const top = data.achievements.slice(0, 3)
  return (
    <div>
      <p className="pf-figure text-3xl">{data.achievements.length}</p>
      <p className="pf-label mt-0.5">Earned</p>
      <ul className="mt-2 space-y-1">
        {top.map((a) => (
          <li key={a.id} className="truncate text-xs">
            <span className="font-semibold" style={{ color: 'var(--pf-accent)' }}>{a.title}</span>
            <span style={{ color: 'var(--pf-muted)' }}> — {a.caption}</span>
          </li>
        ))}
        {top.length === 0 && (
          <li className="text-xs" style={{ color: 'var(--pf-muted)' }}>None recorded yet.</li>
        )}
      </ul>
    </div>
  )
}

function Figure({ label, value, accent, wide }: {
  label: string
  value: string
  accent?: boolean
  wide?: boolean
}) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2 sm:col-span-3')}>
      <dt className="pf-label truncate">{label}</dt>
      <dd className={cn('pf-figure mt-1', accent && 'pf-figure-accent')}>{value}</dd>
    </div>
  )
}
