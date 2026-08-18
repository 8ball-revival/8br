import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { Clock, Eye, MessageSquare, Pencil, ShieldCheck } from 'lucide-react'

import { absoluteUrl, brandName } from '@/lib/site'
import { formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { RichText } from '@/components/editorial/rich-text'
import { ExpandableArticleImage } from '@/components/editorial/expandable-article-image'
import { ArticleCardView } from '@/components/editorial/article-card'
import { CommentThread, type ClientComment } from '@/components/editorial/comment-thread'
import { ViewCounter } from '@/components/editorial/view-counter'
import { resolveSlug } from '@/lib/editorial/slug'
import { getArticleById, relatedArticles } from '@/lib/editorial/queries'
import { getCommentThread, type CommentView } from '@/lib/editorial/comments'
import { isPubliclyVisible, isScheduled } from '@/lib/editorial/service'
import { currentEditorialActor, canViewUnpublished, canEditArticle } from '@/lib/editorial/permissions'
import { documentToPlainText } from '@/lib/editorial/richtext'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

/**
 * Metadata is generated from the same visibility rule the page uses.
 *
 * An article nobody may see must not leak its title into a browser tab or a link preview, so an
 * unavailable article gets generic metadata rather than the real one.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const resolved = await resolveSlug(slug)
  if (!resolved) return { title: 'Not found', robots: { index: false, follow: false } }

  const article = await getArticleById(resolved.articleId)
  if (!article || !isPubliclyVisible({ state: article.state as never, publishAt: article.publishAt })) {
    return { title: 'Not found', robots: { index: false, follow: false } }
  }

  const title = article.seoTitle || article.title
  const description = article.seoDescription
    || article.excerpt
    || documentToPlainText(article.body).slice(0, 200)
  const url = absoluteUrl(`/news/${article.slug}`)

  return {
    title,
    description,
    alternates: { canonical: article.canonicalUrl || `/news/${article.slug}` },
    openGraph: {
      title,
      description,
      url,
      siteName: brandName,
      type: 'article',
      publishedTime: article.publishAt?.toISOString(),
      modifiedTime: article.updatedAt.toISOString(),
      authors: [article.author.handle ?? article.author.name],
      images: article.coverMediaId ? [absoluteUrl(`/api/media/file/${article.coverMediaId}`)] : undefined,
    },
    twitter: {
      card: article.coverMediaId ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  }
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params

  const resolved = await resolveSlug(slug)
  if (!resolved) notFound()
  // A renamed article keeps its old URLs working, but only ever serves from the current one.
  if (resolved.moved) permanentRedirect(`/news/${resolved.canonicalSlug}`)

  const article = await getArticleById(resolved.articleId)
  if (!article) notFound()

  const actor = await currentEditorialActor()
  const state = { state: article.state as never, publishAt: article.publishAt }
  const visible = isPubliclyVisible(state)
  // An author sees their own unpublished work; an administrator sees anything. To everybody else an
  // unpublished article is indistinguishable from one that does not exist.
  if (!visible && !canViewUnpublished(actor, article.author.playerId)) notFound()

  const [comments, related] = await Promise.all([
    getCommentThread(article.id, actor),
    relatedArticles(article.id, article.category?.id ?? null),
  ])

  const mayEdit = canEditArticle(actor, article.author.playerId)
  const scheduled = isScheduled(state)

  /*
    Which image heads the article.

    An explicitly chosen cover wins. Otherwise the article's first inline image is promoted, which is
    the existing fallback and the reason most pasted-in articles have a cover at all. Either way the
    resulting id is handed to RichText, which drops the body's first image only when that image IS
    this one — so a promoted image appears once, and images the author placed deliberately all stay.
  */
  const firstInlineImage = article.body.blocks.find(
    (b): b is Extract<typeof b, { t: 'img' }> => b.t === 'img',
  )
  const featured = article.coverMediaId
    ? {
      mediaId: article.coverMediaId,
      src: `/api/media/file/${article.coverMediaId}`,
      alt: article.coverAlt ?? '',
      caption: null as string | null,
    }
    : firstInlineImage
      ? {
        mediaId: firstInlineImage.mediaId,
        src: `/api/media/file/${firstInlineImage.mediaId}`,
        alt: firstInlineImage.alt,
        caption: firstInlineImage.caption,
      }
      : null
  const hasMedia = featured != null

  return (
    /*
      Same max width and gutters as the header's inner container (see site-header), so the article
      lines up with the navigation above it instead of sitting in a narrower well of its own.
    */
    <article className="mx-auto w-full max-w-[96rem] px-4 py-8 sm:px-6 lg:px-8">
      {visible && <ViewCounter articleId={article.id} />}

      {!visible && (
        <div className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          {scheduled
            ? <>Scheduled — this becomes public on {formatDate(article.publishAt!.toISOString())}. Only you and administrators can see it now.</>
            : <>This article is {article.state.toLowerCase().replace('_', ' ')}. Only you and administrators can see it.</>}
        </div>
      )}

      <nav className="mb-4 text-xs text-muted-foreground">
        <Link href="/news" className="hover:text-brand">News</Link>
        {article.category && (
          <>
            <span className="mx-1.5">/</span>
            <Link href={`/news/category/${article.category.slug}`} className="hover:text-brand">
              {article.category.name}
            </Link>
          </>
        )}
      </nav>

      {/*
        Two columns once there is room, one below that.

        Three grid children with explicit placement, rather than nesting the body inside a left
        column. That is what lets ONE dom order serve both layouts: header, then image, then body.
        Stacked on mobile that is exactly the order wanted — the preview sits after the metadata and
        before the article. On desktop the image is moved to a right-hand rail spanning both rows.

        `minmax(0, 1fr)` on the text track is load-bearing: a grid track is auto-sized to its content
        by default, so an unbroken title or a wide code block would push the column past its share and
        force the whole page to scroll sideways. The 0 minimum lets it shrink instead.

        With no image, `hasMedia` is false, the grid classes are never applied, and the article is a
        single readable column — no empty rail.
      */}
      <div
        className={
          hasMedia
            ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(21rem,26rem)] lg:items-start lg:gap-8 xl:gap-12'
            : ''
        }
      >
      <header className="min-w-0 lg:col-start-1 lg:row-start-1">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {article.official && (
            <Badge variant="gold"><ShieldCheck className="mr-1 size-3" aria-hidden />Official</Badge>
          )}
          {article.category && <Badge variant="muted">{article.category.name}</Badge>}
        </div>

        <h1 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {article.title}
        </h1>

        {article.excerpt && (
          <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{article.excerpt}</p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-border py-3 text-xs text-muted-foreground">
          {/* Named explicitly and set in gold: who wrote a piece should not be the least visible
              thing in the metadata row. Matches the byline on the article cards. */}
          <span className="inline-flex items-center gap-1.5">
            <span>Author</span>
            <Link
              href={`/news/author/${encodeURIComponent(article.author.handle ?? article.author.name)}`}
              className="font-semibold text-[var(--gold)] hover:underline"
              style={{ textDecorationColor: 'var(--gold)' }}
            >
              {article.author.handle ?? article.author.name}
            </Link>
            {article.author.handle && article.author.name !== article.author.handle && (
              <span className="opacity-70">({article.author.name})</span>
            )}
          </span>
          {article.publishAt && (
            <time dateTime={article.publishAt.toISOString()}>{formatDate(article.publishAt.toISOString())}</time>
          )}
          <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden />{article.readingMinutes} min read</span>
          {article.viewCount > 0 && (
            <span className="inline-flex items-center gap-1"><Eye className="size-3" aria-hidden />{article.viewCount}</span>
          )}
          {article.commentCount > 0 && (
            <a href="#comments" className="inline-flex items-center gap-1 hover:text-brand">
              <MessageSquare className="size-3" aria-hidden />{article.commentCount}
            </a>
          )}
          {mayEdit && (
            <Link href={`/news/${article.slug}/edit`} className="ml-auto inline-flex items-center gap-1 text-brand hover:underline">
              <Pencil className="size-3" aria-hidden />Edit
            </Link>
          )}
        </div>
      </header>

      {featured && (
        <aside
          className={[
            'mt-6 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:mt-0',
            // Sticky only where there is a column to be sticky in, and offset below the fixed header
            // so it can never slide underneath it. Capped well under the viewport so it cannot run
            // into the footer.
            'lg:sticky lg:top-20',
          ].join(' ')}
        >
          <ExpandableArticleImage
            src={featured.src}
            alt={featured.alt}
            caption={featured.caption}
            // Bounded so a tall archival graphic stays a preview rather than a wall. Smaller caps on
            // phones, where 70vh of image would push the article off the screen entirely.
            previewClassName="max-h-[18rem] xs:max-h-[22rem] sm:max-h-[25rem] lg:max-h-[70vh]"
          />
        </aside>
      )}

      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
      {/* ~70-80 characters at this size: the extra width goes to the media column, not the prose. */}
      <RichText doc={article.body} className="mt-8 max-w-[68ch] text-[0.975rem]" skipFirstMediaId={featured?.mediaId ?? null} />

      {article.tags.length > 0 && (
        <div className="mt-10 flex flex-wrap items-center gap-1.5 border-t border-border pt-5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Topics</span>
          {article.tags.map((t) => (
            <Link
              key={t.slug}
              href={`/news/tag/${t.slug}`}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-brand/40 hover:text-foreground"
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}
      </div>{/* /article text column */}
      </div>{/* /two-column grid */}

      <RelatedCompetitions relations={article.relations} />

      {article.commentsEnabled ? (
        <CommentThread
          articleId={article.id}
          comments={comments.map(toClient)}
          canComment={actor != null}
          isAdmin={!!actor?.isAdmin}
          locked={article.commentsLocked}
          signedIn={actor != null}
        />
      ) : null}

      {related.length > 0 && (
        <section className="mt-14 border-t border-border pt-8">
          <h2 className="mb-5 font-display text-xl font-bold tracking-tight">More from The Break</h2>
          <div className="grid gap-5 sm:grid-cols-3">
            {related.map((a) => <ArticleCardView key={a.id} article={a} />)}
          </div>
        </section>
      )}

      {/* Structured data, emitted only for a publicly visible article. */}
      {visible && (
        <script
          type="application/ld+json"
          // A JSON.stringify of values we control — no author input reaches this as markup.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd(article)) }}
        />
      )}
    </article>
  )
}

/** Competitions and players an article is about. Only rendered when the author linked something. */
function RelatedCompetitions({ relations }: { relations: Awaited<ReturnType<typeof getArticleById>> extends null ? never : NonNullable<Awaited<ReturnType<typeof getArticleById>>>['relations'] }) {
  const has = relations.seasons.length || relations.tournaments.length || relations.players.length || relations.competitions.length
  if (!has) return null

  return (
    <aside className="mt-8 rounded-lg border border-border bg-card/40 p-4">
      <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Referenced</h2>
      <div className="flex flex-wrap gap-1.5 text-sm">
        {relations.seasons.map((s) => (
          <Link key={`s${s.id}`} href={`/seasons/${s.id}`} className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-brand/40 hover:text-brand">
            Season {s.number} · {s.competitionYear}
          </Link>
        ))}
        {relations.tournaments.map((t) => (
          <Link key={`t${t.id}`} href={`/tournaments/${t.id}`} className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-brand/40 hover:text-brand">
            {t.name}
          </Link>
        ))}
        {relations.players.map((p) => (
          <Link key={`p${p.id}`} href={`/players/${p.cueverseId ?? p.id}`} className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-brand/40 hover:text-brand">
            {p.cueverseId ?? p.primaryName}
          </Link>
        ))}
      </div>
    </aside>
  )
}

/** Dates cross to the client as ISO strings; the tree shape is otherwise unchanged. */
function toClient(c: CommentView): ClientComment {
  return {
    ...c,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt ? c.editedAt.toISOString() : null,
    replies: c.replies.map(toClient),
  }
}

function articleJsonLd(article: NonNullable<Awaited<ReturnType<typeof getArticleById>>>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.excerpt ?? undefined,
    datePublished: article.publishAt?.toISOString(),
    dateModified: article.updatedAt.toISOString(),
    author: { '@type': 'Person', name: article.author.handle ?? article.author.name },
    publisher: { '@type': 'Organization', name: brandName },
    mainEntityOfPage: absoluteUrl(`/news/${article.slug}`),
    image: article.coverMediaId ? absoluteUrl(`/api/media/file/${article.coverMediaId}`) : undefined,
  }
}
