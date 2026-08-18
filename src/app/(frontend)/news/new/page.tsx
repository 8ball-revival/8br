import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { pageMetadata } from '@/lib/site'
import { prisma } from '@/lib/prisma'
import { currentEditorialActor, canCreateArticle, canPublishNow } from '@/lib/editorial/permissions'
import { ArticleEditor, type EditorArticle } from '@/components/editorial/article-editor'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'Write an article',
  description: 'Write for The Break, the 8 Ball Registry news section.',
  path: '/news/new',
  index: false,
})

const BLANK: EditorArticle = {
  id: null, title: '', slug: '', bodySource: '', excerpt: '', categoryId: null, tags: [],
  coverMediaId: null, coverAlt: '', seoTitle: '', seoDescription: '',
  official: false, featured: false, commentsEnabled: true,
  state: 'DRAFT', publishAt: null, reviewFeedback: null, hasPendingEdit: false,
}

export default async function NewArticlePage() {
  const actor = await currentEditorialActor()
  // Signing in is the whole gate for starting a draft; what happens to it afterwards is where the
  // permissions live.
  if (!canCreateArticle(actor)) redirect('/login?next=/news/new')

  const categories = await prisma.articleCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, adminOnly: true },
  })

  return (
    <ArticleEditor
      initial={BLANK}
      categories={categories}
      canPublish={await canPublishNow(actor, actor!.playerId)}
      isAdmin={!!actor!.isAdmin}
    />
  )
}
