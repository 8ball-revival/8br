import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { pageMetadata } from '@/lib/site'
import { ArticleListing } from '@/components/editorial/article-listing'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ year: string; month: string }>; searchParams: Promise<{ page?: string }> }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function parse(rawYear: string, rawMonth: string): { year: number; month: number } | null {
  const year = Number.parseInt(rawYear, 10)
  const month = Number.parseInt(rawMonth, 10)
  if (!/^\d{4}$/.test(rawYear) || year < 1900 || year > 2200) return null
  if (!/^\d{1,2}$/.test(rawMonth) || month < 1 || month > 12) return null
  return { year, month }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params
  const parsed = parse(p.year, p.month)
  if (!parsed) return { title: 'Not found', robots: { index: false, follow: false } }
  const label = `${MONTHS[parsed.month - 1]} ${parsed.year}`
  return pageMetadata({
    title: `${label} · News archive`,
    description: `Everything published in ${label} in The Break, the 8 Ball Registry news section.`,
    path: `/news/archive/${parsed.year}/${String(parsed.month).padStart(2, '0')}`,
  })
}

export default async function ArchiveMonthPage({ params, searchParams }: Props) {
  const p = await params
  const parsed = parse(p.year, p.month)
  if (!parsed) notFound()
  const page = Number.parseInt((await searchParams).page ?? '1', 10) || 1
  const label = `${MONTHS[parsed.month - 1]} ${parsed.year}`
  const path = `/news/archive/${parsed.year}/${String(parsed.month).padStart(2, '0')}`

  return (
    <ArticleListing
      filters={{ page, year: parsed.year, month: parsed.month }}
      heading={label}
      lede={`Everything published in ${label}.`}
      emptyMessage={`Nothing was published in ${label}.`}
      hrefFor={(n) => `${path}?page=${n}`}
    />
  )
}
