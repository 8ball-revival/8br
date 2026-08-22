import type { Metadata } from 'next'

import { requireCreator } from '@/lib/creator/access'
import { listTournaments } from '@/lib/creator/landing'
import { OpenRecordList } from '@/components/creator/record-lists'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Open Tournaments · Creator', robots: { index: false } }

/** Tournaments still being run. Each opens at the stage it has actually reached. */
export default async function ManageOpenTournaments() {
  await requireCreator()
  return (
    <OpenRecordList
      title="Open Tournaments"
      blurb="Everything not yet completed. Opening one resumes at its current stage."
      rows={await listTournaments('open')}
      emptyHref="/creator/tournaments/new"
      emptyLabel="Create a Tournament"
    />
  )
}
