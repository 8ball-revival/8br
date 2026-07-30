import type { Metadata } from 'next'

import { pageMetadata } from '@/lib/site'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { NewsCard } from '@/components/news-card'
import { news } from '@/lib/mock-data'

export const metadata: Metadata = pageMetadata({
  title: 'News',
  description: 'Announcements and updates from 8 Ball Revival.',
  path: '/news',
})

export default function NewsPage() {
  const [featured, ...rest] = news

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'News' }]}
        title="News"
        description="Announcements, competition updates, and notes from the organization."
        sample
      />
      <Container className="py-12">
        {featured && (
          <div className="mb-8">
            <NewsCard item={featured} featured />
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {rest.map((item) => (
            <NewsCard key={item.slug} item={item} />
          ))}
        </div>
      </Container>
    </>
  )
}
