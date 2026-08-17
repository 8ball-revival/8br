import 'server-only'
import type { Prisma, SeasonLifecycleState } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SEASON_ORDER, currentCompetitionYear, parseCompetitionYear } from '@/lib/competition/competition-year'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { hashJoinPassword, verifyJoinPassword } from '@/lib/competition/join-password'
import { transitionSeasonState } from './lifecycle'
import { isPreGroupPhase } from './shared'

/**
 * SEASON SERVICE — creation, registration, and read views for the standalone Season domain.
 * Reuses the shared audit + rating ledger, but stores everything in the Season-owned tables.
 */

// ---- Titles ---------------------------------------------------------------

/** The official, always-present Season identity — the sequence + year. A custom subtitle never
 *  replaces it. */
export function seasonOfficialTitle(competitionName: string, number: number, year: number): string {
  // "<Competition> Season <n> · <year>". The Competition supplies the leading name, so a Season
  // always reads as belonging to the competition that owns it rather than to the site brand.
  // With no name we drop the prefix entirely rather than padding it — "Season Season 1" reads as a bug.
  const prefix = (competitionName || '').trim()
  return `${prefix ? `${prefix} ` : ''}Season ${number} · ${year}`
}

// ---- Identity / ratings ---------------------------------------------------

/** Current all-time Ladder rating (latest ledger post-rating) per playerId; absent = unrated. */
export async function seasonRatingsByPlayerId(playerIds: (string | null)[]): Promise<Map<string, number>> {
  const ids = [...new Set(playerIds.filter((p): p is string => !!p))]
  const m = new Map<string, number>()
  if (!ids.length) return m
  const latest = await prisma.ratingLedger.findMany({ where: { playerId: { in: ids } }, orderBy: { sequence: 'desc' }, select: { playerId: true, postRating: true } })
  for (const r of latest) if (!m.has(r.playerId)) m.set(r.playerId, r.postRating)
  return m
}

// ---- Creation -------------------------------------------------------------

export interface CreateSeasonConfig {
  /** Competition Year (four-digit). Omitted = the current calendar year. */
  competitionYear?: number | string | null
  /** Owning Competition (CompetitionSeries id). REQUIRED — there is no 'Unassigned' Competition. */
  competitionSeriesId?: number | string | null
  subtitle?: string | null
  lounge?: string
  accessMode?: 'OPEN' | 'PASSWORD'
  joinPassword?: string | null
  registrationOpensAt?: string | null // ISO; a future value schedules, else registration opens now
  description?: string | null
  bannerMediaId?: string | null
  groupStageGames?: number
  earlyRaceTo?: number
  semifinalRaceTo?: number
  finalRaceTo?: number
}

const clampRace = (v: number | undefined, dflt: number) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : dflt
}

export async function createSeason(actor: Actor, cfg: CreateSeasonConfig): Promise<{ ok: boolean; error?: string; number?: number }> {
  const yearResult = parseCompetitionYear(
    cfg.competitionYear == null || cfg.competitionYear === '' ? currentCompetitionYear() : cfg.competitionYear,
  )
  if (!yearResult.ok) return { ok: false, error: yearResult.error }
  const year = yearResult.year

  // Competition ownership is required and must reference a real, ACTIVE Competition. Validated here
  // so the rule holds for every caller, not just the form.
  const seriesId = Number(cfg.competitionSeriesId)
  if (!Number.isInteger(seriesId) || seriesId <= 0) {
    return { ok: false, error: 'Select the Competition this Season belongs to.' }
  }
  const series = await prisma.competitionSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, active: true, name: true },
  })
  if (!series) return { ok: false, error: 'That Competition no longer exists.' }
  if (!series.active) return { ok: false, error: 'That Competition is inactive and cannot take new Seasons.' }
  const seriesName = series.name
  const opensAt = cfg.registrationOpensAt ? new Date(cfg.registrationOpensAt) : null
  const scheduled = !!opensAt && opensAt.getTime() > Date.now()
  const accessMode = cfg.accessMode === 'PASSWORD' ? 'PASSWORD' : 'OPEN'
  if (accessMode === 'PASSWORD' && (!cfg.joinPassword || cfg.joinPassword.trim().length < 4)) {
    return { ok: false, error: 'Set a join password of at least 4 characters.' }
  }

  // Allocate the next public Season number atomically against concurrent creates.
  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.season.findFirst({ orderBy: { number: 'desc' }, select: { number: true } })
    const number = (last?.number ?? 0) + 1
    const season = await tx.season.create({
      data: {
        number,
        competitionYear: year,
        competitionSeriesId: seriesId,
        slug: `8br-season-${number}-${year}`,
        subtitle: cfg.subtitle?.trim() || null,
        lifecycleState: scheduled ? 'REGISTRATION_SCHEDULED' : 'REGISTRATION_OPEN',
        lounge: cfg.lounge?.trim() || 'Social',
        accessMode,
        joinPasswordHash: accessMode === 'PASSWORD' ? hashJoinPassword((cfg.joinPassword ?? '').trim()) : null,
        registrationOpensAt: opensAt,
        description: cfg.description?.trim() || null,
        bannerMediaId: cfg.bannerMediaId?.trim() || null,
        groupStageGames: clampRace(cfg.groupStageGames, 10),
        earlyRaceTo: clampRace(cfg.earlyRaceTo, 7),
        semifinalRaceTo: clampRace(cfg.semifinalRaceTo, 9),
        finalRaceTo: clampRace(cfg.finalRaceTo, 9),
      },
    })
    await recordAudit(actor, { action: 'season.create', entity: 'Season', entityId: season.id, newValue: { number, year, title: seasonOfficialTitle(seriesName, number, year) } }, tx)
    return season
  })
  return { ok: true, number: created.number }
}

// ---- Read views -----------------------------------------------------------

export interface SeasonSummary {
  /** Owning Competition — always present; the relation is required. */
  competition: { id: number; name: string; shortName: string; slug: string; iconMediaId: string | null }
  number: number
  year: number
  title: string
  subtitle: string | null
  lifecycleState: SeasonLifecycleState
  entrantsCount: number
  championName: string | null
  runnerUpName: string | null
  isActive: boolean
  isCompleted: boolean
}

function toSummary(s: { competitionSeries: { id: number; name: string; shortName: string; slug: string; iconMediaId: string | null }; number: number; competitionYear: number; subtitle: string | null; lifecycleState: SeasonLifecycleState; entrantsCount: number; championName: string | null; runnerUpName: string | null }): SeasonSummary {
  return {
    number: s.number,
    competition: s.competitionSeries,
    year: s.competitionYear,
    title: seasonOfficialTitle(s.competitionSeries?.name ?? '', s.number, s.competitionYear),
    subtitle: s.subtitle,
    lifecycleState: s.lifecycleState,
    entrantsCount: s.entrantsCount,
    championName: s.championName,
    runnerUpName: s.runnerUpName,
    isActive: s.lifecycleState !== 'COMPLETED',
    isCompleted: s.lifecycleState === 'COMPLETED',
  }
}

export async function listSeasons(): Promise<SeasonSummary[]> {
  const rows = await prisma.season.findMany({
    orderBy: SEASON_ORDER,
    include: { competitionSeries: { select: { id: true, name: true, shortName: true, slug: true, iconMediaId: true } } },
  })
  return rows.map(toSummary)
}

export interface SeasonEntrantView {
  entrantId: number
  name: string
  cueverseId: string | null
  slug: string | null
  rating: number | null
  withdrawn: boolean
  kickedOut: boolean
}

export interface SeasonView {
  id: number
  /** Owning Competition — always present; the relation is required. */
  competition: { id: number; name: string; shortName: string; slug: string; iconMediaId: string | null }
  number: number
  year: number
  title: string
  subtitle: string | null
  description: string | null
  lifecycleState: SeasonLifecycleState
  lounge: string
  accessMode: string
  requiresJoinPassword: boolean
  registrationOpensAt: string | null
  format: { groupStageGames: number; earlyRaceTo: number; semifinalRaceTo: number; finalRaceTo: number }
  entrants: SeasonEntrantView[]
  entrantsCount: number
  championName: string | null
  runnerUpName: string | null
  finalScore: string | null
}

export async function getSeasonView(number: number): Promise<SeasonView | null> {
  const s = await prisma.season.findUnique({
    where: { number },
    include: { competitionSeries: { select: { id: true, name: true, shortName: true, slug: true, iconMediaId: true } } },
  })
  if (!s) return null
  const rows = await prisma.seasonEntrant.findMany({
    where: { seasonId: s.id, status: { not: 'WITHDRAWN' } },
    orderBy: [{ seed: 'asc' }, { id: 'asc' }],
  })
  // Live rating while registration is open; after close, show the locked snapshot.
  const preClose = s.lifecycleState === 'REGISTRATION_SCHEDULED' || s.lifecycleState === 'REGISTRATION_OPEN'
  const liveRatings = preClose ? await seasonRatingsByPlayerId(rows.map((r) => r.playerId)) : new Map<string, number>()
  const entrants: SeasonEntrantView[] = rows.map((r) => ({
    entrantId: r.id,
    name: r.displayName?.trim() || r.username,
    cueverseId: r.cueverseId ?? null,
    slug: r.cueverseId ?? null,
    rating: preClose ? (r.playerId ? liveRatings.get(r.playerId) ?? null : null) : r.ratingSnapshot,
    withdrawn: r.status === 'WITHDRAWN',
    kickedOut: r.kickedOut,
  }))
  return {
    id: s.id,
    competition: s.competitionSeries,
    number: s.number,
    year: s.competitionYear,
    title: seasonOfficialTitle(s.competitionSeries?.name ?? '', s.number, s.competitionYear),
    subtitle: s.subtitle,
    description: s.description,
    lifecycleState: s.lifecycleState,
    lounge: s.lounge,
    accessMode: s.accessMode,
    requiresJoinPassword: s.accessMode === 'PASSWORD',
    registrationOpensAt: s.registrationOpensAt?.toISOString() ?? null,
    format: { groupStageGames: s.groupStageGames, earlyRaceTo: s.earlyRaceTo, semifinalRaceTo: s.semifinalRaceTo, finalRaceTo: s.finalRaceTo },
    entrants,
    entrantsCount: entrants.filter((e) => !e.withdrawn).length,
    championName: s.championName,
    runnerUpName: s.runnerUpName,
    finalScore: s.finalScore,
  }
}

// ---- Registration ---------------------------------------------------------

async function refreshEntrantCount(tx: Prisma.TransactionClient, seasonId: number): Promise<void> {
  const n = await tx.seasonEntrant.count({ where: { seasonId, status: 'APPROVED' } })
  await tx.season.update({ where: { id: seasonId }, data: { entrantsCount: n } })
}

/** Registered players eligible to be added to a Season (existing accounts only). */
export interface SeasonCandidate { playerId: string; primaryName: string; cueverseId: string | null }
export async function searchSeasonCandidates(seasonId: number, query: string, limit = 50): Promise<SeasonCandidate[]> {
  const q = query.trim()
  const nk = q.toLowerCase().replace(/[^a-z0-9]/g, '')
  const entered = new Set(
    (await prisma.seasonEntrant.findMany({ where: { seasonId, status: { not: 'WITHDRAWN' }, playerId: { not: null } }, select: { playerId: true } })).map((e) => e.playerId!),
  )
  const match = q
    ? { OR: [{ primaryName: { contains: q, mode: 'insensitive' as const } }, { cueverseId: { contains: q, mode: 'insensitive' as const } }, { aliases: { some: { alias: { contains: nk } } } }] }
    : {}
  const rows = await prisma.player.findMany({ where: { active: true, managementOnly: false, ...match }, orderBy: { primaryName: 'asc' }, take: Math.max(limit, entered.size + limit), select: { id: true, primaryName: true, cueverseId: true } })
  return rows.filter((r) => !entered.has(r.id)).slice(0, limit).map((r) => ({ playerId: r.id, primaryName: r.primaryName, cueverseId: r.cueverseId }))
}

/**
 * Can an ADMIN still add or remove entrants?
 *
 * Through the whole pre-group phase, which now includes Group Setup. Registration and group building
 * used to be strictly sequential, and for a season being played that is the right shape — but when a
 * season is being reconstructed from an archive the roster and the groups are discovered together,
 * and being sent back to a separate registration step to add one missing player is pure friction.
 *
 * Nothing is relaxed once the group stage is live: the fixtures exist by then, and adding a player
 * would mean a schedule that does not match the results already being entered.
 *
 * Self-registration is unaffected — `registerSelf` still demands REGISTRATION_OPEN, so widening this
 * never lets a member add themselves after registration has closed.
 */
async function requireEntrantsEditable(seasonId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (!isPreGroupPhase(s.lifecycleState)) {
    return { ok: false, error: 'Entrants can only be changed before the group stage goes live.' }
  }
  return { ok: true }
}

/** Admin adds an entrant from an existing registered account (by canonical player id). */
export async function addSeasonEntrant(actor: Actor, seasonId: number, playerId: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireEntrantsEditable(seasonId)
  if (!gate.ok) return gate
  const player = await prisma.player.findUnique({ where: { id: playerId }, select: { id: true, primaryName: true, cueverseId: true, linkedUserId: true } })
  if (!player) return { ok: false, error: 'Player not found.' }
  const existing = await prisma.seasonEntrant.findFirst({ where: { seasonId, playerId, status: { not: 'WITHDRAWN' } } })
  if (existing) return { ok: false, error: `${player.primaryName} is already entered.` }
  await prisma.$transaction(async (tx) => {
    // Reactivate a prior withdrawal rather than duplicating.
    const prior = await tx.seasonEntrant.findFirst({ where: { seasonId, playerId } })
    if (prior) {
      await tx.seasonEntrant.update({ where: { id: prior.id }, data: { status: 'APPROVED', addedByAdmin: true } })
    } else {
      await tx.seasonEntrant.create({
        data: { seasonId, playerId, userId: player.linkedUserId ? Number(player.linkedUserId) || null : null, username: player.cueverseId || player.primaryName, displayName: player.primaryName, cueverseId: player.cueverseId, status: 'APPROVED', addedByAdmin: true },
      })
    }
    await recordAudit(actor, { action: 'season.entrant.add', entity: 'Season', entityId: seasonId, newValue: { playerId, name: player.primaryName } }, tx)
    await refreshEntrantCount(tx, seasonId)
  })
  return { ok: true }
}

export async function removeSeasonEntrant(actor: Actor, seasonId: number, entrantId: number): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireEntrantsEditable(seasonId)
  if (!gate.ok) return gate
  const e = await prisma.seasonEntrant.findFirst({ where: { id: entrantId, seasonId } })
  if (!e) return { ok: false, error: 'Entrant not found.' }
  await prisma.$transaction(async (tx) => {
    await tx.seasonEntrant.update({ where: { id: entrantId }, data: { status: 'WITHDRAWN' } })
    await recordAudit(actor, { action: 'season.entrant.remove', entity: 'Season', entityId: seasonId, oldValue: { entrantId, name: e.displayName || e.username } }, tx)
    await refreshEntrantCount(tx, seasonId)
  })
  return { ok: true }
}

/** Self-registration by an authenticated player. */
export async function registerSelf(
  userId: number,
  identity: { playerId?: string | null; name: string; handle?: string | null },
  seasonNumber: number,
  joinPassword?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { number: seasonNumber } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'REGISTRATION_OPEN') return { ok: false, error: 'Registration is not open for this Season.' }
  if (s.accessMode === 'PASSWORD' && !verifyJoinPassword((joinPassword ?? '').trim(), s.joinPasswordHash)) {
    return { ok: false, error: 'Incorrect join password for this private Season.' }
  }
  const { resolveMemberStatus } = await import('@/lib/moderation/service')
  const mod = await resolveMemberStatus(userId)
  if (!mod.canRegister) return { ok: false, error: 'This account cannot register.' }

  const dupe = await prisma.seasonEntrant.findFirst({ where: { seasonId: s.id, OR: [{ userId }, ...(identity.playerId ? [{ playerId: identity.playerId }] : [])], status: { not: 'WITHDRAWN' } } })
  if (dupe) return { ok: false, error: 'You are already registered for this Season.' }
  await prisma.$transaction(async (tx) => {
    await tx.seasonEntrant.create({
      data: { seasonId: s.id, userId, playerId: identity.playerId ?? null, username: identity.handle || identity.name, displayName: identity.name, cueverseId: identity.handle ?? null, status: 'APPROVED' },
    })
    await recordAudit({ userId, username: identity.name }, { action: 'season.entrant.selfRegister', entity: 'Season', entityId: s.id, newValue: { name: identity.name } }, tx)
    await refreshEntrantCount(tx, s.id)
  })
  return { ok: true }
}

/** Close registration: capture each entrant's current Ladder rating as an immutable seeding snapshot,
 *  then transition to REGISTRATION_CLOSED (all in one transaction). */
export async function closeRegistration(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'REGISTRATION_OPEN') return { ok: false, error: 'Registration is already closed.' }
  const entrants = await prisma.seasonEntrant.findMany({ where: { seasonId, status: 'APPROVED' }, select: { id: true, playerId: true } })
  const ratings = await seasonRatingsByPlayerId(entrants.map((e) => e.playerId))
  await prisma.$transaction(async (tx) => {
    for (const e of entrants) {
      await tx.seasonEntrant.update({ where: { id: e.id }, data: { ratingSnapshot: e.playerId ? ratings.get(e.playerId) ?? 1500 : 1500 } })
    }
    await tx.season.update({ where: { id: seasonId }, data: { ratingSnapshotAt: new Date() } })
    await recordAudit(actor, { action: 'season.registration.close', entity: 'Season', entityId: seasonId, newValue: { entrants: entrants.length } }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'REGISTRATION_CLOSED', { tx })
    if (!t.ok) throw new Error(t.error)
  })
  return { ok: true }
}

// ---- Settings (lifecycle-aware) + export -----------------------------------

export interface SeasonSettingsPatch {
  /** Competition Year — always editable (identity, not lifecycle state). */
  competitionYear?: number | string | null
  /** Owning Competition. Always editable, but must remain a real, ACTIVE Competition. */
  competitionSeriesId?: number | string | null
  subtitle?: string | null
  description?: string | null
  lounge?: string
  accessMode?: 'OPEN' | 'PASSWORD'
  joinPassword?: string | null
  registrationOpensAt?: string | null
  bannerMediaId?: string | null
  groupStageGames?: number
  earlyRaceTo?: number
  semifinalRaceTo?: number
  finalRaceTo?: number
}

const REG_EDITABLE = new Set(['REGISTRATION_SCHEDULED', 'REGISTRATION_OPEN'])
const FORMAT_EDITABLE = new Set(['REGISTRATION_SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUP_SETUP', 'GROUP_STAGE_LIVE', 'GROUPS_CLOSED'])

/** Update Season settings with server-enforced, lifecycle-aware gating. Fields the current phase does
 *  not permit are silently ignored (the UI hides them; this is the authoritative backstop). */
export async function updateSeasonSettings(actor: Actor, seasonId: number, patch: SeasonSettingsPatch): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true, accessMode: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  const state = s.lifecycleState
  const data: Record<string, unknown> = {}
  // Always editable (even after Close): identity + presentation.
  if (patch.competitionYear !== undefined && patch.competitionYear !== null && patch.competitionYear !== '') {
    const y = parseCompetitionYear(patch.competitionYear)
    if (!y.ok) return { ok: false, error: y.error }
    data.competitionYear = y.year
  }
  if (patch.competitionSeriesId !== undefined && patch.competitionSeriesId !== null && patch.competitionSeriesId !== '') {
    // Re-validated here, not just in the form: a Season may never point at a missing or inactive
    // Competition, and the relation can never be cleared.
    const sid = Number(patch.competitionSeriesId)
    if (!Number.isInteger(sid) || sid <= 0) return { ok: false, error: 'Select the Competition this Season belongs to.' }
    const series = await prisma.competitionSeries.findUnique({ where: { id: sid }, select: { id: true, active: true } })
    if (!series) return { ok: false, error: 'That Competition no longer exists.' }
    if (!series.active) return { ok: false, error: 'That Competition is inactive and cannot own Seasons.' }
    data.competitionSeriesId = sid
  }
  if (patch.subtitle !== undefined) data.subtitle = patch.subtitle?.trim() || null
  if (patch.description !== undefined) data.description = patch.description?.trim() || null
  if (patch.bannerMediaId !== undefined) data.bannerMediaId = patch.bannerMediaId?.trim() || null
  if (state !== 'COMPLETED') {
    if (patch.lounge !== undefined) data.lounge = patch.lounge.trim() || 'Social'
  }
  // Registration access + schedule: only before registration closes.
  if (REG_EDITABLE.has(state)) {
    if (patch.accessMode !== undefined) {
      const mode = patch.accessMode === 'PASSWORD' ? 'PASSWORD' : 'OPEN'
      data.accessMode = mode
      if (mode === 'PASSWORD') { if ((patch.joinPassword ?? '').trim().length < 4) return { ok: false, error: 'Set a join password of at least 4 characters.' }; data.joinPasswordHash = hashJoinPassword((patch.joinPassword ?? '').trim()) }
      else data.joinPasswordHash = null
    }
    if (patch.registrationOpensAt !== undefined) data.registrationOpensAt = patch.registrationOpensAt ? new Date(patch.registrationOpensAt) : null
  }
  // Match format: editable until playoffs begin (a warning is shown once groups are live — UI concern).
  if (FORMAT_EDITABLE.has(state)) {
    const clamp = (v: number | undefined, d: number) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 99 ? n : d }
    if (patch.groupStageGames !== undefined) data.groupStageGames = clamp(patch.groupStageGames, 10)
    if (patch.earlyRaceTo !== undefined) data.earlyRaceTo = clamp(patch.earlyRaceTo, 7)
    if (patch.semifinalRaceTo !== undefined) data.semifinalRaceTo = clamp(patch.semifinalRaceTo, 9)
    if (patch.finalRaceTo !== undefined) data.finalRaceTo = clamp(patch.finalRaceTo, 9)
  }
  if (Object.keys(data).length === 0) return { ok: true }
  await prisma.season.update({ where: { id: seasonId }, data })
  await recordAudit(actor, { action: 'season.settings.update', entity: 'Season', entityId: seasonId, newValue: { fields: Object.keys(data) } })
  return { ok: true }
}

/** Complete portable export of a Season (entrants, snapshots, groups, results, standings,
 *  qualifications, seeds, bracket, champion, ranking rows, audit history). */
export async function exportSeasonData(seasonId: number): Promise<unknown> {
  const [season, entrants, groups, matches, standings, playoff, ledger, audit] = await Promise.all([
    prisma.season.findUnique({ where: { id: seasonId } }),
    prisma.seasonEntrant.findMany({ where: { seasonId } }),
    prisma.seasonGroup.findMany({ where: { seasonId } }),
    prisma.seasonMatch.findMany({ where: { seasonId } }),
    prisma.seasonStanding.findMany({ where: { seasonId } }),
    prisma.seasonPlayoffMatch.findMany({ where: { seasonId } }),
    prisma.ratingLedger.findMany({ where: { seasonId } }),
    prisma.auditLog.findMany({ where: { entity: 'Season', entityId: String(seasonId) }, orderBy: { createdAt: 'asc' } }),
  ])
  if (!season) return null
  return { exportedAt: new Date().toISOString(), season, entrants, groups, matches, standings, playoffMatches: playoff, rankingChanges: ledger, history: audit }
}
