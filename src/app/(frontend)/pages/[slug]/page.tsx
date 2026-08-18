import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { pageMetadata } from '@/lib/site'
import { formatDate } from '@/lib/format'
import { RichText } from '@/components/editorial/rich-text'
import { getPublicPage } from '@/lib/editorial/pages'
import { documentToPlainText } from '@/lib/editorial/richtext'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPublicPage((await params).slug)
  // An unpublished page must not leak its title into a tab or a link preview.
  if (!page) return { title: 'Not found', robots: { index: false, follow: false } }

  return pageMetadata({
    title: page.seoTitle || page.title,
    description: page.seoDescription || page.excerpt || documentToPlainText(page.body).slice(0, 200),
    path: `/pages/${page.slug}`,
  })
}

/**
 * A standalone page — About, FAQ and the like.
 *
 * Same body format and renderer as an article, deliberately without the news furniture: no byline,
 * no category, no related articles, no feed. A page is a page.
 */
export default async function StandalonePage({ params }: Props) {
  const page = await getPublicPage((await params).slug)
  if (!page) notFound()

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        {page.title}
      </h1>
      {page.excerpt && <p className="mt-3 text-lg text-muted-foreground">{page.excerpt}</p>}

      <RichText doc={page.body} className="mt-8 text-[0.975rem]" />

      <p className="mt-12 border-t border-border pt-4 text-xs text-muted-foreground">
        Last updated {formatDate(page.updatedAt.toISOString())}
      </p>
    </article>
  )
}
