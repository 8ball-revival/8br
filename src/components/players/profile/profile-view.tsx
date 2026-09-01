'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { PlayerProfilePage } from '@/lib/players/profile'
import { ProfileSidebar } from './profile-sidebar'
import { ProfileTabs } from './profile-tabs'
import { ExpandingCards } from './expanding-cards'
import { SeasonsWindow } from './seasons-window'
import { TournamentsWindow } from './tournaments-window'
import { AchievementsWindow, HeadToHeadPanel, MatchHistoryPanel } from './tab-panels'
import { cn } from '@/lib/utils'

/**
 * The whole profile: sidebar, tabs and the expanding Overview cards.
 *
 * ── Why this component owns the selections ──────────────────────────────────────────────────────
 * An expanded window unmounts when it closes, which is what keeps a closed window free. The chosen
 * Season or Tournament would go with it, so somebody comparing two Seasons would land back on the
 * newest one every time they reopened. Holding the selection here — one level above the thing that
 * unmounts — is what makes reopening return to where they were.
 *
 * ── CueVerse arrives as a node, not as data ─────────────────────────────────────────────────────
 * `cueverseCard` and `cueverseWindow` are rendered on the server and passed in. That lets the
 * CueVerse fetch stream in its own Suspense boundary while the 8 Ball Registry record — which comes
 * from our own database and is always fast — renders immediately. A slow third party cannot hold up
 * a page about somebody's career.
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

  // Retained across open/close of the windows. See the note above.
  const [seasonId, setSeasonId] = useState<number | null>(seasons[0]?.seasonId ?? null)
  const [tournamentId, setTournamentId] = useState<number | null>(tournaments[0]?.tournamentId ?? null)

  const overview = (
    <div className="space-y-4">
      <RankSummary current={current} allTime={allTime} />
      <ExpandingCards
        cards={[
          {
            key: 'career',
            title: '8 Ball Registry Career',
            actionLabel: 'View Matches',
            preview: <CareerPreview data={data} />,
            window: <div className="p-3"><MatchHistoryPanel matches={data.matches} /></div>,
            disabled: data.matches.length === 0,
          },
          {
            key: 'seasons',
            title: 'Seasons',
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
            preview: <AchievementsPreview data={data} />,
            window: <AchievementsWindow achievements={achievements} />,
            disabled: achievements.length === 0,
          },
          {
            key: 'cueverse',
            title: 'CueVerse Career',
            preview: cueverseCard,
            window: cueverseWindow,
          },
        ]}
      />
    </div>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ProfileSidebar
        playerId={identity.playerId}
        handle={identity.name}
        displayName={identity.displayName}
        shareUrl={shareUrl}
        canEdit={canEdit}
        stats={{
          rank: current?.rank ?? allTime?.rank ?? null,
          rating: current?.rating ?? allTime?.rating ?? null,
          wins: career.record.wins,
          losses: career.record.losses,
          draws: career.record.draws,
          winPct: career.winPct,
          streak: career.currentStreak,
          longestWinStreak: career.longestWinStreak,
        }}
      />

      <div className="min-w-0">
        <ProfileTabs
          tabs={[
            { key: 'overview', label: 'Overview', panel: overview },
            { key: 'matches', label: 'Match History', panel: <MatchHistoryPanel matches={data.matches} /> },
            { key: 'h2h', label: 'Head to Head', panel: <HeadToHeadPanel rows={data.headToHead} /> },
          ]}
        />
      </div>
    </div>
  )
}

/** Current and all-time rank and rating, side by side — they are different questions. */
function RankSummary({
  current, allTime,
}: {
  current: PlayerProfilePage['current']
  allTime: PlayerProfilePage['allTime']
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="dl-surface border border-border bg-card p-4">
        <h3 className="eyebrow text-foreground">Current (last 365 days)</h3>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <Cell label="Rank" value={current ? `#${current.rank}` : '—'} />
          <Cell label="Rating" value={current ? String(current.rating) : '—'} accent />
        </dl>
        {!current && (
          <p className="mt-2 text-xs text-muted-foreground">
            No matches inside the current window, so there is no current rank.
          </p>
        )}
      </div>
      <div className="dl-surface border border-border bg-card p-4">
        <h3 className="eyebrow text-foreground">All-time</h3>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <Cell label="Rank" value={allTime ? `#${allTime.rank}` : '—'} />
          <Cell label="Rating" value={allTime ? String(allTime.rating) : '—'} accent />
          <Cell label="Highest rank" value={allTime?.highestRank ? `#${allTime.highestRank}` : '—'} />
          <Cell label="Highest rating" value={allTime?.highestRating ? String(allTime.highestRating) : '—'} />
        </dl>
      </div>
    </div>
  )
}

function CareerPreview({ data }: { data: PlayerProfilePage }) {
  const c = data.career
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3">
        <Cell label="Record" value={`${c.record.wins}–${c.record.losses}${c.record.draws ? `–${c.record.draws}` : ''}`} />
        <Cell label="Win %" value={`${c.winPct.toFixed(1)}%`} />
        <Cell label="Matches" value={String(c.matchesPlayed)} />
        <Cell label="Longest win streak" value={c.longestWinStreak > 0 ? `W${c.longestWinStreak}` : '—'} />
        <Cell label="Group" value={`${c.groupRecord.wins}–${c.groupRecord.losses}${c.groupRecord.draws ? `–${c.groupRecord.draws}` : ''}`} />
        <Cell label="Playoffs" value={`${c.playoffRecord.wins}–${c.playoffRecord.losses}`} />
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
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
      <dl className="grid grid-cols-2 gap-3">
        <Cell label="Seasons played" value={String(c.seasonsPlayed)} />
        <Cell label="Titles" value={String(c.seasonTitles)} />
      </dl>
      {newest && (
        <p className="mt-2 text-xs text-muted-foreground">
          Most recent: <span className="text-foreground">{newest.name} · {newest.year}</span>
          {newest.record && ` — ${newest.record.wins}–${newest.record.losses}${newest.record.draws ? `–${newest.record.draws}` : ''}`}
        </p>
      )}
      {/*
        Roster-only entries are counted separately and named as such, rather than folded into
        "seasons played" — being on a roster is not the same as having a record.
      */}
      {c.seasonsRostered > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
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
      <dl className="grid grid-cols-2 gap-3">
        <Cell label="Tournaments" value={String(c.tournamentsPlayed)} />
        <Cell label="Wins" value={String(c.tournamentTitles)} />
      </dl>
      {newest ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Most recent: <span className="text-foreground">{newest.name}</span>
          {newest.record && ` — ${newest.record.wins}–${newest.record.losses}`}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No Tournament records for this player.</p>
      )}
    </div>
  )
}

function AchievementsPreview({ data }: { data: PlayerProfilePage }) {
  const top = data.achievements.slice(0, 3)
  return (
    <div>
      <p className="font-display text-2xl font-bold text-foreground">{data.achievements.length}</p>
      <p className="text-[0.62rem] uppercase tracking-wider text-muted-foreground">Earned</p>
      <ul className="mt-2 space-y-1">
        {top.map((a) => (
          <li key={a.id} className="truncate text-xs">
            <span className="font-semibold text-[var(--gold)]">{a.title}</span>
            <span className="text-muted-foreground"> — {a.caption}</span>
          </li>
        ))}
        {top.length === 0 && <li className="text-xs text-muted-foreground">None recorded yet.</li>}
      </ul>
    </div>
  )
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[0.62rem] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn('font-display text-lg font-bold', accent ? 'text-[var(--gold)]' : 'text-foreground')}>{value}</dd>
    </div>
  )
}

/** Kept for the profile's own "back to rankings" affordance without touching the tabs. */
export function BackToRankings() {
  return (
    <Link href="/rankings" className="text-sm text-muted-foreground hover:text-brand">
      ← Rankings
    </Link>
  )
}
