import Link from 'next/link'

import type { HomeArticle } from '@/lib/home/news'
import type { ArticleArt } from '@/lib/home/article-art'
import { cn } from '@/lib/utils'

/**
 * The same three articles as the hero, with pictures.
 *
 * ── Why the duplication is deliberate ───────────────────────────────────────────────────────────
 * The hero lists headlines and this lists stories, and they are the same three articles on purpose:
 * a reader scanning the top of the page gets the titles in one glance, and a reader who has come
 * down the page gets something to look at. They are drawn from ONE query — the module fetches once
 * and hands the same array to both — so the two can never disagree about what is newest.
 *
 * ── The picture is optional, always ─────────────────────────────────────────────────────────────
 * Three articles have art assigned. The fourth one published will not, and the card has to look
 * deliberate rather than broken when that happens. So the fallback is a real drawn surface built
 * from theme tokens, sized to the identical 16:9 box, and the row never changes height. The thing
 * that must not happen — a collapsed card or a browser's broken-image glyph — cannot, because there
 * is no `<img>` at all when there is no source.
 */
export function NewsPlaques({
  label, articles, art, viewAllLabel, viewAllHref, basePath,
}: {
  label: string
  articles: HomeArticle[]
  /** Resolved by the module: same order as `articles`, null where nothing is assigned. */
  art: (ArticleArt | null)[]
  viewAllLabel: string
  viewAllHref: string
  basePath: string
}) {
  return (
    <section
      aria-labelledby="home-news-heading"
      className="flex min-w-0 flex-col border border-[var(--line-strong)] bg-[var(--graphite)]"
    >
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 id="home-news-heading" className="font-condensed text-[0.74rem] font-bold uppercase tracking-[0.26em] text-[var(--text-primary)]">
          {label}
        </h2>
      </div>

      {articles.length === 0 ? (
        <p className="px-4 py-8 text-sm text-[var(--text-muted)]">Nothing published yet.</p>
      ) : (
        <ul className="flex-1 divide-y divide-[var(--border)]">
          {articles.map((a, i) => (
            <li key={a.id}>
              <Link
                href={`${basePath}/${a.slug}`}
                className={cn(
                  'group flex items-start gap-3 px-4 py-3.5 transition-colors',
                  'hover:bg-[var(--surface-plaque)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
                )}
              >
                <Thumbnail art={art[i]} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug text-[var(--text-primary)] transition-colors group-hover:text-[var(--signal)]">
                    {a.title}
                  </span>
                  <span className="mt-1.5 block font-condensed text-[0.66rem] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    <PublishedOn at={a.publishAt} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-[var(--border)] px-4 py-3">
        <Link
          href={viewAllHref}
          className="inline-flex min-h-6 items-center gap-2 py-1 font-condensed text-[0.7rem] font-bold uppercase tracking-[0.2em] text-[var(--steel-bright)] transition-colors hover:text-[var(--signal)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          {viewAllLabel}
          <span aria-hidden>&rarr;</span>
        </Link>
      </div>
    </section>
  )
}

/**
 * A fixed 16:9 box that always occupies the same space.
 *
 * The dimensions are on the element rather than left to the image, so the row reserves its height
 * before anything downloads and the list does not jump as three pictures arrive. Lazy, because this
 * panel is below the fold on every width the design supports.
 */
function Thumbnail({ art }: { art: ArticleArt | null }) {
  const box = 'relative w-[5.5rem] shrink-0 overflow-hidden border border-[var(--border)] sm:w-[6.5rem]'
  const ratio = { aspectRatio: '16 / 9' }

  if (!art) {
    return (
      <span aria-hidden className={cn(box, 'bg-[var(--surface-inset)]')} style={ratio}>
        <span
          className="absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(125deg, color-mix(in oklab, var(--steel-dim) 22%, transparent) 0 1px, transparent 1px 9px)',
          }}
        />
        <span className="absolute inset-0 flex items-center justify-center font-condensed text-[0.6rem] font-bold uppercase tracking-[0.22em] text-[var(--steel)]">
          8BR
        </span>
      </span>
    )
  }

  return (
    <span className={cn(box, 'bg-[var(--surface-inset)]')} style={ratio}>
      {/*
        A plain <img>: these are already-optimised WebP crops shipped at the exact size this box
        needs, so routing them through the image optimiser would spend a server round trip to
        produce a file the same size as the one on disk.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={art.src}
        alt={art.alt}
        aria-hidden={art.alt ? undefined : true}
        width={1200}
        height={675}
        loading="lazy"
        decoding="async"
        sizes="(max-width: 640px) 88px, 104px"
        className="absolute inset-0 size-full object-cover"
        style={{ objectPosition: art.focal }}
      />
    </span>
  )
}

/** Fixed locale and time zone, so the server and the browser format it identically. */
function PublishedOn({ at }: { at: Date }) {
  const text = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(at).toUpperCase()
  return <time dateTime={at.toISOString()}>{text}</time>
}
