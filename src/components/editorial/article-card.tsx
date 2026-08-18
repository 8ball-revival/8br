import Link from 'next/link'
import { MessageSquare, Clock, Pin } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import type { ArticleCard as Card } from '@/lib/editorial/queries'

/**
 * One article in a listing.
 *
 * Three sizes of the same card rather than three components, because they differ only in how much
 * they show — keeping them together is what stops the lead card and the list card drifting apart
 * when a badge or a byline changes.
 */
export function ArticleCardView({
  article,
  size = 'default',
}: {
  article: Card
  size?: 'lead' | 'default' | 'compact'
}) {
  const href = `/news/${article.slug}`
  const lead = size === 'lead'
  const compact = size === 'compact'

  if (compact) {
    return (
      <article className="group border-b border-border py-3 last:border-b-0">
        <Link href={href} className="block">
          <h3 className="text-sm font-medium leading-snug text-foreground group-hover:text-brand">
            {article.title}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Byline article={article} />
            {article.commentCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3" aria-hidden />{article.commentCount}
              </span>
            )}
          </p>
        </Link>
      </article>
    )
  }

  return (
    <article
      className={[
        'group flex flex-col overflow-hidden rounded-lg border border-border bg-card/40 transition-colors hover:border-brand/40',
        lead ? 'sm:flex-row' : '',
      ].join(' ')}
    >
      {article.coverMediaId && (
        <Link href={href} className={lead ? 'sm:w-[46%] sm:shrink-0' : ''} tabIndex={-1} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- Payload media, not a static asset */}
          <img
            src={`/api/media/file/${article.coverMediaId}`}
            alt=""
            className={`w-full object-cover ${lead ? 'h-48 sm:h-full' : 'h-40'}`}
            loading="lazy"
          />
        </Link>
      )}

      <div className={`flex flex-1 flex-col p-4 ${lead ? 'sm:p-6' : ''}`}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {article.official && <Badge variant="gold">Official</Badge>}
          {article.pinned && (
            <Badge variant="muted"><Pin className="mr-1 size-3" aria-hidden />Pinned</Badge>
          )}
          {article.category && (
            <Link href={`/news/category/${article.category.slug}`}>
              <Badge variant="muted">{article.category.name}</Badge>
            </Link>
          )}
        </div>

        <h2
          className={[
            'font-display font-bold leading-tight tracking-tight',
            lead ? 'text-2xl sm:text-3xl' : 'text-lg',
          ].join(' ')}
        >
          <Link href={href} className="hover:text-brand">{article.title}</Link>
        </h2>

        {article.excerpt && (
          <p className={`mt-2 text-sm leading-relaxed text-muted-foreground ${lead ? '' : 'line-clamp-3'}`}>
            {article.excerpt}
          </p>
        )}

        <p className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-xs text-muted-foreground">
          <Byline article={article} />
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden />{article.readingMinutes} min
          </span>
          {article.commentCount > 0 && (
            <Link href={`${href}#comments`} className="inline-flex items-center gap-1 hover:text-brand">
              <MessageSquare className="size-3" aria-hidden />
              {article.commentCount}
            </Link>
          )}
        </p>
      </div>
    </article>
  )
}

/**
 * Author and date.
 *
 * The author is named explicitly and set in bold gold, because on a wall of cards the byline was the
 * first thing to disappear — it read as one more grey item in a row of metadata, indistinguishable
 * from the date and the reading time. The word "Author" removes the guesswork about what the name is,
 * and the gold makes it the thing the eye lands on.
 *
 * CueVerse ID leads wherever an identity is shown on this site, with the preferred name after it —
 * two members can share a first name, and the handle is the one thing that is unique.
 */
function Byline({ article }: { article: Card }) {
  const label = article.author.handle ?? article.author.name
  const name = (
    <strong className="font-semibold text-[var(--gold)]">{label}</strong>
  )
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <span className="text-muted-foreground">Author</span>
        {article.author.playerId ? (
          <Link
            href={`/news/author/${encodeURIComponent(label)}`}
            className="hover:underline"
            style={{ textDecorationColor: 'var(--gold)' }}
          >
            {name}
          </Link>
        ) : name}
      </span>
      {article.publishAt && (
        <time dateTime={article.publishAt.toISOString()}>{formatDate(article.publishAt.toISOString())}</time>
      )}
    </>
  )
}
