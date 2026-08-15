import type { Metadata } from 'next'
import Link from 'next/link'

import { Wide } from '@/components/primitives'
import { getTournamentList } from '@/lib/tournaments/list'
import { tournamentStore, loadTournamentContext } from '@/lib/tournaments/prime'
import { listSeasons, getSeasonView } from '@/lib/seasons/service'
import { SEASON_STATE_LABEL, type SeasonState } from '@/lib/seasons/shared'
import { pageMetadata, brandName } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: brandName,
  description:
    'World Cue Championships (WCC) — the home of competitive cue sports. Enter the active Season, follow live brackets and standings, and climb the rankings.',
  path: '/',
})

/** State-driven headline for the featured Season hero. */
function heroHeadline(state: SeasonState): string {
  switch (state) {
    case 'REGISTRATION_OPEN':
      return 'Registration Now Open'
    case 'REGISTRATION_SCHEDULED':
      return 'Registration Opening Soon'
    case 'REGISTRATION_CLOSED':
      return 'Registration Closed'
    case 'GROUP_SETUP':
    case 'GROUP_STAGE_LIVE':
      return 'Group Stage Underway'
    case 'GROUPS_CLOSED':
    case 'PLAYOFF_SETUP':
    case 'PLAYOFFS_LIVE':
      return 'Playoffs Underway'
    default:
      return 'Season Underway'
  }
}

export default async function HomePage() {
  // Resolve the live tournament revision before any tournament-derived render.
  tournamentStore.enterWith(await loadTournamentContext())

  const [seasons, tournaments] = await Promise.all([listSeasons(), getTournamentList()])

  // Feature the most recent still-running Season (list is desc by number).
  const activeSummary = seasons.find((s) => s.isActive) ?? null
  const completed = seasons.filter((s) => s.isCompleted)

  // Top 10 Season Champions — ranked by number of Season titles won (ties: most recent, then name).
  const winMap = new Map<string, { name: string; titles: number; latest: number }>()
  for (const s of completed) {
    const name = s.championName?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const cur = winMap.get(key)
    if (cur) {
      cur.titles += 1
      cur.latest = Math.max(cur.latest, s.number)
    } else {
      winMap.set(key, { name, titles: 1, latest: s.number })
    }
  }
  const topWinners = [...winMap.values()]
    .sort((a, b) => b.titles - a.titles || b.latest - a.latest || a.name.localeCompare(b.name))
    .slice(0, 10)

  // Entrants of the featured Season (active roster only).
  const activeView = activeSummary ? await getSeasonView(activeSummary.number) : null
  const entrants = (activeView?.entrants ?? []).filter((e) => !e.withdrawn && !e.kickedOut)
  const regOpen = activeSummary?.lifecycleState === 'REGISTRATION_OPEN'

  const live = tournaments.filter((t) => t.status === 'live')
  const recent = tournaments.filter((t) => t.status === 'completed').slice(-6).reverse()
  const featured = [...live, ...recent].slice(0, 6)

  const primaryBtn =
    'inline-flex items-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  const secondaryBtn =
    'inline-flex items-center rounded-md border border-border px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <>
      {/* Hero: featured Season (left) + entrants (right) */}
      <section className="border-b border-border">
        <Wide className="py-8 lg:py-12">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Featured Season */}
            <div className="lg:col-span-2">
              <div className="relative flex h-full min-h-[340px] flex-col justify-end overflow-hidden rounded-xl border border-border bg-card p-8 lg:p-10">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/20 blur-3xl"
                />
                {activeSummary ? (
                  <div className="relative">
                    <p className="eyebrow text-primary">{activeSummary.title}</p>
                    <h1 className="mt-3 max-w-2xl text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl">
                      {heroHeadline(activeSummary.lifecycleState)}
                    </h1>
                    {activeSummary.subtitle ? (
                      <p className="mt-4 text-lg text-foreground">{activeSummary.subtitle}</p>
                    ) : null}
                    <p className="mt-3 max-w-xl text-muted-foreground">
                      {regOpen
                        ? 'Compete against the best. Chase the title. Make history.'
                        : `Group stage → playoffs · ${SEASON_STATE_LABEL[activeSummary.lifecycleState]}`}
                    </p>
                    <div className="mt-7 flex flex-wrap gap-3">
                      <Link href={`/seasons/${activeSummary.number}`} className={primaryBtn}>
                        {regOpen ? 'Register Now' : 'View Season'}
                      </Link>
                      <Link href="/rules" className={secondaryBtn}>
                        View Rules
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <p className="eyebrow text-primary">World Cue Championships</p>
                    <h1 className="mt-3 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
                      Competitive cue sports.
                    </h1>
                    <p className="mt-3 max-w-xl text-muted-foreground">
                      No active Season right now. Follow the WCC rankings and enter standalone
                      tournaments.
                    </p>
                    <div className="mt-7 flex flex-wrap gap-3">
                      <Link href="/seasons" className={primaryBtn}>
                        Browse Seasons
                      </Link>
                      <Link href="/tournaments" className={secondaryBtn}>
                        Tournaments
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Entrants */}
            <aside className="flex flex-col rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide">Entrants</h2>
                {activeSummary ? (
                  <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {entrants.length}
                  </span>
                ) : null}
              </div>
              {activeSummary && entrants.length > 0 ? (
                <ol className="max-h-[360px] flex-1 divide-y divide-border overflow-y-auto">
                  {entrants.map((e, i) => (
                    <li key={e.entrantId} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.name}</p>
                        {e.cueverseId ? (
                          <p className="truncate text-xs text-muted-foreground">@{e.cueverseId}</p>
                        ) : null}
                      </div>
                      {e.rating != null ? (
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                          {Math.round(e.rating)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="flex-1 px-5 py-10 text-center">
                  <p className="text-sm text-foreground">
                    {activeSummary ? 'No entrants yet.' : 'No active Season.'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {activeSummary
                      ? 'Registered players will appear here.'
                      : 'Entrants appear here once a Season opens.'}
                  </p>
                </div>
              )}
              {activeSummary ? (
                <div className="border-t border-border px-5 py-3">
                  <Link
                    href={`/seasons/${activeSummary.number}`}
                    className="text-sm text-primary hover:underline"
                  >
                    View Season →
                  </Link>
                </div>
              ) : null}
            </aside>
          </div>
        </Wide>
      </section>

      {/* Top 10 Season Champions */}
      <section className="py-10">
        <Wide>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Top 10 · Season Champions</h2>
            <Link href="/rankings" className="text-sm text-primary hover:underline">
              Rankings →
            </Link>
          </div>
          {topWinners.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
              <p className="text-foreground">No Season champions yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The first WCC Season winner will be crowned here.
              </p>
            </div>
          ) : (
            <ol className="overflow-hidden rounded-xl border border-border bg-card">
              {topWinners.map((w, i) => (
                <li
                  key={w.name}
                  className="flex items-center gap-4 border-b border-border px-5 py-3 last:border-b-0"
                >
                  <span className="w-6 text-right text-sm font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate font-medium">{w.name}</span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {w.titles} {w.titles === 1 ? 'title' : 'titles'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Wide>
      </section>

      {/* Tournaments */}
      <section className="border-t border-border py-10">
        <Wide>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Tournaments</h2>
            <Link href="/tournaments" className="text-sm text-primary hover:underline">
              All tournaments →
            </Link>
          </div>

          {featured.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
              <p className="text-foreground">No tournaments yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Once the first WCC tournament is created it will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((t) => (
                <Link
                  key={t.number}
                  href={`/tournaments/${t.number}`}
                  className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="eyebrow text-muted-foreground">Tournament {t.number}</span>
                    <span
                      className={
                        t.status === 'live'
                          ? 'rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary'
                          : 'rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-muted-foreground'
                      }
                    >
                      {t.status === 'live' ? 'Live' : 'Completed'}
                    </span>
                  </div>
                  <h3 className="mt-2 font-semibold group-hover:text-primary">{t.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.gameType ?? 'Cue sports'}
                    {t.champion ? ` · Champion: ${t.champion.name}` : ''}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </Wide>
      </section>

      {/* Feature links */}
      <section className="border-t border-border bg-card/20 py-10">
        <Wide className="grid gap-4 sm:grid-cols-3">
          {[
            { href: '/seasons', title: 'Seasons', body: 'The premier WCC competition — group stage into playoffs.' },
            { href: '/rankings', title: 'Rankings', body: 'The WCC ladder, rebuilt from every completed competition.' },
            { href: '/rules', title: 'Rules', body: 'The official WCC competition handbook.' },
          ].map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
            >
              <h3 className="font-semibold">{c.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
            </Link>
          ))}
        </Wide>
      </section>
    </>
  )
}
