import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * The Competition list, for any selector that has to choose one.
 *
 * ── One table, never a hardcoded list ────────────────────────────────────────────────────────────
 * Competitions are records the owner creates and renames. A selector built from a literal array
 * would go stale the first time one is added, and — worse — would offer a name that no row answers
 * to, so the server would reject a choice the UI had just presented as valid. This reads the
 * canonical `competition_series` table and nothing else.
 *
 * Inactive Competitions are included but marked, because an existing Tournament may legitimately
 * belong to one that has since been retired; hiding it would make that Tournament un-editable
 * without silently changing which Competition it is in.
 */
export interface CompetitionOption {
  id: number
  name: string
  shortName: string
  active: boolean
}

export async function listCompetitionOptions(): Promise<CompetitionOption[]> {
  const rows = await prisma.competitionSeries.findMany({
    select: { id: true, name: true, shortName: true, active: true },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  })
  return rows
}

/**
 * Server-side check that a submitted Competition id is real.
 *
 * Returns the id when it exists and null otherwise, so a caller can refuse rather than store a
 * dangling reference. The foreign key would refuse it too, but a constraint violation surfaces as a
 * database error page; this produces a sentence the operator can act on.
 */
export async function resolveCompetitionId(raw: unknown): Promise<number | null> {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isInteger(n) || n <= 0) return null
  const found = await prisma.competitionSeries.findUnique({ where: { id: n }, select: { id: true } })
  return found?.id ?? null
}
