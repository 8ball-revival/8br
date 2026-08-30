import { BuilderPage } from '@/components/site-builder/edit-mode'
import type { Metadata } from 'next'
import { getPostBySlug } from '@/lib/break/posts'


/**
 * `/the-break/[slug]/page.tsx` -- governed by the `article` template.
 *
 * The body moved to `@/components/system/article-detail-body` and is placed by the template as a system
 * module, so one layout describes every Article page: an administrator can put an announcement above
 * every Season at once, or restyle the frame, without touching a single Season's data.
 *
 * `generateMetadata` stays here because Next only reads it from a route file.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug, null)
  if (!post) return { title: 'The Break' }
  return {
    title: post.title,
    description: (post.bodyText ?? '').slice(0, 160) || 'A post on The Break.',
    // Canonical points at the post's CURRENT slug, so a retired URL and the live one are not two
    // pages as far as a search engine is concerned.
    alternates: { canonical: `/the-break/${post.slug}` },
  }
}

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <BuilderPage
      pageKey="article"
      pageTitle="Article"
      routeParams={params as Promise<Record<string, string>>}
      searchParams={searchParams as Promise<Record<string, string | string[] | undefined>>}
      entityId={undefined}
    />
  )
}
