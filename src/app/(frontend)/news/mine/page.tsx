import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PenLine, MessageSquare, Eye } from 'lucide-react'

import { pageMetadata } from '@/lib/site'
import { formatDateTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { NewsShell, NewsEmpty } from '@/components/editorial/news-shell'
import { listMyArticles, listCategories, getModerationQueue } from '@/lib/editorial/queries'
import { currentEditorialActor } from '@/lib/editorial/permissions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'My articles',
  description: 'Your drafts, submissions and published articles in The Break.',
  path: '/news/mine',
  index: false,
})

export default async function MyArticlesPage() {
  const actor = await currentEditorialActor()
  if (!actor) redirect('/login?next=/news/mine')

  const [articles, categories] = await Promise.all([listMyArticles(actor), listCategories(false)])
  const queue = actor.isAdmin ? await getModerationQueue() : null

  return (
    <NewsShell
      chrome={{ categories, canWrite: true, isAdmin: actor.isAdmin, pendingCount: queue?.total }}
      heading="My articles"
      lede={actor.isTrustedAuthor
        ? 'You are a Trusted Author — your articles go live as soon as you publish them.'
        : 'Articles are reviewed before they appear on the site.'}
    >
      {articles.length === 0 ? (
        <div className="mt-8">
          <NewsEmpty message="You have not written anything yet." />
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-none border border-border">
          {articles.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/news/${a.slug}/edit`} className="truncate font-medium hover:text-brand">
                    {a.title}
                  </Link>
                  <StateBadge state={a.state} publishAt={a.publishAt} />
                  {a.pendingSubmittedAt && <Badge variant="muted">Edit awaiting review</Badge>}
                  {a.official && <Badge variant="gold">Official</Badge>}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {a.category && <span>{a.category.name}</span>}
                  <span>Updated {formatDateTime(a.updatedAt.toISOString())}</span>
                  {a.viewCount > 0 && <span className="inline-flex items-center gap-1"><Eye className="size-3" aria-hidden />{a.viewCount}</span>}
                  {a.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3" aria-hidden />{a.commentCount}</span>}
                </p>
                {a.reviewFeedback && a.state === 'REJECTED' && (
                  <p className="mt-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-foreground/90">
                    <span className="font-medium text-warning">Feedback: </span>{a.reviewFeedback}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {a.state === 'PUBLISHED' && (
                  <Link href={`/news/${a.slug}`} className="text-muted-foreground hover:text-brand">View</Link>
                )}
                <Link href={`/news/${a.slug}/edit`} className="inline-flex items-center gap-1 text-brand hover:underline">
                  <PenLine className="size-3" aria-hidden />Edit
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </NewsShell>
  )
}

function StateBadge({ state, publishAt }: { state: string; publishAt: Date | null }) {
  if (state === 'PUBLISHED' && publishAt && publishAt > new Date()) return <Badge variant="muted">Scheduled</Badge>
  switch (state) {
    case 'PUBLISHED': return <Badge variant="success">Published</Badge>
    case 'PENDING_REVIEW': return <Badge variant="gold">Awaiting review</Badge>
    case 'REJECTED': return <Badge variant="muted">Needs changes</Badge>
    case 'ARCHIVED': return <Badge variant="muted">Archived</Badge>
    default: return <Badge variant="muted">Draft</Badge>
  }
}
