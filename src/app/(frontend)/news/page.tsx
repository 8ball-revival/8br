import type { Metadata } from 'next'
import Link from 'next/link'

import { pageMetadata } from '@/lib/site'
import { listArticles, listCategories, listTags, getModerationQueue, parseArticleSort, ARTICLE_SORTS } from '@/lib/editorial/queries'
import { currentEditorialActor } from '@/lib/editorial/permissions'
import { ArticleCardView } from '@/components/editorial/article-card'
import { NewsShell, NewsEmpty, Pagination, NEWS_SUBTITLE } from '@/components/editorial/news-shell'

// The index reflects scheduled articles becoming visible with the clock, so it is never statically
// cached — a page rendered a minute before an article was due would keep serving without it.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'News',
  description: `The Break — ${NEWS_SUBTITLE} From 8 Ball Registry.`,
  path: '/news',
})

type SP = { searchParams: Promise<{ page?: string; q?: string; sort?: string }> }

export default async function NewsIndexPage({ searchParams }: SP) {
  const sp = await searchParams
  const page = Number.parseInt(sp.page ?? '1', 10) || 1
  const search = (sp.q ?? '').trim()
  const sort = parseArticleSort(sp.sort)

  const actor = await currentEditorialActor()
  const [result, categories, tags] = await Promise.all([
    // Pins lead the index and only the index; on a filtered view they would silently reorder
    // somebody's search results.
    listArticles({ page, search, sort, honourPins: !search }),
    listCategories(false),
    listTags(18),
  ])
  const queue = actor?.isAdmin ? await getModerationQueue() : null

  const [lead, ...rest] = result.items
  const showLead = page === 1 && !search && sort === 'newest' && lead != null

  return (
    <NewsShell
      chrome={{
        categories,
        search,
        canWrite: actor != null,
        isAdmin: !!actor?.isAdmin,
        pendingCount: queue?.total,
      }}
      heading={search ? 'Search' : undefined}
      lede={search ? `${result.total} result${result.total === 1 ? '' : 's'} for “${search}”.` : undefined}
    >
      {/*
        Reading order. A link per option rather than a select, so each order is a real URL that can be
        shared and the page works without client JavaScript. The current search and any other state
        are carried across, so changing the order never silently drops a filter.
      */}
      {result.items.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Sort</span>
          {ARTICLE_SORTS.map((o) => {
            const params = new URLSearchParams()
            if (search) params.set('q', search)
            if (o.id !== 'newest') params.set('sort', o.id)
            const qs = params.toString()
            const active = o.id === sort
            return (
              <Link
                key={o.id}
                href={qs ? `/news?${qs}` : '/news'}
                aria-current={active ? 'true' : undefined}
                className={active
                  ? 'rounded-full border border-[var(--gold)]/50 bg-[var(--gold)]/10 px-2.5 py-1 font-medium text-foreground'
                  : 'rounded-full border border-border px-2.5 py-1 text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground'}
              >
                {o.label}
              </Link>
            )
          })}
        </div>
      )}

      {result.items.length === 0 ? (
        <div className="mt-8">
          <NewsEmpty
            message={search
              ? 'Nothing matched that search.'
              : 'No articles have been published yet. When members start writing, they will appear here.'}
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            {showLead && (
              <div className="mb-6">
                <ArticleCardView article={lead} size="lead" />
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              {(showLead ? rest : result.items).map((a) => (
                <ArticleCardView key={a.id} article={a} />
              ))}
            </div>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              hrefFor={(p) => `/news?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(p) })}`}
            />
          </div>

          <aside className="space-y-8">
            {tags.length > 0 && (
              <section>
                <h2 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Topics
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Link
                      key={t.slug}
                      href={`/news/tag/${t.slug}`}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-brand/40 hover:text-foreground"
                    >
                      {t.name}
                      <span className="ml-1 opacity-60">{t.articleCount}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Browse
              </h2>
              <ul className="space-y-1.5 text-sm">
                <li><Link href="/news/archive" className="text-muted-foreground hover:text-brand">Archive by month</Link></li>
                <li><Link href="/news/authors" className="text-muted-foreground hover:text-brand">Authors</Link></li>
                <li><Link href="/news/feed.xml" className="text-muted-foreground hover:text-brand">RSS feed</Link></li>
              </ul>
            </section>
          </aside>
        </div>
      )}
    </NewsShell>
  )
}
