import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

/**
 * The archive accuracy notice.
 *
 * ── Why this belongs on the homepage ─────────────────────────────────────────────────────────────
 * Forty-eight seasons were reconstructed by hand from Wayback captures, bracket images and partial
 * standings. Some of it is certainly wrong. Saying so on the front page, rather than burying it in a
 * policy link, is what makes the rest of the archive trustworthy: a site that admits its error bars
 * is telling you it has thought about them.
 *
 * The copy is the Owner's, used verbatim.
 */
export function ArchiveNotice() {
  return (
    <section
      aria-labelledby="archive-notice-heading"
      className="dl-surface cyber-clip relative flex h-full flex-col justify-center border border-[var(--line-strong)] bg-[var(--graphite)] p-5 text-center lg:p-6"
    >
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 size-3 border-l-2 border-t-2 border-[var(--hot-red)]" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 size-3 border-b-2 border-r-2 border-[var(--hot-red)]" />

      <h2 id="archive-notice-heading" className="sr-only">About the historical archive</h2>

      <p className="mx-auto max-w-2xl text-sm font-semibold leading-relaxed text-foreground sm:text-[0.95rem]">
        The historical seasons on 8 Ball Registry were recreated by hand using old records, archived
        pages, brackets, standings, and other information that was still available. Because thousands
        of pieces of historical data had to be entered manually, mistakes can and probably did
        happen. Scores, records, player names, or other details may occasionally be incorrect or
        missing. Our goal is to make the archive as accurate as possible. If you find something that
        looks wrong, please report it so we can review and correct it.
      </p>

      <p className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm font-bold text-foreground">
        <AlertTriangle className="size-4 text-[var(--hot-red)]" aria-hidden />
        Found a mistake?
        <Link
          href="/contact"
          className="cyber-clip-sm inline-flex items-center bg-[var(--hot-red)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--clean-white)] transition-colors hover:bg-[var(--hot-red-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Submit ticket
        </Link>
      </p>
    </section>
  )
}
