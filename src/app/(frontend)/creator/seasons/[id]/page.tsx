import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { Wide } from '@/components/primitives'
import { RecordDetail } from '@/components/creator/record-detail'
import { requireCreator } from '@/lib/creator/access'
import { completionReview } from '@/lib/competition/correction'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Season · Creator', robots: { index: false } }

/**
 * One Season inside Creator.
 *
 * Authorisation is re-checked here rather than left to an ancestor: a layout gate does not run for
 * this page's own data fetch, and this page's data is the record itself.
 *
 * The page is a READ. `completionReview` opens no transaction and writes nothing, so merely opening
 * a completed Season cannot move it, change the Rankings, or leave an audit trail suggesting
 * somebody did something they did not.
 */
export default async function CreatorSeasonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireCreator()
  const { id: raw } = await params
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const review = await completionReview('season', id)
  if (!review) notFound()

  return (
    <Wide name="creator-season" className="py-6">
      <Link
        href="/creator/completed"
        className="mb-3 inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        <ArrowLeft className="size-3.5" aria-hidden />Completed records
      </Link>

      <RecordDetail
        review={review}
        publicHref={`/seasons/${id}`}
        // Corrections happen on the EXISTING management surfaces. There is no second Season editor:
        // building one would mean two places where a result can be changed, and two chances for
        // them to disagree.
        sections={[
          { label: 'Setup', href: `/seasons/${id}/settings`, hint: 'Title, year, division, description, match format' },
          { label: 'Groups', href: `/seasons/${id}?view=groups`, hint: 'Group tables and group results' },
          { label: 'Playoffs', href: `/seasons/${id}?view=playoffs`, hint: 'Bracket placement and playoff results' },
        ]}
      />
    </Wide>
  )
}
