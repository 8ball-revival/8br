import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { prisma } from '@/lib/prisma'
import { slugKeyOf } from '@/lib/editorial/slug-format'
import { serializeArticleBody, sanitizeDocument, type RichDocument } from '@/lib/editorial/richtext'
import { currentBreakActor, manageBasis, canMarkOfficial } from '@/lib/break/permissions'
import { PostEditor } from '@/components/break/post-editor'
import type { PostType } from '@/lib/break/post-types'

export const dynamic = 'force-dynamic'

/**
 * Editing a post.
 *
 * The gate is here as well as in the action, and it is the same predicate in both places. This one
 * decides whether the page exists for you; the action decides whether the write is accepted. A
 * visitor who is not entitled gets the ordinary not-found rather than a refusal, because "you may
 * not edit this" tells somebody probing that the thing is there and worth probing.
 */
export default async function EditPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const actor = await currentBreakActor()
  if (!actor) redirect(`/login?next=${encodeURIComponent(`/the-break/${slug}/edit`)}`)

  const post = await prisma.breakPost.findUnique({
    where: { slugKey: slugKeyOf(slug) },
    select: {
      id: true, slug: true, title: true, type: true, state: true, linkUrl: true,
      spoiler: true, sensitive: true, official: true, body: true,
      authorPlayerId: true, authorHandleSnapshot: true, authorNameSnapshot: true,
    },
  })
  if (!post) notFound()
  if (!manageBasis(actor, post.authorPlayerId)) notFound()

  const href = `/the-break/${post.slug}`

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link href={href} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden /> Back to the post
      </Link>

      <h1 className="font-display text-xl font-bold text-foreground">Edit post</h1>
      {/*
        Whose post this is, stated plainly on a page where somebody may be editing another member's
        writing. Editing it does not make it theirs, and the byline will not change when they save.
      */}
      <p className="mt-1 text-sm text-muted-foreground">
        Written by{' '}
        <span className="font-medium text-foreground">{post.authorHandleSnapshot ?? '—'}</span>
        {post.authorNameSnapshot && <span> · {post.authorNameSnapshot}</span>}
        . Attribution does not change when you save.
      </p>

      <div className="mt-5 rounded-none border border-border bg-card p-4">
        <PostEditor
          postId={post.id}
          slug={post.slug}
          canMarkOfficial={canMarkOfficial(actor)}
          returnTo={href}
          initial={{
            title: post.title,
            type: post.type as PostType,
            linkUrl: post.linkUrl,
            spoiler: post.spoiler,
            sensitive: post.sensitive,
            official: post.official,
            /*
             * Serialised from the stored node tree, not from bodyText. bodyText is a lossy plain-text
             * projection for search; editing it would throw away every link, list and image.
             */
            bodySource: serializeArticleBody(sanitizeDocument(post.body as unknown as RichDocument)),
          }}
        />
      </div>
    </main>
  )
}
