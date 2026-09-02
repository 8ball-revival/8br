'use client'

import { useRef, useState } from 'react'
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
import {
  CountUp, useDecorativeMotion, useEntrance, usePointerSpotlight, usePrefersReducedMotion,
} from './motion'
import { Award, CalendarDays, Circle, Crosshair, Star, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The stagger, as an inline custom property.
 *
 * Each revealed section declares its own delay and the stylesheet does the rest, so the entrance is
 * one class toggle on the root rather than a timer per panel.
 */
const delay = (ms: number) => ({ ['--pf-delay']: `${ms}ms` } as React.CSSProperties)

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
    Motion, wired once at the root.

    The entrance is a class; the cursor-following light is one listener on this element that writes
    CSS variables inside a frame. Neither costs a render, and both stop themselves when the visitor
    has asked for reduced motion.
  */
  const rootRef = useRef<HTMLDivElement>(null)
  const entered = useEntrance()
  const reduced = usePrefersReducedMotion()
  usePointerSpotlight(rootRef, !reduced)
  /*
    One switch for every continuous decoration on the profile.

    The frame gates itself, but the avatar ring is CSS with nothing to gate it — so it kept spinning
    behind a hidden tab while the rail had stopped. `pf-motion` is the same three-part answer
    (reduced motion, tab visible, profile on screen) applied at the root, so all of it starts and
    stops together.
  */
  const motion = useDecorativeMotion(rootRef)

  /*
    The first data row: Current Performance, then All-Time beside it.

    Not equal halves. "How good are they now" is the question most readers arrive with, so Current
    Performance is wider, carries the accent border and holds the two largest figures on the page;
    All-Time sits next to it as the reference point, deliberately narrower and quieter.

    Passed to `ExpandingCards` as `before` rather than rendered beside it, so an expanded window
    covers the whole Overview area — the profile opening up, rather than its lower half.
  */
  const summaryRow = (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
      <section className="pf-panel pf-panel-current pf-reveal md:col-span-7" style={delay(60)}>
        <h3 className="pf-heading pf-heading-accent">
          <Crosshair className="pf-heading-icon" aria-hidden />
          Current Performance
          <span className="pf-heading-note">(Last 365 days)</span>
        </h3>
        {/*
          Rank and rating are the headline pair and are sized accordingly; the rest are supporting
          figures at the normal scale. The accent marks PLACE — spending it on every number would
          make none of them stand out.
        */}
        <dl className="pf-stat-row mt-3">
          <Figure label="Rank" count={current?.rank ?? null} prefix="#" size="xl" accent />
          <Figure label="Rating" count={current?.rating ?? null} size="xl" />
          <Figure label="Record" text={recordText(career.record)} />
          <Figure label="Win %" text={`${career.winPct.toFixed(1)}%`} />
          <Figure label="Streak" text={streakText(career.currentStreak)} />
          <Figure label="Longest Win Streak" text={career.longestWinStreak > 0 ? `W${career.longestWinStreak}` : '—'} />
        </dl>
        {!current && (
          <p className="pf-note mt-2">
            No matches inside the current window, so there is no current rank.
          </p>
        )}
      </section>

      <section className="pf-panel pf-reveal md:col-span-5" style={delay(120)}>
        <h3 className="pf-heading">
          <Trophy className="pf-heading-icon" aria-hidden />
          All-Time
        </h3>
        <dl className="pf-stat-row mt-3">
          <Figure label="Rank" count={allTime?.rank ?? null} prefix="#" accent />
          <Figure label="Rating" count={allTime?.rating ?? null} />
          <Figure label="Highest Rank" count={allTime?.highestRank || null} prefix="#" accent />
          <Figure label="Highest Rating" count={allTime?.highestRating || null} />
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
          icon: <Circle className="pf-heading-icon" aria-hidden />,
          delay: 180,
          preview: <CareerPreview data={data} />,
          window: <div className="p-3"><MatchHistoryPanel matches={data.matches} /></div>,
          disabled: data.matches.length === 0,
        },
        {
          key: 'seasons',
          title: 'Seasons',
          span: 'md:col-span-3',
          icon: <CalendarDays className="pf-heading-icon" aria-hidden />,
          delay: 220,
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
          icon: <Trophy className="pf-heading-icon" aria-hidden />,
          delay: 260,
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
          icon: <Star className="pf-heading-icon" aria-hidden />,
          tone: 'gold' as const,
          delay: 300,
          preview: <AchievementsPreview data={data} />,
          window: <AchievementsWindow achievements={achievements} />,
          disabled: achievements.length === 0,
        },
        {
          key: 'cueverse',
          title: 'CueVerse Career',
          span: 'md:col-span-8',
          icon: <Award className="pf-heading-icon" aria-hidden />,
          tone: 'cueverse' as const,
          delay: 340,
          preview: cueverseCard,
          window: cueverseWindow,
        },
      ]}
    />
  )

  return (
    <div
      ref={rootRef}
      className={cn('pf-root', entered, motion && 'pf-motion')}
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

/*
  Career shows what only Career knows.

  Record and win percentage used to appear here as well as under Current Performance, a few inches
  apart and identical. Repeating a figure does not reinforce it — it makes a reader stop to check
  whether the two are really the same number. The underlying data is untouched: Match History and
  every export still carry all of it.
*/
function CareerPreview({ data }: { data: PlayerProfilePage }) {
  const c = data.career
  return (
    <div>
      <dl className="pf-stat-row">
        <Figure label="Matches" count={c.matchesPlayed} />
        <Figure label="Groups" text={recordText(c.groupRecord)} />
        <Figure label="Playoffs" text={c.playoffRecord.wins + '–' + c.playoffRecord.losses} />
        <Figure label="Longest Win Streak" text={c.longestWinStreak > 0 ? 'W' + c.longestWinStreak : '—'} />
      </dl>
      <p className="pf-note mt-2">Every figure is the sum of completed, recorded matches.</p>
    </div>
  )
}

function SeasonsPreview({ data }: { data: PlayerProfilePage }) {
  const c = data.career
  const newest = data.seasons.filter((s) => s.participation === 'verified')[0] ?? null
  return (
    <div>
      <dl className="pf-stat-row">
        <Figure label="Seasons Played" count={c.seasonsPlayed} />
        <Figure label="Titles" count={c.seasonTitles} />
      </dl>
      {newest && (
        <p className="pf-note mt-2">
          Most recent: <span className="pf-note-strong">{newest.name} · {newest.year}</span>
          {newest.record && ' — ' + recordText(newest.record)}
        </p>
      )}
      {/* Roster-only entries are named separately: being entered is not the same as having a record. */}
      {c.seasonsRostered > 0 && (
        <p className="pf-note mt-1">
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
      <dl className="pf-stat-row">
        <Figure label="Tournaments" count={c.tournamentsPlayed} />
        <Figure label="Wins" count={c.tournamentTitles} />
      </dl>
      {newest ? (
        <p className="pf-note mt-2">
          Most recent: <span className="pf-note-strong">{newest.name}</span>
          {newest.record && ' — ' + newest.record.wins + '–' + newest.record.losses}
        </p>
      ) : (
        <p className="pf-note mt-2">No Tournament records for this player.</p>
      )}
    </div>
  )
}

/*
  Achievements leads with the count and gives the names room.

  The earned figure is the headline; the awards beside it are the reason for it. They were a cramped
  truncated list against the left edge, which read as a footnote to a number rather than as the
  thing the number counts.
*/
function AchievementsPreview({ data }: { data: PlayerProfilePage }) {
  const top = data.achievements.slice(0, 3)
  return (
    <div className="flex gap-5">
      <div className="shrink-0 text-center">
        <p className="pf-figure pf-figure-gold text-4xl leading-none">{data.achievements.length}</p>
        <p className="pf-label mt-1">Earned</p>
      </div>
      <ul className="min-w-0 flex-1 space-y-2 border-l pl-5 pf-rule">
        {top.map((a) => (
          <li key={a.id} className="min-w-0 text-xs leading-relaxed">
            <span className="pf-award-name">{a.title}</span>
            <span className="pf-note"> — {a.caption}</span>
          </li>
        ))}
        {top.length === 0 && <li className="pf-note text-xs">None recorded yet.</li>}
      </ul>
    </div>
  )
}

/**
 * One figure in a stat row.
 *
 * `count` animates up on first paint and always renders its true value in the DOM; `text` is for
 * anything that is not a plain number — a record, a percentage, a streak — where counting up would
 * be meaningless. Exactly one of them is given.
 */
function Figure({ label, count, text, prefix, accent, size }: {
  label: string
  count?: number | null
  text?: string
  prefix?: string
  accent?: boolean
  size?: 'xl'
}) {
  const cls = cn('pf-figure mt-1', accent && 'pf-figure-accent', size === 'xl' && 'pf-figure-xl')
  return (
    <div className="pf-stat min-w-0">
      <dt className="pf-label">{label}</dt>
      <dd className={cls}>
        {count != null
          ? <CountUp value={count} prefix={prefix ?? ''} />
          : (text ?? '—')}
      </dd>
    </div>
  )
}
