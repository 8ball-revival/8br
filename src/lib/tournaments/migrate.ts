import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cupsFromCompRows, type CompRow } from '@/lib/tournaments/adapter'

type DbClient = typeof prisma | Prisma.TransactionClient

/**
 * Regenerate the versioned canonical Tournament snapshot (comp_tournament_snapshot) from the
 * DB — the derived-data revision every consumer (tournaments list, rankings, profiles) resolves.
 * MUST be called inside the same transaction as a tournament mutation so a failed mutation rolls
 * this back too (no partial state, prior revision preserved). Returns the new revision.
 */
export async function regenerateCupSnapshot(client: DbClient = prisma): Promise<number> {
  const comps = await client.tournament.findMany({
    orderBy: { number: 'asc' },
    include: { bracketMatches: true },
  })
  const cups = cupsFromCompRows(comps as unknown as CompRow[])
  const prev = await client.tournamentSnapshot.findUnique({ where: { id: 1 } })
  const revision = (prev?.revision ?? 0) + 1
  await client.tournamentSnapshot.upsert({
    where: { id: 1 },
    update: { revision, payload: cups as unknown as Prisma.InputJsonValue },
    create: { id: 1, revision, payload: cups as unknown as Prisma.InputJsonValue },
  })
  return revision
}
