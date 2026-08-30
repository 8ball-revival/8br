import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'

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
/**
 * How much of the notice to show.
 *
 * `full` is the standing disclaimer: how the archive was reconstructed, and that it is certainly
 * imperfect. It belongs wherever somebody is about to read reconstructed data.
 *
 * `compact` is the homepage strip — the commitment and the way to report a mistake, in one line.
 * The full text is NOT deleted anywhere it is contextually required; this is a presentation choice
 * for a front page that has already said what the site is.
 */
export type ArchiveNoticeVariant = 'full' | 'compact'

export function ArchiveNotice({ variant = 'full' }: { variant?: ArchiveNoticeVariant } = {}) {
  if (variant === 'compact') return <ArchiveNoticeStrip />
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

/**
 * The compact strip.
 *
 * Same destination, same workflow — `/contact` is where a report goes, and that has not changed.
 * What changes is how much of the front page it occupies: a full paragraph of caveat under a record
 * video reads as an apology for the site rather than as a commitment to fixing it.
 */
function ArchiveNoticeStrip() {
  return (
    <section
      aria-labelledby="archive-strip-heading"
      className="dl-surface cyber-clip relative border border-[var(--line-strong)] bg-[var(--graphite)] px-4 py-3"
    >
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 size-2.5 border-l-2 border-t-2 border-[var(--hot-red)]" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 size-2.5 border-b-2 border-r-2 border-[var(--hot-red)]" />

      <h2 id="archive-strip-heading" className="sr-only">Archive accuracy</h2>

      <p className="text-[0.82rem] leading-snug text-foreground">
        We&rsquo;re committed to accuracy. Help us keep the archive correct.
      </p>

      <Link
        href="/contact"
        className="mt-1.5 inline-flex items-center gap-1.5 text-[0.68rem] font-bold uppercase tracking-wider text-[var(--neon-cyan)] underline-offset-4 transition-colors hover:text-[var(--clean-white)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        Report an archive error
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </section>
  )
}
