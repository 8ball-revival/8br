import Link from 'next/link'

import type { HomeArticle } from '@/lib/home/news'
import { cn } from '@/lib/utils'

/**
 * The homepage hero: one photograph, three columns of information, and no card edges.
 *
 * ── Why it is one composition rather than three panels ──────────────────────────────────────────
 * The row this replaced was three bordered cards side by side — a white intro, a news list and a
 * rankings panel — and it read as three unrelated widgets that happened to share a row. The approved
 * design makes the whole band one photograph with the copy laid over it, which is what gives the
 * page a front-page rather than a dashboard. So there is exactly one surface here, the picture is
 * the ground, and the three columns are arranged ON it rather than boxed beside each other.
 *
 * ── Why the photograph is right-weighted, and what that buys ────────────────────────────────────
 * The supplied crop puts the subject on the right and leaves the left two thirds nearly black. That
 * is not a coincidence — it is what lets the heading sit directly on the image with no panel behind
 * it and still clear contrast. The scrim below reinforces the left side rather than dimming the
 * whole frame, so the picture stays a picture where nothing is written on it.
 *
 * ── Whose face this is ──────────────────────────────────────────────────────────────────────────
 * The photograph is of the CURRENT champion, and the champion changes. Nothing here couples the two:
 * the module decides whether a picture matches the person the database now names, and hands over a
 * neutral branded ground when it does not. See `championImageMatches` in the module.
 */

export interface ChampionHeroPlayer {
  rank: number
  /** The CueVerse ID, which leads everywhere on this site. */
  handle: string | null
  /** The real name, second line. */
  name: string
  rating: number | null
  href: string | null
}

export function ChampionHero({
  eyebrow, heading, body, tagline, ctaLabel, ctaHref,
  newsLabel, articles, newsHref,
  image,
}: {
  eyebrow: string
  heading: string
  body: string
  tagline: string
  ctaLabel: string
  ctaHref: string
  newsLabel: string
  articles: HomeArticle[]
  newsHref: string
  /**
   * The photograph, or null for the branded ground.
   *
   * Two sources rather than one: a 2400x1000 letterbox for desktop and a 1080x1350 upright for a
   * phone. One crop cannot serve both — the desktop frame on a phone shows a sliver of a shoulder,
   * and the phone crop stretched across a desktop is a headshot with nothing around it.
   */
  image: {
    desktop: string
    mobile: string
    alt: string
    focalDesktop: string
    focalMobile: string
    /** 0-100. How hard the left side is darkened so the copy clears contrast. */
    overlay: number
  } | null
}) {
  return (
    <section
      aria-labelledby="home-hero-heading"
      /*
        The fallback ground is the SCRIM, not the page.

        Everything written here sits on a darkened photograph, so the copy is `--text-on-media` —
        light, always. If this section fell back to the page colour, a light theme would put that
        light copy on light paper for as long as the image took to arrive, and permanently if it
        never did. Falling back to the same colour the scrim darkens with means the ground under the
        text is the same whether the photograph is there or not.
      */
      className="relative isolate overflow-hidden border-b border-[var(--line-strong)] bg-[var(--scrim-tint)]"
    >
      {image ? (
        <picture>
          {/*
            The breakpoint is a MEDIA query, not a resolution one.

            `srcset` with widths would let the browser pick the letterbox crop on a phone if the
            device pixel ratio made it the better download, which is exactly the wrong answer: the
            two files differ in what they SHOW, not in how big they are. A media query makes the
            choice about the layout, and the browser downloads one of them, never both.
          */}
          <source media="(max-width: 767px)" srcSet={image.mobile} width={1080} height={1350} />
          <img
            src={image.desktop}
            alt={image.alt}
            width={2400}
            height={1000}
            /*
              Above the fold, so it is eager and high priority. Everything else on this page is
              lazy; this is the one image a reader is certainly going to see.
            */
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
            style={{ objectPosition: `var(--hero-focal, ${image.focalDesktop})` }}
          />
        </picture>
      ) : (
        /*
          No photograph for this champion.

          A branded ground rather than the previous champion's face — see the note at the top. It is
          built from the same tokens as everything else, so it is a deliberate surface rather than an
          empty box, and the composition below is unchanged.
        */
        <span
          aria-hidden
          className="absolute inset-0 bg-[var(--scrim-tint)]"
          style={{
            backgroundImage:
              'radial-gradient(120% 90% at 82% 46%, color-mix(in oklab, var(--surface-plaque) 90%, transparent), transparent 62%),'
              + 'repeating-linear-gradient(115deg, color-mix(in oklab, var(--steel-dim) 12%, transparent) 0 1px, transparent 1px 22px)',
          }}
        />
      )}

      {/*
        The scrim, weighted to the left.

        Two passes: a horizontal ramp that carries the copy columns, and a light bottom fade so the
        hero meets the ranking rail beneath it instead of stopping at a hard edge. The strength is
        Owner-editable because a future photograph will be lighter or darker than this one and the
        contrast has to be recoverable without a code change.
      */}
      {image && (
        <>
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage:
                `linear-gradient(90deg, color-mix(in oklab, var(--scrim-tint) ${image.overlay}%, transparent) 0%,`
                + ` color-mix(in oklab, var(--scrim-tint) ${Math.round(image.overlay * 0.82)}%, transparent) 48%,`
                + ' transparent 100%)',
            }}
          />
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--scrim-tint)] to-transparent" />
        </>
      )}

      <div className="relative mx-auto grid w-full max-w-[var(--sb-container-width,96rem)] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,34fr)_minmax(0,26fr)_minmax(0,30fr)] lg:gap-10 lg:px-8 lg:py-14">
        {/* ── The registry, in a sentence ─────────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <p className="font-condensed text-[0.72rem] font-semibold uppercase tracking-[0.34em] text-[var(--text-on-media-dim)]">
            {eyebrow} <span className="text-[var(--accent-on-media)]">{'//'}</span>
          </p>
          <h1
            id="home-hero-heading"
            className="mt-3 font-condensed font-extrabold uppercase leading-[0.88] tracking-[-0.01em] text-[var(--text-on-media)]"
            style={{ fontSize: 'clamp(2.75rem, 5.2vw, 5rem)' }}
          >
            {heading}
          </h1>
          <p className="mt-5 max-w-md text-[0.98rem] leading-relaxed text-[var(--text-on-media)]">{body}</p>
          {tagline && (
            <p className="mt-3 max-w-md text-sm italic leading-relaxed text-[var(--text-on-media-dim)]">{tagline}</p>
          )}
          <Link
            href={ctaHref}
            className={cn(
              'cyber-clip-sm mt-7 inline-flex items-center gap-2 bg-[var(--signal-fill)] px-6 py-3',
              'font-condensed text-sm font-bold uppercase tracking-[0.16em] text-[var(--signal-ink)]',
              'transition-colors hover:bg-[var(--signal-fill-hover)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--void)]',
            )}
          >
            {ctaLabel}
            <span aria-hidden>&rarr;</span>
          </Link>
        </div>

        {/* ── The same three articles, as headlines ───────────────────────────────────────────── */}
        <div className="min-w-0 lg:border-l lg:border-[color-mix(in_oklab,var(--steel-dim)_55%,transparent)] lg:pl-8">
          <p className="font-condensed text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-[var(--text-on-media-dim)]">
            {newsLabel}
          </p>
          {articles.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--text-on-media-dim)]">Nothing published yet.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {articles.map((a) => (
                <li key={a.id} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.5rem] size-1.5 shrink-0 rounded-full bg-[var(--accent-on-media)]" />
                  <div className="min-w-0">
                    {/* `py-1` is target size, not spacing: a bare headline link is 19px tall. */}
                    <Link
                      href={`${newsHref}/${a.slug}`}
                      className="block py-1 text-sm font-semibold leading-snug text-[var(--text-on-media)] underline-offset-4 transition-colors hover:text-[var(--accent-on-media)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      {a.title}
                    </Link>
                    <p className="mt-1 font-condensed text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--text-on-media-dim)]">
                      <PublishedOn at={a.publishAt} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/*
          The third grid track is deliberately empty.

          It used to carry the current champion — rank, handle, real name and rating — over the
          right of the photograph. That was removed at the owner's request. The track itself stays
          so the heading and the news list keep the exact widths they had, and so the right of the
          photograph is left clear rather than having text run across the subject.
        */}
      </div>
    </section>
  )
}

/**
 * A publication date, formatted on the server in a fixed locale.
 *
 * `toLocaleDateString` with no locale uses the runtime's, which differs between the server that
 * renders this and the browser that hydrates it — the classic hydration mismatch that only shows up
 * on somebody else's machine. A fixed locale and an explicit time zone make both sides agree.
 */
function PublishedOn({ at }: { at: Date }) {
  const text = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(at).toUpperCase()
  return <time dateTime={at.toISOString()}>{text}</time>
}
