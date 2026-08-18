import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { pageMetadata } from '@/lib/site'
import { ArticleListing } from '@/components/editorial/article-listing'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const tag = await prisma.articleTag.findUnique({ where: { slug: slug.toLowerCase() }, select: { name: true, slug: true } })
  if (!tag) return { title: 'Not found', robots: { index: false, follow: false } }
  return pageMetadata({
    title: `${tag.name} · News`,
    description: `Articles tagged ${tag.name} in The Break, the 8 Ball Registry news section.`,
    path: `/news/tag/${tag.slug}`,
  })
}

export default async function TagPage({ params, searchParams }: Props) {
  const { slug } = await params
  const tag = await prisma.articleTag.findUnique({ where: { slug: slug.toLowerCase() }, select: { name: true, slug: true } })
  if (!tag) notFound()

  const page = Number.parseInt((await searchParams).page ?? '1', 10) || 1

  return (
    <ArticleListing
      filters={{ page, tagSlug: tag.slug }}
      heading={tag.name}
      lede={`Articles tagged “${tag.name}”.`}
      emptyMessage="Nothing is tagged with this yet."
      hrefFor={(p) => `/news/tag/${tag.slug}?page=${p}`}
    />
  )
}
