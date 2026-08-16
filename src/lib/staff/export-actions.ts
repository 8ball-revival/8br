'use server'
import { requireStaffActor } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'
import { getLadder } from '@/lib/stats/ladder'

export interface ExportResult { ok?: boolean; error?: string; csv?: string; filename?: string }

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const toCsv = (header: string[], rows: unknown[][]) => [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n')

/** Head-Admin-only safe exports. NEVER include password hashes, reset hashes, sessions, tokens, or
 *  secrets — only fields already safe for an operator to see. */
async function headAdminGate() {
  const a = await requireStaffActor()
  if (!a.isHeadAdmin && !a.can('manage_staff')) return null
  return a
}

export async function exportMembersAction(): Promise<ExportResult> {
  if (!(await headAdminGate())) return { error: 'Head Admin only.' }
  // Identity columns = Preferred Name, CueVerse ID (the account identity), Email, immutable User ID.
  // No separate "username" column — the username is only the internal login projection of the CueVerse ID.
  const users = await prisma.$queryRawUnsafe<
    { id: number; cueverseId: string | null; preferredName: string | null; email: string | null; roles: string | null }[]
  >(
    `SELECT u.id, p."cueverseId" AS "cueverseId", p."primaryName" AS "preferredName", u.email,
            string_agg(r.value, '|') roles
       FROM payload.users u
       LEFT JOIN payload.users_roles r ON r.parent_id = u.id
       LEFT JOIN public."Player" p ON p."linkedUserId" = u.id::text
      GROUP BY u.id, p."cueverseId", p."primaryName", u.email
      ORDER BY u.id`,
  )
  const csv = toCsv(
    ['userId', 'cueverseId', 'preferredName', 'email', 'roles'],
    users.map((u) => [u.id, u.cueverseId, u.preferredName, u.email, u.roles ?? 'member']),
  )
  return { ok: true, csv, filename: `8br-members-${new Date().toISOString().slice(0, 10)}.csv` }
}

export async function exportSeasonsAction(): Promise<ExportResult> {
  if (!(await headAdminGate())) return { error: 'Head Admin only.' }
  const s = await prisma.season.findMany({ orderBy: { number: 'asc' }, include: { _count: { select: { entrants: true } } } })
  const csv = toCsv(['number', 'subtitle', 'competitionYear', 'state', 'champion', 'runnerUp', 'entrants'], s.map((x) => [x.number, x.subtitle, x.competitionYear, x.lifecycleState, x.championName, x.runnerUpName, x._count.entrants]))
  return { ok: true, csv, filename: `8br-seasons-${new Date().toISOString().slice(0, 10)}.csv` }
}

export async function exportTournamentsAction(): Promise<ExportResult> {
  if (!(await headAdminGate())) return { error: 'Head Admin only.' }
  const t = await prisma.tournament.findMany({ orderBy: { number: 'asc' } })
  const csv = toCsv(['number', 'code', 'name', 'format', 'state', 'champion', 'runnerUp'], t.map((x) => [x.number, x.code, x.name, x.tournamentFormat, x.lifecycleState, x.championName, x.runnerUpName]))
  return { ok: true, csv, filename: `8br-tournaments-${new Date().toISOString().slice(0, 10)}.csv` }
}

export async function exportRankingsAction(): Promise<ExportResult> {
  if (!(await headAdminGate())) return { error: 'Head Admin only.' }
  const ladder = await getLadder('all-time')
  const csv = toCsv(['rank', 'playerId', 'name', 'rating', 'wins', 'losses', 'draws', 'winPct'], ladder.map((r) => [r.rank, r.playerId, r.name, r.rating, r.wins, r.losses, r.draws, r.winPct]))
  return { ok: true, csv, filename: `8br-rankings-${new Date().toISOString().slice(0, 10)}.csv` }
}
