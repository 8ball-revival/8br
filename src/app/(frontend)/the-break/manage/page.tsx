import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { currentBreakActor, canManageTheBreak } from '@/lib/break/permissions'
import { listManagedPosts } from '@/lib/break/post-actions'
import { ManagePostsTable } from '@/components/break/manage-posts-table'

export const dynamic = 'force-dynamic'

/**
 * Every post in The Break, in one list, for whoever holds `manage_the_break`.
 *
 * Not found rather than forbidden for anyone else: a management route that answers "you may not"
 * confirms it is there. The list itself is fetched through a server action that applies the same
 * capability, so the page and its data agree even if one of them is reached another way.
 */
export default async function ManageBreakPage() {
  const actor = await currentBreakActor()
  if (!canManageTheBreak(actor)) notFound()

  const { posts } = await listManagedPosts()

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <Link href="/the-break" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> The Break
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl font-bold text-foreground">Manage posts</h1>
        <p className="text-sm text-muted-foreground">{posts.length} post{posts.length === 1 ? '' : 's'}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Every post, including withdrawn ones and drafts. Editing here does not change who wrote a post.
      </p>

      <div className="mt-5">
        <ManagePostsTable posts={posts} />
      </div>
    </main>
  )
}
