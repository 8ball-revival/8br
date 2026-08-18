import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { pageMetadata } from '@/lib/site'
import { prisma } from '@/lib/prisma'
import {
  currentEditorialActor, canCreateArticle, canPublishNow, canAttributeAuthor, canBackdate,
} from '@/lib/editorial/permissions'
import { listBylineCandidates } from '@/lib/editorial/queries'
import { ArticleEditor, type EditorArticle } from '@/components/editorial/article-editor'
import { giphyConfigured } from '@/lib/media/giphy'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'Write an article',
  description: 'Write for The Break, the 8 Ball Registry news section.',
  path: '/news/new',
  index: false,
})

const BLANK = {
  id: null, title: '', slug: '', bodySource: '', excerpt: '', categoryId: null, tags: [] as string[],
  coverMediaId: null, coverAlt: '', seoTitle: '', seoDescription: '',
  official: false, featured: false, commentsEnabled: true,
  state: 'DRAFT', publishAt: null, reviewFeedback: null, hasPendingEdit: false,
}

export default async function NewArticlePage() {
  const actor = await currentEditorialActor()
  // Signing in is the whole gate for starting a draft; what happens to it afterwards is where the
  // permissions live.
  if (!canCreateArticle(actor)) redirect('/login?next=/news/new')

  const mayAttribute = canAttributeAuthor(actor)
  const [categories, members] = await Promise.all([
    prisma.articleCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, adminOnly: true },
    }),
    // The roster is loaded only for somebody entitled to use it — there is no reason to ship a list
    // of every member to a browser that cannot do anything with it.
    mayAttribute ? listBylineCandidates() : Promise.resolve([]),
  ])

  const initial: EditorArticle = {
    ...BLANK,
    authorPlayerId: actor!.playerId,
    authorLabel: actor!.handle ?? actor!.name,
  }

  return (
    <ArticleEditor
      initial={initial}
      categories={categories}
      canPublish={await canPublishNow(actor, actor!.playerId)}
      isAdmin={!!actor!.isAdmin}
      members={members}
      canAttributeAuthor={mayAttribute}
      canBackdate={canBackdate(actor)}
      giphyEnabled={giphyConfigured()}
      selfPlayerId={actor!.playerId}
    />
  )
}
