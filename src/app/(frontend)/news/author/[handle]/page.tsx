import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { pageMetadata } from '@/lib/site'
import { ArticleListing } from '@/components/editorial/article-listing'
import { expandCanonicalPlayerIds } from '@/lib/players/merge'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<{ page?: string }> }

/**
 * Resolve an author from the handle in the URL.
 *
 * Matched on the case-insensitive CueVerse ID first, because that is the identity the site shows
 * everywhere, and on the preferred name only as a fallback for a profile that has no handle yet.
 */
async function author(handle: string) {
  const key = decodeURIComponent(handle).trim().toLowerCase()
  if (!key) return null
  return prisma.player.findFirst({
    where: {
      OR: [{ cueverseIdNormalized: key }, { primaryName: { equals: key, mode: 'insensitive' } }],
    },
    select: { id: true, primaryName: true, cueverseId: true, blogTrustedAuthor: true },
  })
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await author((await params).handle)
  if (!p) return { title: 'Not found', robots: { index: false, follow: false } }
  const label = p.cueverseId ?? p.primaryName
  return pageMetadata({
    title: `${label} · News`,
    description: `Articles written by ${label} for The Break, the 8 Ball Registry news section.`,
    path: `/news/author/${encodeURIComponent(label)}`,
  })
}

export default async function AuthorPage({ params, searchParams }: Props) {
  const { handle } = await params
  const p = await author(handle)
  if (!p) notFound()

  const page = Number.parseInt((await searchParams).page ?? '1', 10) || 1
  const label = p.cueverseId ?? p.primaryName
  // Include anything written under a profile that has since been merged into this one, so a member's
  // back catalogue does not split in half at the merge.
  const authorPlayerIds = await expandCanonicalPlayerIds(p.id)

  return (
    <ArticleListing
      filters={{ page, authorPlayerIds }}
      heading={label}
      lede={
        <>
          Articles by {label}
          {p.cueverseId && p.primaryName !== p.cueverseId && <span className="opacity-70"> ({p.primaryName})</span>}.
          {' '}
          <Link href={`/players/${encodeURIComponent(p.cueverseId ?? p.id)}`} className="text-brand hover:underline">Player profile</Link>
        </>
      }
      emptyMessage={`${label} has not published anything yet.`}
      hrefFor={(n) => `/news/author/${encodeURIComponent(label)}?page=${n}`}
    />
  )
}
