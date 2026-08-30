/**
 * Competition and archive data modules.
 *
 * ── The rule every module here obeys ─────────────────────────────────────────────────────────────
 * A module stores WHICH figures to show. It never stores the figures, and it never computes them.
 * Each one calls a canonical service — `getExplorer`, `getSeasonResults`, `seasonChampion`,
 * `getSeasonGroupStage`, `getYahooSummary` — and renders with the site's own components. There is
 * no second calculation anywhere in this file, which is what makes it impossible for the builder to
 * disagree with the record.
 *
 * That also explains why every data option is an enumerated select. Configuration here is a set of
 * ARGUMENTS to an existing function; there is nowhere a query could be typed.
 */

import Link from 'next/link'
import { ArrowRight, Crown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { ModulePlaceholder } from './content'

import { getExplorer } from '@/lib/stats/ladder-explorer'
import { getSeasonResults } from '@/lib/home/season-results'
import { getRegistryStats } from '@/lib/stats/registry-stats'
import { getSeasonView } from '@/lib/seasons/service'
import { getTournamentList } from '@/lib/tournaments/list'
import { getSeasonGroupStage } from '@/lib/seasons/views'
import { seasonChampion, seasonPlayoffRounds } from '@/lib/seasons/playoffs'
import { getSeasonGlance } from '@/lib/seasons/browse'
import { getYahooSummary, getYahooHonorRoll } from '@/lib/yahoo/archive'
import { SeasonGroupsView } from '@/components/seasons/season-presentation'
import { TournamentCard } from '@/components/tournaments/tournament-card'

const PLATFORM_OPTIONS = [
  { value: 'CUEVERSE', label: 'CueVerse' },
  { value: 'YAHOO', label: 'Yahoo archive' },
]

/** A titled frame, so every data panel on a page shares one shape. */
function Panel({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="dl-surface cyber-clip flex h-full flex-col border border-[var(--line-strong)] bg-[var(--graphite)]">
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          {title && <h2 className="eyebrow text-foreground">{title}</h2>}
          {action}
        </header>
      )}
      <div className="flex-1">{children}</div>
    </section>
  )
}

function ViewAll({ href, label = 'View all' }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
      {label} <ArrowRight className="size-3" aria-hidden />
    </Link>
  )
}

// ── Current champion ────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'competitions.currentChampion',
  name: 'Current champion',
  category: 'competitions',
  icon: 'Crown',
  description: 'Whoever holds the most recent completed Season, from the canonical result.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    platform: { kind: 'select', label: 'Platform', default: 'CUEVERSE', options: PLATFORM_OPTIONS },
    title: { kind: 'text', label: 'Panel title', default: 'Current champion', maxLength: 60 },
    emptyText: { kind: 'text', label: 'When nothing is completed', default: 'No completed Season yet.', maxLength: 160 },
  },
  Render: async function CurrentChampionModule({ config }: ModuleRenderProps<{ platform: string; title: string; emptyText: string }>) {
    const results = await getSeasonResults(config.platform as 'CUEVERSE' | 'YAHOO')
    const latest = results?.find((r) => r.winnerHandle || r.winnerName)
    if (!latest) {
      return <Panel title={config.title}><p className="p-4 text-sm text-muted-foreground">{config.emptyText}</p></Panel>
    }
    return (
      <Panel title={config.title} action={<ViewAll href={latest.href} label="Season" />}>
        <div className="flex items-center gap-4 p-4">
          <Crown className="size-8 shrink-0 text-[var(--gold)]" aria-hidden />
          <div className="min-w-0">
            {/* The handle leads, as it does everywhere else on the site; the name follows it. */}
            <p className="truncate font-display text-xl font-black uppercase tracking-tight text-foreground">
              {latest.winnerHandle ?? latest.winnerName}
            </p>
            <p className="text-xs text-muted-foreground">
              {latest.label}
              {/* A forfeited final has no score to show, and printing one would invent a result. */}
              {latest.finalScore && !latest.finalsForfeit ? ` \u00b7 ${latest.finalScore}` : ''}
              {latest.finalsForfeit ? ' \u00b7 won by forfeit' : ''}
              {latest.runnerUpHandle ? ` def. ${latest.runnerUpHandle}` : ''}
            </p>
          </div>
        </div>
      </Panel>
    )
  } as never,
})

// ── Season list ─────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'competitions.seasonList',
  name: 'Season list',
  category: 'competitions',
  icon: 'ListOrdered',
  description: 'Seasons with their champions, newest first.',
  configVersion: 1,
  dataDriven: true,
  ownsScroll: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    platform: { kind: 'select', label: 'Platform', default: 'CUEVERSE', options: PLATFORM_OPTIONS },
    title: { kind: 'text', label: 'Panel title', default: 'Seasons', maxLength: 60 },
    limit: { kind: 'number', label: 'How many', default: 12, min: 1, max: 60 },
    showChampion: { kind: 'boolean', label: 'Show the champion', default: true },
    emptyText: { kind: 'text', label: 'When there is nothing', default: 'No Seasons on this platform yet.', maxLength: 160 },
  },
  Render: async function SeasonListModule({ config }: ModuleRenderProps<{
    platform: string; title: string; limit: number; showChampion: boolean; emptyText: string
  }>) {
    const rows = await getSeasonResults(config.platform as 'CUEVERSE' | 'YAHOO')
    if (!rows?.length) {
      return <Panel title={config.title}><p className="p-4 text-sm text-muted-foreground">{config.emptyText}</p></Panel>
    }
    return (
      <Panel title={config.title} action={<ViewAll href="/seasons" />}>
        <ul className="divide-y divide-border">
          {rows.slice(0, config.limit).map((r) => (
            <li key={r.href}>
              <Link href={r.href} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-[var(--acid-hover)]">
                <span className="min-w-0 truncate text-sm font-semibold text-foreground">{r.label}</span>
                {config.showChampion && (r.winnerHandle || r.winnerName) && (
                  <span className="shrink-0 truncate text-xs text-muted-foreground">{r.winnerHandle ?? r.winnerName}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    )
  } as never,
})

// ── Ranking leaders (a compact table) ───────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.leaders',
  name: 'Ranking leaders',
  category: 'rankings',
  icon: 'Medal',
  description: 'The top of the ladder, from the same engine as the full rankings page.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    platform: { kind: 'select', label: 'Platform', default: 'CUEVERSE', options: PLATFORM_OPTIONS },
    title: { kind: 'text', label: 'Panel title', default: 'Ranking leaders', maxLength: 60 },
    limit: { kind: 'number', label: 'Players shown', default: 10, min: 3, max: 50 },
    showRating: { kind: 'boolean', label: 'Show the rating', default: true },
    showRecord: { kind: 'boolean', label: 'Show the record', default: false },
    emptyText: { kind: 'text', label: 'When there is nothing', default: 'No rated players yet.', maxLength: 160 },
  },
  Render: async function LeadersModule({ config }: ModuleRenderProps<{
    platform: string; title: string; limit: number; showRating: boolean; showRecord: boolean; emptyText: string
  }>) {
    const rows = await getExplorer('all-time', 'overall', { platform: config.platform as 'CUEVERSE' | 'YAHOO' })
    if (!rows.length) {
      return <Panel title={config.title}><p className="p-4 text-sm text-muted-foreground">{config.emptyText}</p></Panel>
    }
    return (
      <Panel title={config.title} action={<ViewAll href={config.platform === 'YAHOO' ? '/yahoo' : '/rankings'} />}>
        <ol className="divide-y divide-border">
          {rows.slice(0, config.limit).map((r, i) => (
            <li key={r.playerId} className="flex items-center gap-3 px-4 py-2">
              <span className="tabular w-6 shrink-0 text-xs font-bold text-muted-foreground">{i + 1}</span>
              <Link href={`/players/${r.slug}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground hover:underline">
                {/* An archive row can have no CueVerse ID; the preferred name is then all there is. */}
                {r.cueverseId ?? r.preferredName ?? 'Unknown'}
                {r.cueverseId && r.preferredName && <span className="ml-2 text-xs font-normal text-muted-foreground">{r.preferredName}</span>}
              </Link>
              {config.showRecord && (
                <span className="tabular shrink-0 text-xs text-muted-foreground">{r.wins}–{r.losses}{r.draws ? `–${r.draws}` : ''}</span>
              )}
              {config.showRating && <span className="tabular shrink-0 text-sm font-bold text-foreground">{r.rating.toLocaleString()}</span>}
            </li>
          ))}
        </ol>
      </Panel>
    )
  } as never,
})

// ── Player spotlight ────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.playerSpotlight',
  name: 'Player spotlight',
  category: 'rankings',
  icon: 'UserRound',
  description: 'One player’s record, read from the ladder rather than typed in.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    cueverseId: { kind: 'text', label: 'CueVerse ID', default: '', maxLength: 60, help: 'Exactly as it appears in the rankings, such as sixohtwo.' },
    platform: { kind: 'select', label: 'Platform', default: 'CUEVERSE', options: PLATFORM_OPTIONS },
    title: { kind: 'text', label: 'Panel title', default: 'Player spotlight', maxLength: 60 },
  },
  Render: async function SpotlightModule({ config }: ModuleRenderProps<{ cueverseId: string; platform: string; title: string }>) {
    if (!config.cueverseId) {
      return <ModulePlaceholder label="Player spotlight" hint="Enter a CueVerse ID in the inspector." />
    }
    const rows = await getExplorer('all-time', 'overall', { platform: config.platform as 'CUEVERSE' | 'YAHOO' })
    const wanted = config.cueverseId.trim().toLowerCase()
    const player = rows.find((r) => (r.cueverseId ?? '').toLowerCase() === wanted)
    if (!player) {
      // Naming the ID that was not found is the difference between "fix the spelling" and "why is
      // this panel empty".
      return (
        <Panel title={config.title}>
          <p className="p-4 text-sm text-muted-foreground">No rated player called “{config.cueverseId}” on this platform.</p>
        </Panel>
      )
    }
    return (
      <Panel title={config.title} action={<ViewAll href={`/players/${player.slug}`} label="Profile" />}>
        <div className="flex flex-col gap-3 p-4">
          <div>
            <p className="font-display text-xl font-black uppercase tracking-tight text-foreground">{player.cueverseId ?? player.preferredName}</p>
            {player.cueverseId && player.preferredName && <p className="text-xs text-muted-foreground">{player.preferredName}</p>}
          </div>
          <dl className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
            {[
              ['Rating', player.rating.toLocaleString()],
              ['Record', `${player.wins}–${player.losses}${player.draws ? `–${player.draws}` : ''}`],
              ['Win %', `${player.matchWinPct.toFixed(1)}%`],
              ['Titles', String(player.seasonTitles)],
            ].map(([label, value]) => (
              <div key={label} className="bg-[var(--graphite)] px-3 py-2">
                <dt className="eyebrow text-muted-foreground">{label}</dt>
                <dd className="tabular mt-0.5 font-display text-lg font-black text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Panel>
    )
  } as never,
})

// ── Tournament list ─────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'competitions.tournamentList',
  name: 'Tournament list',
  category: 'competitions',
  icon: 'Swords',
  description: 'Tournaments as cards, filtered by status.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: {
    title: { kind: 'text', label: 'Panel title', default: 'Tournaments', maxLength: 60 },
    status: {
      kind: 'select', label: 'Which tournaments', default: 'all',
      options: [
        { value: 'all', label: 'All' }, { value: 'live', label: 'Active and upcoming' }, { value: 'complete', label: 'Completed' },
      ],
    },
    limit: { kind: 'number', label: 'How many', default: 6, min: 1, max: 24 },
    emptyText: { kind: 'text', label: 'When there is nothing', default: 'No tournaments to show.', maxLength: 160 },
  },
  Render: async function TournamentListModule({ config }: ModuleRenderProps<{
    title: string; status: string; limit: number; emptyText: string
  }>) {
    const all = await getTournamentList()
    const filtered = config.status === 'all'
      ? all
      : all.filter((t) => (config.status === 'live' ? t.status !== 'complete' : t.status === 'complete'))
    if (!filtered.length) {
      return <Panel title={config.title}><p className="p-4 text-sm text-muted-foreground">{config.emptyText}</p></Panel>
    }
    return (
      <section aria-label={config.title} className="flex flex-col gap-3">
        {config.title && <h2 className="eyebrow text-foreground">{config.title}</h2>}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' }}>
          {filtered.slice(0, config.limit).map((t) => <TournamentCard key={t.number} cup={t as never} />)}
        </div>
      </section>
    )
  } as never,
})

// ── Group standings for one Season ──────────────────────────────────────────────────────────────

registerModule({
  type: 'seasons.groupStandings',
  name: 'Group standings',
  category: 'seasons',
  icon: 'Table',
  description: 'The group tables for a Season, exactly as the Season page draws them.',
  configVersion: 1,
  dataDriven: true,
  ownsScroll: true,
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: {
    seasonId: { kind: 'number', label: 'Season id', default: 0, min: 0, max: 999999, help: 'Zero uses the Season this page is about, on a Season template.' },
    title: { kind: 'text', label: 'Panel title', default: '', maxLength: 60 },
    emptyText: { kind: 'text', label: 'When the groups are not published', default: 'The groups have not been published yet.', maxLength: 200 },
  },
  Render: async function GroupStandingsModule({ config, context }: ModuleRenderProps<{
    seasonId: number; title: string; emptyText: string
  }>) {
    // Zero means "whichever Season this page is about", which is what makes the module usable on the
    // Season template as well as pinned to one Season on a static page.
    const id = config.seasonId || context.seasonId || Number(context.routeParams?.seasonId) || 0
    if (!id) return <ModulePlaceholder label="Group standings" hint="Set a Season id, or place this on the Season template." />
    const [groups, view] = await Promise.all([getSeasonGroupStage(id), getSeasonView(id)])
    const qualified = new Set<number>(
      groups.flatMap((g) => g.standings.filter((r) => r.qualified).map((r) => r.entrantId)),
    )
    if (!groups.length) {
      return (
        <section className="cyber-clip border border-border p-4">
          {config.title && <h2 className="eyebrow mb-2 text-foreground">{config.title}</h2>}
          <p className="text-sm text-muted-foreground">{config.emptyText}</p>
        </section>
      )
    }
    return (
      <section aria-label={config.title || 'Group standings'} className="flex flex-col gap-3">
        {config.title && <h2 className="eyebrow text-foreground">{config.title}</h2>}
        {/*
          The Season's own view component, given the same props the Season page gives it. The games
          per match and the qualified set come from the Season record rather than being recomputed
          here -- this module decides WHERE the tables appear, never what is in them.
        */}
        <SeasonGroupsView
          groups={groups}
          groupStageGames={view?.format.groupStageGames ?? 0}
          qualified={qualified}
          state={(view?.lifecycleState ?? 'COMPLETED') as never}
        />
      </section>
    )
  } as never,
})

// ── Season at a glance ──────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'seasons.glance',
  name: 'Season at a glance',
  category: 'seasons',
  icon: 'Gauge',
  description: 'Entrants, groups, matches and games per match for one Season.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true },
  fields: {
    seasonId: { kind: 'number', label: 'Season id', default: 0, min: 0, max: 999999, help: 'Zero uses the Season this page is about.' },
    title: { kind: 'text', label: 'Panel title', default: 'Season at a glance', maxLength: 60 },
  },
  Render: async function GlanceModule({ config, context }: ModuleRenderProps<{ seasonId: number; title: string }>) {
    const id = config.seasonId || context.seasonId || Number(context.routeParams?.seasonId) || 0
    if (!id) return <ModulePlaceholder label="Season at a glance" hint="Set a Season id, or place this on the Season template." />
    // The Season supplies its own games-per-match; the glance counts everything else from rows.
    const view = await getSeasonView(id)
    if (!view) return <ModulePlaceholder label="Season at a glance" hint={`No Season ${id}.`} />
    const glance = await getSeasonGlance(id, view.format.groupStageGames)
    const items: [string, string][] = [
      ['Entrants', String(glance.entrants)],
      ['Groups', String(glance.groups)],
      ['Games per match', String(glance.gamesPerMatch)],
      ['Total matches', String(glance.totalMatches)],
    ]
    return (
      <section aria-label={config.title}>
        {config.title && <p className="eyebrow mb-2 text-muted-foreground">{config.title}</p>}
        <dl className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
          {items.map(([label, value]) => (
            <div key={label} className="bg-[var(--graphite)] px-3 py-2.5">
              <dt className="eyebrow text-muted-foreground">{label}</dt>
              <dd className="tabular mt-0.5 font-display text-xl font-black text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    )
  } as never,
})

// ── Champion card for one Season ────────────────────────────────────────────────────────────────

registerModule({
  type: 'seasons.championCard',
  name: 'Season champion card',
  category: 'seasons',
  icon: 'Trophy',
  description: 'The winner of one Season, with the final score.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true },
  fields: {
    seasonId: { kind: 'number', label: 'Season id', default: 0, min: 0, max: 999999, help: 'Zero uses the Season this page is about.' },
    emptyText: { kind: 'text', label: 'Before it is decided', default: 'A champion appears here once the final is decided.', maxLength: 200 },
  },
  Render: async function ChampionCardModule({ config, context }: ModuleRenderProps<{ seasonId: number; emptyText: string }>) {
    const id = config.seasonId || context.seasonId || Number(context.routeParams?.seasonId) || 0
    if (!id) return <ModulePlaceholder label="Season champion" hint="Set a Season id, or place this on the Season template." />
    const champ = await seasonChampion(id)
    if (!champ?.championName) {
      return <div className="cyber-clip border border-border p-4 text-sm text-muted-foreground">{config.emptyText}</div>
    }
    return (
      <div className="cyber-clip flex items-center gap-4 border border-[var(--gold)] bg-[var(--graphite)] p-4">
        <Crown className="size-8 shrink-0 text-[var(--gold)]" aria-hidden />
        <div className="min-w-0">
          <p className="eyebrow text-muted-foreground">Season champion</p>
          <p className="truncate font-display text-2xl font-black uppercase tracking-tight text-foreground">
            {champ.championCueverseId ?? champ.championName}
          </p>
          {champ.finalScore && (
            <p className="text-xs text-muted-foreground">
              {champ.finalScore}
              {champ.runnerUpCueverseId ?? champ.runnerUpName ? ` def. ${champ.runnerUpCueverseId ?? champ.runnerUpName}` : ''}
            </p>
          )}
        </div>
      </div>
    )
  } as never,
})

// ── Playoff bracket for one Season ──────────────────────────────────────────────────────────────

registerModule({
  type: 'seasons.playoffSummary',
  name: 'Playoff summary',
  category: 'seasons',
  icon: 'GitBranch',
  description: 'Rounds, matches played and the final result for a Season’s playoffs.',
  configVersion: 1,
  dataDriven: true,
  a11y: { landmark: true },
  fields: {
    seasonId: { kind: 'number', label: 'Season id', default: 0, min: 0, max: 999999, help: 'Zero uses the Season this page is about.' },
    title: { kind: 'text', label: 'Panel title', default: 'Playoffs', maxLength: 60 },
    emptyText: { kind: 'text', label: 'Before the playoffs start', default: 'The playoffs have not started yet.', maxLength: 200 },
    showLink: { kind: 'boolean', label: 'Link to the full bracket', default: true },
  },
  Render: async function PlayoffSummaryModule({ config, context }: ModuleRenderProps<{
    seasonId: number; title: string; emptyText: string; showLink: boolean
  }>) {
    const id = config.seasonId || context.seasonId || Number(context.routeParams?.seasonId) || 0
    if (!id) return <ModulePlaceholder label="Playoff summary" hint="Set a Season id, or place this on the Season template." />
    const rounds = await seasonPlayoffRounds(id)
    const matches = rounds?.reduce((n, r) => n + (r.matches?.length ?? 0), 0) ?? 0
    if (!matches) {
      return <Panel title={config.title}><p className="p-4 text-sm text-muted-foreground">{config.emptyText}</p></Panel>
    }
    // "Played" means a decided tie. A bracket row exists for every slot including byes, so
    // counting rows would report a playoff as complete before anybody had played.
    const played = rounds.reduce((n, r) => n + (r.matches?.filter((m) => m.winner != null).length ?? 0), 0)
    return (
      <Panel
        title={config.title}
        action={config.showLink ? <ViewAll href={`/seasons/${id}?view=playoffs`} label="Full bracket" /> : undefined}
      >
        <dl className="grid grid-cols-3 gap-px border-t border-border bg-border">
          {[['Rounds', String(rounds.length)], ['Matches', String(matches)], ['Played', String(played)]].map(([label, value]) => (
            <div key={label} className="bg-[var(--graphite)] px-3 py-2.5 text-center">
              <dt className="eyebrow text-muted-foreground">{label}</dt>
              <dd className="tabular mt-0.5 font-display text-xl font-black text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    )
  } as never,
})

// ── Archive statistics ──────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'competitions.archiveStats',
  name: 'Archive statistics',
  category: 'competitions',
  icon: 'Database',
  description: 'Registry-wide totals: players, matches and Seasons on record.',
  configVersion: 1,
  dataDriven: true,
  a11y: {},
  layoutDefaults: { span: 12 },
  fields: {
    title: { kind: 'text', label: 'Panel title', default: '', maxLength: 60 },
    showPlayers: { kind: 'boolean', label: 'Players', default: true },
    showMatches: { kind: 'boolean', label: 'Matches recorded', default: true },
    showSeasons: { kind: 'boolean', label: 'Seasons', default: true },
  },
  Render: async function ArchiveStatsModule({ config }: ModuleRenderProps<{
    title: string; showPlayers: boolean; showMatches: boolean; showSeasons: boolean
  }>) {
    const stats = await getRegistryStats()
    const items: [string, number][] = []
    if (config.showPlayers) items.push(['Players', stats.players])
    if (config.showMatches) items.push(['Matches recorded', stats.matchesPlayed])
    if (config.showSeasons) items.push(['Seasons', stats.seasons])
    if (!items.length) return <ModulePlaceholder label="Archive statistics" hint="Turn on at least one figure." />
    return (
      <section>
        {config.title && <p className="eyebrow mb-2 text-muted-foreground">{config.title}</p>}
        <dl className="grid gap-px border border-border bg-border" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map(([label, value]) => (
            <div key={label} className="bg-[var(--graphite)] px-3 py-2.5">
              <dt className="eyebrow text-muted-foreground">{label}</dt>
              <dd className="tabular mt-0.5 font-display text-xl font-black text-foreground">{value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </section>
    )
  } as never,
})

// ── Yahoo honour roll ───────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.yahooHonourRoll',
  name: 'Yahoo honour roll',
  category: 'rankings',
  icon: 'ScrollText',
  description: 'Champions of the Yahoo era, from the archive.',
  configVersion: 1,
  dataDriven: true,
  ownsScroll: true,
  a11y: { landmark: true, headingLevel: 2 },
  fields: {
    title: { kind: 'text', label: 'Panel title', default: 'Honour roll', maxLength: 60 },
    limit: { kind: 'number', label: 'How many', default: 15, min: 1, max: 60 },
  },
  Render: async function HonourRollModule({ config }: ModuleRenderProps<{ title: string; limit: number }>) {
    const roll = await getYahooHonorRoll()
    if (!roll?.length) {
      return <Panel title={config.title}><p className="p-4 text-sm text-muted-foreground">The archive has no champions recorded.</p></Panel>
    }
    return (
      <Panel title={config.title} action={<ViewAll href="/yahoo" label="Archive" />}>
        <ol className="divide-y divide-border">
          {roll.slice(0, config.limit).map((entry, i) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0 truncate text-sm text-muted-foreground">{entry.year} \u00b7 {entry.title}</span>
              <span className="shrink-0 truncate text-sm font-semibold text-foreground">{entry.champion ?? '\u2014'}</span>
            </li>
          ))}
        </ol>
      </Panel>
    )
  } as never,
})

// ── Yahoo archive summary ───────────────────────────────────────────────────────────────────────

registerModule({
  type: 'rankings.yahooSummary',
  name: 'Yahoo archive summary',
  category: 'rankings',
  icon: 'Archive',
  description: 'Seasons, players, matches and unique champions across the archive.',
  configVersion: 1,
  dataDriven: true,
  a11y: {},
  layoutDefaults: { span: 12 },
  fields: {
    title: { kind: 'text', label: 'Panel title', default: '', maxLength: 60 },
  },
  Render: async function YahooSummaryModule({ config }: ModuleRenderProps<{ title: string }>) {
    const summary = await getYahooSummary()
    if (!summary) return <ModulePlaceholder label="Yahoo archive summary" hint="The archive has no data." />
    const items: [string, number, string?][] = [
      ['Seasons', summary.seasons],
      ['Players', summary.players],
      ['Matches', summary.matches],
      ['Unique champions', summary.distinctChampions, `${summary.distinctChampions} different people won the archive\u2019s Seasons.`],
    ]
    return (
      <section>
        {config.title && <p className="eyebrow mb-2 text-muted-foreground">{config.title}</p>}
        <dl className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
          {items.map(([label, value, title]) => (
            <div key={label} className="bg-card px-3 py-2.5" title={title}>
              <dt className="eyebrow text-muted-foreground">{label}</dt>
              <dd className="tabular mt-0.5 font-display text-xl font-black text-foreground">{Number(value).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </section>
    )
  } as never,
})

// ── Seasons this competition has run ────────────────────────────────────────────────────────────

registerModule({
  type: 'competitions.seasonNavigation',
  name: 'Season navigation',
  category: 'seasons',
  icon: 'ArrowLeftRight',
  description: 'Links to every Season of a competition, for jumping between them.',
  configVersion: 1,
  dataDriven: true,
  a11y: { requiresLabel: true },
  layoutDefaults: { span: 12 },
  fields: {
    platform: { kind: 'select', label: 'Platform', default: 'CUEVERSE', options: PLATFORM_OPTIONS },
    label: { kind: 'text', label: 'Accessible name', default: 'Seasons', maxLength: 60 },
    limit: { kind: 'number', label: 'How many', default: 20, min: 1, max: 60 },
  },
  Render: async function SeasonNavModule({ config, context }: ModuleRenderProps<{ platform: string; label: string; limit: number }>) {
    /*
      `getSeasonResults` rather than `listSeasons`.

      A SeasonSummary carries neither an id nor a platform, so it cannot build a link or be filtered
      by era -- and inventing either here would mean deriving something the service deliberately does
      not expose. The results service already returns both, and is the same one the other Season
      panels read, so they cannot disagree about which Seasons exist.
    */
    const seasons = await getSeasonResults(config.platform as 'CUEVERSE' | 'YAHOO')
    if (!seasons.length) return <ModulePlaceholder label="Season navigation" hint="No Seasons on this platform." />
    const current = context.seasonId ?? Number(context.routeParams?.seasonId ?? 0)
    return (
      <nav aria-label={config.label} className="flex flex-wrap gap-1">
        {seasons.slice(0, config.limit).map((s) => (
          <Link
            key={s.seasonId}
            href={s.href}
            aria-current={s.seasonId === current ? 'page' : undefined}
            className={cn(
              'border px-2 py-1 text-[11px] font-bold uppercase tracking-[0.1em] transition',
              s.seasonId === current
                ? 'border-[var(--hot-red)] text-foreground'
                : 'border-border text-muted-foreground hover:border-[var(--line-strong)] hover:text-foreground',
            )}
          >
            {`S${s.number}`}
          </Link>
        ))}
      </nav>
    )
  } as never,
})
