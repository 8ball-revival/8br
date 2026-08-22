import {
  Archive, BarChart3, Megaphone, Newspaper, Target, Users, type LucideIcon,
} from 'lucide-react'

/**
 * The image surface an article shows when it has no picture of its own.
 *
 * One visual family for every category, built from the site's own palette: near-black ground,
 * charcoal panel, restrained gold, muted-grey linework. Categories are told apart by a small icon
 * and a label, never by flooding the frame with a category colour — a green block beside a blue one
 * reads as two different websites, which is what this replaces.
 *
 * Everything here is drawn from CSS and inline SVG geometry. No image file is generated, nothing is
 * fetched, and there is no external asset to go missing, so a fallback can never render as a broken
 * image.
 */

interface CategoryStyle {
  Icon: LucideIcon
  label: string
}

/**
 * Category icons.
 *
 * Matched on the slug, which is stable, with the name as a secondary chance for a category created
 * before this map existed. Anything unrecognised falls back to the newspaper — a sensible default for
 * a news section rather than a blank.
 */
const CATEGORIES: Record<string, CategoryStyle> = {
  predictions: { Icon: Target, label: 'Predictions' },
  history: { Icon: Archive, label: 'History' },
  analysis: { Icon: BarChart3, label: 'Analysis' },
  community: { Icon: Users, label: 'Community' },
  news: { Icon: Newspaper, label: 'News' },
  'official-news': { Icon: Megaphone, label: 'Official' },
  announcements: { Icon: Megaphone, label: 'Announcements' },
}

export function categoryStyle(slug: string | null, name: string | null): CategoryStyle {
  const key = (slug ?? name ?? '').toLowerCase().trim()
  if (CATEGORIES[key]) return CATEGORIES[key]
  // A slug like "season-predictions" should still find the prediction icon.
  const partial = Object.keys(CATEGORIES).find((k) => key.includes(k))
  return partial ? CATEGORIES[partial] : { Icon: Newspaper, label: name ?? 'News' }
}

/**
 * The editorial cover fallback.
 *
 * `variant` only changes scale and how much detail is worth drawing: the lead card gets the full
 * treatment because it is large enough to read as a cover, while a thumbnail gets the same materials
 * without the fine linework, which would just be noise at that size.
 */
export function ArticleFallback({
  title,
  categorySlug,
  categoryName,
  variant,
  className = '',
}: {
  title: string
  categorySlug: string | null
  categoryName: string | null
  variant: 'feature' | 'thumb'
  className?: string
}) {
  const { Icon, label } = categoryStyle(categorySlug, categoryName)
  const feature = variant === 'feature'

  return (
    <div
      // Decorative: the headline next to it carries the meaning, so a screen reader gains nothing here.
      aria-hidden
      className={`relative isolate overflow-hidden bg-[#0a0a0b] ${className}`}
    >
      {/* Charcoal ground with a faint warm lift from the corner, so the frame is not a flat black box. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_15%_0%,#1a1a1d_0%,#101012_45%,#08080a_100%)]" />

      {/* Archive linework: a ruled grid and one gold hairline. Geometry, drawn at render time. */}
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 400 240"
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
      >
        <defs>
          <pattern id="br-rule" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0 L0 0 0 40" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="400" height="240" fill="url(#br-rule)" />
        {feature && (
          <>
            {/* A single gold rule, off-centre, doing the work a rule does on a printed cover. */}
            <line x1="0" y1="176" x2="400" y2="176" stroke="rgba(201,162,39,0.28)" strokeWidth="1" />
            <line x1="0" y1="180" x2="132" y2="180" stroke="rgba(201,162,39,0.5)" strokeWidth="2" />
          </>
        )}
      </svg>

      {/* The 8-ball watermark: a circle and its numeral, kept faint enough to read as a texture. */}
      <svg
        className={`absolute ${feature ? '-bottom-8 -right-6 size-56' : '-bottom-4 -right-3 size-28'} opacity-[0.055]`}
        viewBox="0 0 100 100"
        role="presentation"
      >
        <circle cx="50" cy="50" r="48" fill="#ffffff" />
        <circle cx="50" cy="50" r="26" fill="#0a0a0b" />
        <text
          x="50" y="50" dy="0.36em" textAnchor="middle"
          fontSize="34" fontWeight="700" fill="#ffffff" fontFamily="system-ui, sans-serif"
        >
          8
        </text>
      </svg>

      {/* Foreground: the category mark, and on a feature the article's opening letter as a device. */}
      <div className={`relative flex size-full ${feature ? 'flex-col justify-end p-5' : 'items-center justify-center'}`}>
        {feature ? (
          <>
            <span className="mb-auto inline-flex size-10 items-center justify-center rounded-full border border-brand/25 bg-[var(--selected-surface)] text-brand">
              <Icon className="size-4" />
            </span>
            <span className="font-display text-[3.25rem] font-bold leading-none text-white/[0.07] select-none">
              {title.trim().charAt(0).toUpperCase()}
            </span>
            <span className="mt-2 text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {label}
            </span>
          </>
        ) : (
          <span className="inline-flex flex-col items-center gap-1.5">
            <span className="inline-flex size-8 items-center justify-center rounded-full border border-brand/20 bg-[var(--selected-surface)] text-brand/80">
              <Icon className="size-3.5" />
            </span>
            <span className="text-[0.55rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {label}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}
