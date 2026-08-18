import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { pageMetadata } from '@/lib/site'
import { ArticleListing } from '@/components/editorial/article-listing'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ year: string }>; searchParams: Promise<{ page?: string }> }

/** Only a plausible four-digit year is a page; anything else is not a URL this section has. */
function parseYear(raw: string): number | null {
  const year = Number.parseInt(raw, 10)
  return /^\d{4}$/.test(raw) && year >= 1900 && year <= 2200 ? year : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const year = parseYear((await params).year)
  if (!year) return { title: 'Not found', robots: { index: false, follow: false } }
  return pageMetadata({
    title: `${year} · News archive`,
    description: `Everything published in ${year} in The Break, the 8 Ball Registry news section.`,
    path: `/news/archive/${year}`,
  })
}

export default async function ArchiveYearPage({ params, searchParams }: Props) {
  const year = parseYear((await params).year)
  if (!year) notFound()
  const page = Number.parseInt((await searchParams).page ?? '1', 10) || 1

  return (
    <ArticleListing
      filters={{ page, year }}
      heading={String(year)}
      lede={`Everything published in ${year}.`}
      emptyMessage={`Nothing was published in ${year}.`}
      hrefFor={(p) => `/news/archive/${year}?page=${p}`}
    />
  )
}
