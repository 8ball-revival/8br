import Link from 'next/link'

import type { ExplorerRow } from '@/lib/stats/ladder-explorer'

/**
 * The Yahoo Archives tile — a narrow doorway into the original era.
 *
 * ── The top five is a summary, not a second ranking ─────────────────────────────────────────────
 * The rows arrive from `lib/yahoo/ladder.ts`, which is the same pair of functions `/yahoo` itself
 * calls. That is deliberate and it is the whole design: a tile that computed its own top five would
 * be a second archive ranking, and two rankings of the same people from the same ledger disagree
 * quietly — the numbers stay plausible and only the order drifts. Each row keeps the ladder's own
 * `rank`, so a tie on the archive page is the same tie here.
 *
 * ── Its palette ─────────────────────────────────────────────────────────────────────────────────
 * Sepia gold over black, against the crimson the live panels use. The archive is finished: nothing
 * in it is going to change, and the colour is what says so before a word is read.
 */
export function YahooArchives({
  rows,
  eyebrow,
  heading,
  blurb,
  listLabel,
  ctaLabel,
  href,
}: {
  rows: ExplorerRow[]
  eyebrow: string
  heading: string
  blurb: string
  listLabel: string
  ctaLabel: string
  href: string
}) {
  return (
    <section
      aria-label={heading}
      className="flex h-full flex-col border border-[var(--gold)]/25 bg-[var(--surface)]"
    >
      <div className="flex-1 px-4 pb-3 pt-3.5">
        <p className="font-condensed text-[0.66rem] font-bold uppercase tracking-[0.2em] text-[var(--gold)]/80">
          {eyebrow}
        </p>
        <h2 className="mt-1 font-display text-xl font-black uppercase leading-none tracking-[0.02em] text-[var(--gold)]">
          {heading}
        </h2>
        <p className="mt-2 text-[0.78rem] leading-snug text-muted-foreground">{blurb}</p>

        <p className="mt-3.5 font-condensed text-[0.62rem] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {listLabel}
        </p>
        {rows.length === 0 ? (
          <p className="mt-2 text-[0.78rem] text-muted-foreground">The archive has no ranked players yet.</p>
        ) : (
          <ol className="mt-1.5 divide-y divide-border/50">
            {rows.map((r, i) => (
              <li key={r.playerId} className="flex items-baseline gap-2 py-[0.3rem]">
                {/*
                  The ladder's own rank, not the position in this slice. They are the same number
                  until two players tie, and then this is the one that agrees with /yahoo.
                */}
                <span className="tabular w-4 shrink-0 text-[0.7rem] font-bold text-[var(--gold)]/70">
                  {r.rank || i + 1}
                </span>
                <Link
                  href={`/players/${encodeURIComponent(r.slug)}`}
                  /*
                    The CueVerse ID leads, per the shared public-identity rule: preferred names
                    collide constantly across twenty years of archive and an ID does not. The
                    preferred name is the fallback for an archive figure who never had a handle.
                  */
                  title={r.label}
                  className="min-w-0 flex-1 truncate text-[0.8rem] font-semibold text-foreground hover:text-[var(--gold)] hover:underline"
                >
                  {r.cueverseId ?? r.preferredName}
                </Link>
                <span className="tabular shrink-0 text-[0.78rem] font-bold text-[var(--gold)]">
                  {r.rating.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Link
        href={href}
        className="border-t border-[var(--gold)]/25 px-4 py-2.5 text-center font-condensed text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[var(--gold)] transition hover:bg-[var(--gold)]/[0.07]"
      >
        {ctaLabel} <span aria-hidden>→</span>
      </Link>
    </section>
  )
}
