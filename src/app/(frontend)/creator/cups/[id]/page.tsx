import { redirect, notFound } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { requireCreator } from '@/lib/creator/access'
import { currentStage } from '@/lib/creator/workflow'

/**
 * The old Creator "cups" link, pointed at where Tournament management actually lives.
 *
 * It used to send the reader to the PUBLIC Tournament page, which was correct while that page was
 * the management interface. It is not any more — public Tournament pages are read-only — so a
 * management bookmark that lands there would leave somebody looking at a record they came to edit.
 *
 * It resolves to the record's CURRENT stage rather than a fixed one, so an old link behaves like
 * every other way into Creator. The Creator gate applies here too: this route is administrative, so
 * it answers a not-found to anybody who may not manage competitions.
 */
export const dynamic = 'force-dynamic'

export default async function CreatorCupRedirect({ params }: { params: Promise<{ id: string }> }) {
  await requireCreator()
  const { id } = await params
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) notFound()
  const t = await prisma.tournament.findUnique({
    where: { id: n },
    select: { id: true, lifecycleState: true, tournamentFormat: true },
  })
  if (!t) notFound()
  const stage = currentStage('tournament', String(t.lifecycleState), String(t.tournamentFormat ?? 'SINGLE_ELIM'))
  redirect(`/creator/tournaments/${t.id}/${stage}`)
}
