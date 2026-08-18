import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { formatDate } from '@/lib/format'
import { competitionIconUrl } from '@/lib/competitions/shared'
import type { RecentResult } from '@/lib/home/results'

/**
 * Recent Results — the three most recently completed matches.
 *
 * A forfeit is labelled as a forfeit rather than shown as a scoreline, because its recorded numbers
 * are an outcome and not frames that were played.
 */
export function RecentResultsCard({ results }: { results: RecentResult[] }) {
  return (
    <section
      aria-labelledby="home-results-heading"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card/40"
    >
      <div className="border-b border-border p-4">
        <h3 id="home-results-heading" className="font-display text-sm font-bold uppercase tracking-[0.14em]">
          Recent Results
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">Latest completed matches</p>
      </div>

      <div className="flex-1">
        {results.length === 0 ? (
          <div className="flex h-full flex-col justify-center gap-1 p-4">
            <p className="text-sm text-muted-foreground">No completed matches yet.</p>
            <p className="text-xs text-muted-foreground">Results appear here as competitions are played.</p>
          </div>
        ) : (
          <ol>
            {results.map((r) => (
              <li key={r.key} className="border-b border-border last:border-b-0">
                <Link
                  href={r.href}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60"
                >
                  {/* The Competition's own icon, or its initials — never a broken image. */}
                  {competitionIconUrl(r.iconMediaId) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Payload media
                    <img
                      src={competitionIconUrl(r.iconMediaId)!}
                      alt=""
                      className="size-8 shrink-0 rounded object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded bg-muted text-[0.65rem] font-semibold text-muted-foreground"
                    >
                      {r.initials}
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.competitionName}
                      {r.stageLabel && <> · {r.stageLabel}</>}
                    </span>
                    <span className="block truncate text-sm">
                      <span className="font-medium">{r.homeName}</span>
                      <span className="mx-1.5 tabular-nums text-muted-foreground">
                        {r.isForfeit ? 'def.' : `${r.homeGames}–${r.awayGames}`}
                      </span>
                      <span className="font-medium">{r.awayName}</span>
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <time dateTime={r.completedAt} className="block text-[0.7rem] text-muted-foreground">
                      {formatDate(r.completedAt)}
                    </time>
                    {r.isForfeit && (
                      <span className="block text-[0.65rem] uppercase tracking-wide text-warning">forfeit</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-border p-3">
        <Link
          href="/seasons"
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          View all results <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  )
}
