import type { Metadata } from 'next'
import Link from 'next/link'

import { pageMetadata } from '@/lib/site'
import { formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { NewsShell, NewsEmpty } from '@/components/editorial/news-shell'
import { listAuthors, listCategories, getModerationQueue } from '@/lib/editorial/queries'
import { currentEditorialActor } from '@/lib/editorial/permissions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'Authors · News',
  description: 'Everybody writing for The Break, the 8 Ball Registry news section.',
  path: '/news/authors',
})

export default async function AuthorsPage() {
  const actor = await currentEditorialActor()
  const [authors, categories] = await Promise.all([listAuthors(), listCategories(false)])
  const queue = actor?.isAdmin ? await getModerationQueue() : null

  return (
    <NewsShell
      chrome={{ categories, canWrite: actor != null, isAdmin: !!actor?.isAdmin, pendingCount: queue?.total }}
      heading="Authors"
      lede="Everybody who has published an article."
    >
      {authors.length === 0 ? (
        <div className="mt-8"><NewsEmpty message="Nobody has published an article yet." /></div>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {authors.map((a) => {
            const label = a.handle ?? a.name
            return (
              <li key={a.playerId}>
                <Link
                  href={`/news/author/${encodeURIComponent(label)}`}
                  className="flex flex-col rounded-none border border-border bg-card/40 p-4 transition-colors hover:border-brand/40"
                >
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {label}
                    {a.trusted && <Badge variant="gold">Trusted Author</Badge>}
                  </span>
                  {a.handle && a.name !== a.handle && (
                    <span className="mt-0.5 text-xs text-muted-foreground">{a.name}</span>
                  )}
                  <span className="mt-2 text-xs text-muted-foreground">
                    {a.articleCount} article{a.articleCount === 1 ? '' : 's'}
                    {a.lastPublishedAt && <> · last {formatDate(a.lastPublishedAt.toISOString())}</>}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </NewsShell>
  )
}
