import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { news } from '@/lib/mock-data'
import { formatDate } from '@/lib/format'

type Params = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return news.map((n) => ({ slug: n.slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const item = news.find((n) => n.slug === slug)
  if (!item) return { title: 'Article not found' }
  return { title: item.title, description: item.excerpt }
}

export default async function NewsArticlePage({ params }: Params) {
  const { slug } = await params
  const item = news.find((n) => n.slug === slug)
  if (!item) notFound()

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'News', href: '/news' },
          { label: item.title },
        ]}
        title={item.title}
        description={`${item.category} · ${formatDate(item.date)}`}
        actions={<Badge variant="muted">Preview</Badge>}
      />
      <Container className="py-10">
        <article className="max-w-2xl">
          <p className="text-lg text-muted-foreground">{item.excerpt}</p>
          <p className="mt-8 rounded-lg border border-dashed border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
            Full article content is pending. News will be authored and published from the CMS.
          </p>
        </article>
      </Container>
    </>
  )
}
