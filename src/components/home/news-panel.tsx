import Link from 'next/link'
import { ArrowRight, Clock, MessageSquare } from 'lucide-react'

import { formatDate } from '@/lib/format'
import type { HomeArticle } from '@/lib/home/news'
import { ArticleFallback } from './article-fallback'

/**
 * The Break, on the homepage.
 *
 * Three article positions: a large rotating feature, then the two newest articles. Every position
 * shows an image surface whether or not the article has a cover, because a row where one card has a
 * picture and the next has a blank rectangle looks broken rather than sparse.
 *
 * Where there is no cover, `ArticleFallback` supplies one from the site's own palette — see that file
 * for why the categories are distinguished by an icon rather than by a coloured field.
 */

function ImageSurface({
  article, priority, className,
}: { article: HomeArticle; priority: boolean; className: string }) {
  if (article.coverMediaId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Payload media, not a static asset
      <img
        src={`/api/media/file/${article.coverMediaId}`}
        alt={article.coverAlt ?? ''}
        className={`${className} object-cover`}
        // The lead image is what a visitor sees first; the two below it can wait until they scroll.
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
      />
    )
  }

  return (
    <ArticleFallback
      title={article.title}
      categorySlug={article.categorySlug}
      categoryName={article.categoryName}
      variant={priority ? 'feature' : 'thumb'}
      className={className}
    />
  )
}

/** Byline, date and the optional figures — shown only where the value is real. */
function Meta({ article, showReading }: { article: HomeArticle; showReading: boolean }) {
  return (
    <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/80">{article.author}</span>
      <time dateTime={article.publishAt.toISOString()}>{formatDate(article.publishAt.toISOString())}</time>
      {showReading && (
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" aria-hidden />{article.readingMinutes} min
        </span>
      )}
      {article.commentCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="size-3" aria-hidden />{article.commentCount}
        </span>
      )}
    </p>
  )
}

/**
 * A card whose whole surface is the link.
 *
 * One anchor wraps everything, so there is never a button nested inside a clickable card, and the
 * keyboard reaches the article in a single tab stop with a visible ring.
 */
function ArticleCard({
  article, variant,
}: { article: HomeArticle; variant: 'feature' | 'secondary' }) {
  const feature = variant === 'feature'

  return (
    <Link
      href={`/news/${article.slug}`}
      className={[
        'group relative flex overflow-hidden rounded-none border border-border bg-card/40 transition-colors',
        'hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
        feature ? 'flex-col' : 'flex-col sm:flex-row',
      ].join(' ')}
    >
      <ImageSurface
        article={article}
        priority={feature}
        className={feature ? 'h-48 w-full sm:h-64' : 'h-32 w-full shrink-0 sm:h-auto sm:w-40'}
      />

      <div className={`flex flex-1 flex-col p-4 ${feature ? 'sm:p-5' : ''}`}>
        {article.categoryName && (
          <p className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-brand">
            {article.categoryName}
          </p>
        )}

        <h3
          className={[
            'font-display font-bold leading-tight tracking-tight group-hover:text-brand',
            feature ? 'text-xl sm:text-2xl' : 'text-base',
          ].join(' ')}
        >
          {article.title}
        </h3>

        {article.excerpt && (
          <p className={`mt-2 text-sm leading-relaxed text-muted-foreground ${feature ? 'line-clamp-3' : 'line-clamp-2'}`}>
            {article.excerpt}
          </p>
        )}

        <Meta article={article} showReading={feature} />
      </div>
    </Link>
  )
}

/** Shown when a position has no article. Truthful, and the same shape as a card so nothing shifts. */
function EmptySlot({ variant }: { variant: 'feature' | 'secondary' }) {
  const feature = variant === 'feature'
  return (
    <div
      className={[
        'flex overflow-hidden rounded-lg border border-dashed border-border bg-card/20',
        feature ? 'flex-col' : 'flex-col sm:flex-row',
      ].join(' ')}
    >
      <ArticleFallback
        title="8"
        categorySlug={null}
        categoryName="8 Ball Registry"
        variant={feature ? 'feature' : 'thumb'}
        className={[
          'opacity-60',
          feature ? 'h-48 w-full sm:h-64' : 'h-32 w-full shrink-0 sm:h-auto sm:w-40',
        ].join(' ')}
      />
      <div className="flex flex-1 flex-col justify-center p-4">
        <p className="font-display text-base font-semibold text-muted-foreground">More to come</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {feature
            ? 'Featured writing will appear here as articles are published.'
            : 'The next published article will appear here.'}
        </p>
      </div>
    </div>
  )
}

export function NewsPanel({
  featured, latest, second,
}: { featured: HomeArticle | null; latest: HomeArticle | null; second: HomeArticle | null }) {
  return (
    <section aria-labelledby="home-news-heading" className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-brand">The Break</p>
          <h2 id="home-news-heading" className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            News
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            News, predictions, analysis and community stories.
          </p>
        </div>
        <Link
          href="/news"
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          All articles <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div className="mt-5 space-y-4">
        {featured ? <ArticleCard article={featured} variant="feature" /> : <EmptySlot variant="feature" />}

        <div className="grid gap-4 lg:grid-cols-2">
          {latest ? <ArticleCard article={latest} variant="secondary" /> : <EmptySlot variant="secondary" />}
          {second ? <ArticleCard article={second} variant="secondary" /> : <EmptySlot variant="secondary" />}
        </div>
      </div>
    </section>
  )
}
