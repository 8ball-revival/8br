import type { Metadata } from 'next'

import { requireCreator } from '@/lib/creator/access'
import { listSeasons } from '@/lib/creator/landing'
import { OpenRecordList } from '@/components/creator/record-lists'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Open Seasons · Creator', robots: { index: false } }

/** Seasons still being run. Each opens at the stage it has actually reached. */
export default async function ManageOpenSeasons() {
  await requireCreator()
  return (
    <OpenRecordList
      title="Open Seasons"
      blurb="Everything not yet completed. Opening one resumes at its current stage."
      rows={await listSeasons('open')}
      emptyHref="/creator/seasons/new"
      emptyLabel="Create a Season"
    />
  )
}
