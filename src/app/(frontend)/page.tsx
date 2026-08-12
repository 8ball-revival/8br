import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { Wide } from '@/components/primitives'
import { getTournamentList } from '@/lib/tournaments/list'
import { tournamentStore, loadTournamentContext } from '@/lib/tournaments/prime'
import { pageMetadata, brandName } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: brandName,
  description:
    'World Cue Championships (WCC) — the home of competitive cue sports. Enter standalone tournaments, follow live brackets and standings, and climb the rankings.',
  path: '/',
})

export default async function HomePage() {
  // Resolve the live tournament revision before any tournament-derived render.
  tournamentStore.enterWith(await loadTournamentContext())

  const tournaments = await getTournamentList()
  const live = tournaments.filter((t) => t.status === 'live')
  const recent = tournaments.filter((t) => t.status === 'completed').slice(-6).reverse()
  const featured = [...live, ...recent].slice(0, 6)

  return (
    <>
      {/* Hero: WCC banner (wide, responsive, undistorted) + primary calls to action */}
      <section className="border-b border-border">
        <Wide className="py-8 lg:py-12">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Image
              src="/wcc-hero-banner.png"
              alt="World Cue Championships"
              width={1983}
              height={793}
              priority
              sizes="(max-width: 1280px) 100vw, 1216px"
              className="h-auto w-full"
            />
          </div>
          <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow text-primary">World Cue Championships</p>
              <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Competitive cue sports, one tournament at a time.
              </h1>
              <p className="mt-3 max-w-xl text-muted-foreground">
                Enter standalone tournaments, follow live brackets and standings, and climb the WCC
                rankings.
              </p>
            </div>
            <div className="flex shrink-0 gap-3">
              <Link
                href="/tournaments"
                className="inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                View Tournaments
              </Link>
              <Link
                href="/rankings"
                className="inline-flex items-center rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Rankings
              </Link>
            </div>
          </div>
        </Wide>
      </section>

      {/* Tournaments */}
      <section className="py-10">
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
            { href: '/rankings', title: 'Rankings', body: 'The WCC ladder, rebuilt from every completed tournament.' },
            { href: '/predictions', title: 'Predictions', body: 'Predict tournament outcomes and compete for bragging rights.' },
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
