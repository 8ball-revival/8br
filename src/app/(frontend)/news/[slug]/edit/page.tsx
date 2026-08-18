import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { pageMetadata } from '@/lib/site'
import { prisma } from '@/lib/prisma'
import { resolveSlug } from '@/lib/editorial/slug'
import { listRevisions, listBylineCandidates } from '@/lib/editorial/queries'
import { serializeArticleBody, sanitizeDocument } from '@/lib/editorial/richtext'
import {
  currentEditorialActor, canEditArticle, canPublishNow, canAttributeAuthor, canBackdate,
} from '@/lib/editorial/permissions'
import { ArticleEditor, type EditorArticle } from '@/components/editorial/article-editor'
import { giphyConfigured } from '@/lib/media/giphy'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'Edit article',
  description: 'Edit an article in The Break.',
  path: '/news',
  index: false,
})

type Props = { params: Promise<{ slug: string }> }

export default async function EditArticlePage({ params }: Props) {
  const { slug } = await params
  const actor = await currentEditorialActor()
  if (!actor) redirect(`/login?next=/news/${encodeURIComponent(slug)}/edit`)

  const resolved = await resolveSlug(slug)
  if (!resolved) notFound()

  const row = await prisma.article.findUnique({
    where: { id: resolved.articleId },
    select: {
      id: true, title: true, slug: true, excerpt: true, body: true, categoryId: true,
      coverMediaId: true, coverAlt: true, seoTitle: true, seoDescription: true,
      official: true, featured: true, commentsEnabled: true, state: true, publishAt: true,
      reviewFeedback: true, pendingSubmittedAt: true, pendingBody: true, pendingTitle: true,
      pendingExcerpt: true, authorPlayerId: true,
      authorNameSnapshot: true, authorHandleSnapshot: true,
      authorPlayer: { select: { primaryName: true, cueverseId: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  })
  if (!row) notFound()
  // Not "403" — an article somebody may not edit should be indistinguishable from one that is not
  // there, so the editor cannot be used to discover what exists.
  if (!canEditArticle(actor, row.authorPlayerId)) notFound()
  if (row.state === 'SOFT_DELETED') notFound()

  const mayAttribute = canAttributeAuthor(actor)
  const [categories, revisions, members] = await Promise.all([
    prisma.articleCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, adminOnly: true },
    }),
    listRevisions(row.id),
    mayAttribute ? listBylineCandidates() : Promise.resolve([]),
  ])

  // Load a pending proposal back into the editor rather than the live text, so somebody returning to
  // finish an edit sees what they wrote and not what readers currently see.
  const pending = row.pendingSubmittedAt != null
  const initial: EditorArticle = {
    id: row.id,
    title: (pending ? row.pendingTitle : null) ?? row.title,
    slug: row.slug,
    bodySource: serializeArticleBody(sanitizeDocument(pending && row.pendingBody ? row.pendingBody : row.body)),
    excerpt: ((pending ? row.pendingExcerpt : null) ?? row.excerpt) ?? '',
    categoryId: row.categoryId,
    tags: row.tags.map((t) => t.tag.name),
    coverMediaId: row.coverMediaId,
    coverAlt: row.coverAlt ?? '',
    seoTitle: row.seoTitle ?? '',
    seoDescription: row.seoDescription ?? '',
    official: row.official,
    featured: row.featured,
    commentsEnabled: row.commentsEnabled,
    state: row.state,
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    reviewFeedback: row.reviewFeedback,
    hasPendingEdit: pending,
    // An article whose author has been archived keeps its snapshot byline; the picker falls back to
    // the signed-in user so saving cannot silently blank it.
    authorPlayerId: row.authorPlayerId ?? actor.playerId,
    authorLabel: row.authorPlayer?.cueverseId
      ?? row.authorHandleSnapshot
      ?? row.authorPlayer?.primaryName
      ?? row.authorNameSnapshot,
  }

  return (
    <ArticleEditor
      initial={initial}
      categories={categories}
      revisions={revisions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      canPublish={await canPublishNow(actor, row.authorPlayerId)}
      isAdmin={actor.isAdmin}
      members={members}
      canAttributeAuthor={mayAttribute}
      canBackdate={canBackdate(actor)}
      giphyEnabled={giphyConfigured()}
      selfPlayerId={actor.playerId}
    />
  )
}
