import type { Metadata } from 'next'

import { requireCreator } from '@/lib/creator/access'
import { listTournaments } from '@/lib/creator/landing'
import { CompletedRecordList } from '@/components/creator/record-lists'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Completed Tournaments · Creator', robots: { index: false } }

/** Finished Tournaments. Opening one shows it read-only, with reopening as a deliberate act. */
export default async function ModifyCompletedTournaments() {
  await requireCreator()
  return (
    <CompletedRecordList
      title="Completed Tournaments"
      blurb="Finished and counted. Open one to review it, or reopen it to correct."
      rows={await listTournaments('completed')}
    />
  )
}
