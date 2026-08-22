import type { Metadata } from 'next'

import { requireCreator } from '@/lib/creator/access'
import { listSeasons } from '@/lib/creator/landing'
import { CompletedRecordList } from '@/components/creator/record-lists'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Completed Seasons · Creator', robots: { index: false } }

/** Finished Seasons. Opening one shows it read-only, with reopening as a deliberate act. */
export default async function ModifyCompletedSeasons() {
  await requireCreator()
  return (
    <CompletedRecordList
      title="Completed Seasons"
      blurb="Finished and counted. Open one to review it, or reopen it to correct."
      rows={await listSeasons('completed')}
    />
  )
}
