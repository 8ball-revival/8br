import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { RichText } from '@/components/editorial/rich-text'
import { formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { readPreviewToken } from '@/lib/editorial/preview'
import { getArticleById } from '@/lib/editorial/queries'

export const dynamic = 'force-dynamic'

type SP = { searchParams: Promise<{ token?: string }> }

/**
 * Never indexed, and the title never names the article.
 *
 * The link IS the credential, so putting the article's title in a `<title>` tag would hand it to
 * anything that follows the URL without holding the token — a chat app unfurling the link, a proxy,
 * a browser's history sync. A bad token reports "Not found" for the same reason every other route
 * does: an invalid preview link should look exactly like a URL that never existed.
 */
export async function generateMetadata({ searchParams }: SP): Promise<Metadata> {
  const { token } = await searchParams
  const valid = token ? readPreviewToken(token) != null : false
  return {
    title: valid ? 'Preview' : 'Not found',
    robots: { index: false, follow: false, nocache: true },
  }
}

export default async function PreviewPage({ searchParams }: SP) {
  const { token } = await searchParams
  const claim = token ? readPreviewToken(token) : null
  // A bad, forged or expired token is a 404 — indistinguishable from a URL that never existed.
  if (!claim) notFound()

  const article = await getArticleById(claim.articleId)
  if (!article || article.state === 'SOFT_DELETED') notFound()

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 rounded-md border border-brand/40 bg-[var(--selected-surface)] px-4 py-3 text-sm">
        <p className="font-medium text-brand">Preview</p>
        <p className="mt-0.5 text-muted-foreground">
          A private link to an unpublished article. It expires, and it grants access to nothing else.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="muted">{article.state.toLowerCase().replace('_', ' ')}</Badge>
        {article.category && <Badge variant="muted">{article.category.name}</Badge>}
      </div>

      <h1 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        {article.title}
      </h1>

      {article.excerpt && <p className="mt-3 text-lg text-muted-foreground">{article.excerpt}</p>}

      <p className="mt-5 border-y border-border py-3 text-xs text-muted-foreground">
        By {article.author.handle ?? article.author.name}
        {article.publishAt && <> · {formatDate(article.publishAt.toISOString())}</>}
        {' · '}{article.readingMinutes} min read
      </p>

      {article.coverMediaId && (
        // eslint-disable-next-line @next/next/no-img-element -- Payload media, not a static asset
        <img
          src={`/api/media/file/${article.coverMediaId}`}
          alt={article.coverAlt ?? ''}
          className="mt-6 w-full rounded-lg border border-border"
        />
      )}

      <RichText doc={article.body} className="mt-8 text-[0.975rem]" skipFirstMediaId={article.coverMediaId} />
    </article>
  )
}
