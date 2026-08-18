import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { pageMetadata } from '@/lib/site'
import { ArticleListing } from '@/components/editorial/article-listing'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }

async function category(slug: string) {
  return prisma.articleCategory.findUnique({
    where: { slug: slug.toLowerCase() },
    select: { slug: true, name: true, description: true, active: true },
  })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await category((await params).slug)
  if (!c) return { title: 'Not found', robots: { index: false, follow: false } }
  return pageMetadata({
    title: `${c.name} · News`,
    description: c.description ?? `${c.name} from The Break, the 8 Ball Registry news section.`,
    path: `/news/category/${c.slug}`,
  })
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params
  const c = await category(slug)
  // An inactive category stops being a destination as well as an option, so an old link 404s rather
  // than showing a page that cannot be filed under any more.
  if (!c || !c.active) notFound()

  const page = Number.parseInt((await searchParams).page ?? '1', 10) || 1

  return (
    <ArticleListing
      filters={{ page, categorySlug: c.slug }}
      activeCategory={c.slug}
      heading={c.name}
      lede={c.description ?? undefined}
      emptyMessage={`Nothing has been published under ${c.name} yet.`}
      hrefFor={(p) => `/news/category/${c.slug}?page=${p}`}
    />
  )
}
