import { ArticleCardView } from '@/components/editorial/article-card'
import { NewsShell, NewsEmpty, Pagination } from '@/components/editorial/news-shell'
import { listArticles, listCategories, getModerationQueue, type ListFilters } from '@/lib/editorial/queries'
import { currentEditorialActor } from '@/lib/editorial/permissions'

/**
 * A filtered listing — a category, a tag, an author, a month.
 *
 * All four are the same page with a different heading and a different filter, so they share one
 * implementation. Writing them separately is how four pages end up disagreeing about pagination.
 */
export async function ArticleListing({
  filters,
  heading,
  lede,
  emptyMessage,
  hrefFor,
  activeCategory,
}: {
  filters: ListFilters
  heading: React.ReactNode
  lede?: React.ReactNode
  emptyMessage: string
  hrefFor: (page: number) => string
  activeCategory?: string | null
}) {
  const actor = await currentEditorialActor()
  const [result, categories] = await Promise.all([listArticles(filters), listCategories(false)])
  const queue = actor?.isAdmin ? await getModerationQueue() : null

  return (
    <NewsShell
      chrome={{
        categories,
        activeCategory,
        canWrite: actor != null,
        isAdmin: !!actor?.isAdmin,
        pendingCount: queue?.total,
      }}
      heading={heading}
      lede={lede}
    >
      {result.items.length === 0 ? (
        <div className="mt-8"><NewsEmpty message={emptyMessage} /></div>
      ) : (
        <div className="mt-8">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((a) => <ArticleCardView key={a.id} article={a} />)}
          </div>
          <Pagination page={result.page} pageCount={result.pageCount} hrefFor={hrefFor} />
        </div>
      )}
    </NewsShell>
  )
}
