import 'server-only'
import { prisma } from '@/lib/prisma'

/** Read-only aggregates for Competition Oversight, Security, and Data & System Health. */

export interface CompRow {
  type: 'Season' | 'Tournament'
  id: number
  name: string
  code: string
  phase: string
  registration: string
  entrants: number
  format: string
  unresolved: number
  waitingFreeAgents: number
  incompleteTeams: number
  manageHref: string
  year: number
  /** Owning Competition — Seasons only; Tournaments have no Competition in this release. */
  competition?: { name: string; shortName: string; iconMediaId: string | null }
}

export async function getCompetitions(): Promise<CompRow[]> {
  const seasons = await prisma.season.findMany({
    include: {
      _count: { select: { entrants: true } },
      competitionSeries: { select: { name: true, shortName: true, iconMediaId: true } },
    },
    orderBy: [{ competitionYear: 'desc' }, { scheduledStartAt: 'desc' }, { number: 'desc' }],
  })
  const tournaments = await prisma.tournament.findMany({
    include: { _count: { select: { registrations: true } } },
    orderBy: { number: 'desc' },
  })

  const rows: CompRow[] = []
  for (const s of seasons) {
    const unresolved = await prisma.seasonMatch.count({ where: { seasonId: s.id, status: 'SCHEDULED' } })
      + await prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id, status: 'SCHEDULED', published: true, homeEntrantId: { not: null }, awayEntrantId: { not: null } } })
    rows.push({
      type: 'Season', id: s.id, name: s.subtitle || `Season ${s.number}`, code: `S${s.number}`,
      phase: s.lifecycleState.replace(/_/g, ' ').toLowerCase(),
      registration: s.lifecycleState === 'REGISTRATION_OPEN' ? 'open' : 'closed',
      entrants: s._count.entrants, format: s.playoffDoubleElim ? 'Groups → DE' : 'Groups → SE',
      unresolved, waitingFreeAgents: 0, incompleteTeams: 0,
      manageHref: `/seasons/${s.id}`, year: s.competitionYear,
      competition: s.competitionSeries,
    })
  }
  for (const t of tournaments) {
    const unresolved = await prisma.playoffMatch.count({ where: { tournamentId: t.id, winnerRegistrationId: null, homeRegistrationId: { not: null }, awayRegistrationId: { not: null } } })
    const waiting = await prisma.tournamentFreeAgent.count({ where: { tournamentId: t.id, status: 'WAITING' } })
    let incompleteTeams = 0
    if (t.participantFormat === 'TEAM' && t.teamSize) {
      const teams = await prisma.tournamentTeam.findMany({ where: { tournamentId: t.id, withdrawn: false }, include: { _count: { select: { members: true } } } })
      incompleteTeams = teams.filter((tm) => tm._count.members < (t.teamSize ?? 0)).length
    }
    rows.push({
      type: 'Tournament', id: t.id, name: t.name, code: t.code ?? `T${t.number}`,
      phase: (t.lifecycleState ?? 'DRAFT').replace(/_/g, ' ').toLowerCase(),
      registration: t.registrationStatus.replace('_', ' ').toLowerCase(),
      entrants: t._count.registrations, format: (t.tournamentFormat ?? 'SINGLE_ELIM').replace(/_/g, ' ').toLowerCase(),
      unresolved, waitingFreeAgents: waiting, incompleteTeams,
      manageHref: `/cups/${t.number}`, year: t.competitionYear,
    })
  }
  return rows
}

export interface SecurityRow { userId: number; cueverseId: string | null; email: string | null; detail: string }
export interface SecuritySummary {
  forcedChange: SecurityRow[]
  expiredResets: SecurityRow[]
  suspended: SecurityRow[]
  banned: SecurityRow[]
  lockedAccounts: SecurityRow[]
  recentResets: { actor: string; targetId: string | null; at: string }[]
  activeStaff: SecurityRow[]
  elevatedCount: number
}

async function usersByIds(ids: number[]): Promise<Map<number, { cueverseId: string | null; email: string | null }>> {
  if (!ids.length) return new Map()
  const rows = await prisma.$queryRawUnsafe<{ id: number; cueverseId: string | null; email: string | null }[]>(
    `SELECT u.id, p."cueverseId" AS "cueverseId", u.email
       FROM payload.users u LEFT JOIN public."Player" p ON p."linkedUserId" = u.id::text
      WHERE u.id = ANY($1::int[])`, ids,
  )
  return new Map(rows.map((r) => [r.id, { cueverseId: r.cueverseId, email: r.email }]))
}

export async function getSecuritySummary(): Promise<SecuritySummary> {
  const now = Date.now()
  const resets = await prisma.passwordResetState.findMany()
  const resetUsers = await usersByIds(resets.map((r) => r.userId))
  const forcedChange: SecurityRow[] = []
  const expiredResets: SecurityRow[] = []
  for (const r of resets) {
    const u = resetUsers.get(r.userId)
    const row = { userId: r.userId, cueverseId: u?.cueverseId ?? null, email: u?.email ?? null, detail: `issued by #${r.issuedByUser}` }
    if (r.expiresAt.getTime() <= now || r.attempts >= 5) expiredResets.push(row); else forcedChange.push(row)
  }

  const mods = await prisma.memberModeration.findMany({ where: { status: { in: ['BANNED', 'TIMED_OUT'] } } })
  const modUsers = await usersByIds(mods.map((m) => m.userId))
  const suspended: SecurityRow[] = []
  const banned: SecurityRow[] = []
  for (const m of mods) {
    const u = modUsers.get(m.userId)
    const row = { userId: m.userId, cueverseId: u?.cueverseId ?? null, email: u?.email ?? null, detail: m.status.toLowerCase() }
    if (m.status === 'BANNED') banned.push(row); else suspended.push(row)
  }

  const lockedRaw = await prisma.$queryRawUnsafe<{ id: number; cueverseId: string | null; email: string | null; lock_until: Date }[]>(
    `SELECT u.id, p."cueverseId" AS "cueverseId", u.email, u.lock_until
       FROM payload.users u LEFT JOIN public."Player" p ON p."linkedUserId" = u.id::text
      WHERE u.lock_until IS NOT NULL AND u.lock_until > now()`,
  )
  const lockedAccounts = lockedRaw.map((r) => ({ userId: r.id, cueverseId: r.cueverseId, email: r.email, detail: 'login-locked' }))

  const recent = await prisma.auditLog.findMany({ where: { action: 'account.password.reset' }, orderBy: { createdAt: 'desc' }, take: 10 })
  const recentResets = recent.map((r) => ({ actor: r.actorUsername, targetId: r.entityId, at: r.createdAt.toISOString() }))

  const staffRaw = await prisma.$queryRawUnsafe<{ id: number; cueverseId: string | null; email: string | null; roles: string }[]>(
    `SELECT u.id, p."cueverseId" AS "cueverseId", u.email, string_agg(r.value, ',') roles
       FROM payload.users u
       JOIN payload.users_roles r ON r.parent_id = u.id
       LEFT JOIN public."Player" p ON p."linkedUserId" = u.id::text
      WHERE r.value IN ('admin','owner')
      GROUP BY u.id, p."cueverseId", u.email`,
  )
  const activeStaff = staffRaw.map((r) => ({ userId: r.id, cueverseId: r.cueverseId, email: r.email, detail: r.roles }))

  return { forcedChange, expiredResets, suspended, banned, lockedAccounts, recentResets, activeStaff, elevatedCount: staffRaw.length }
}

export interface SystemHealth {
  app: 'ok' | 'degraded'
  database: 'connected' | 'error'
  media: 'ok' | 'unknown'
  email: 'configured' | 'not configured'
  commit: string
  migrationStatus: string
  backupNote: string
  counts: { users: number; seasons: number; tournaments: number; auditRows: number; players: number }
}

export async function getSystemHealth(commit: string): Promise<SystemHealth> {
  let database: 'connected' | 'error' = 'connected'
  let users = 0, auditRows = 0, players = 0, seasons = 0, tournaments = 0
  try {
    users = (await prisma.$queryRawUnsafe<{ c: number }[]>(`SELECT count(*)::int c FROM payload.users`))[0].c
    auditRows = await prisma.auditLog.count()
    players = await prisma.player.count()
    seasons = await prisma.season.count()
    tournaments = await prisma.tournament.count()
  } catch { database = 'error' }

  return {
    app: database === 'connected' ? 'ok' : 'degraded',
    database,
    media: 'unknown',
    email: process.env.RESEND_API_KEY ? 'configured' : 'not configured',
    commit,
    migrationStatus: 'Prisma schema in sync (dev push model — no pending migrations tracked)',
    backupNote: 'Backups are created manually via pg_dump into ./backups (see latest 8br-qa2-*.dump).',
    counts: { users, seasons, tournaments, auditRows, players },
  }
}
