import { redirect, notFound } from 'next/navigation'

import { prisma } from '@/lib/prisma'

/**
 * The Tournament workspace moved back into the Tournaments section.
 *
 * Creator's business is Seasons and their historical reconstruction. Running a Tournament from a
 * second place meant two screens that had to agree about the same record, and an administrator
 * leaving the section they were working in to reach the only thing it is about. This keeps the old
 * link alive rather than 404ing a bookmark.
 *
 * The id in this URL is the INTERNAL row id; the public route is addressed by tournament number, so
 * the mapping is looked up rather than assumed. A row with no number has never been published and
 * has no public address, so that 404s honestly instead of guessing one.
 */
export const dynamic = 'force-dynamic'

export default async function CreatorTournamentRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) notFound()
  const t = await prisma.tournament.findUnique({ where: { id: n }, select: { number: true } })
  if (t?.number == null) notFound()
  redirect(`/tournaments/${t.number}`)
}
