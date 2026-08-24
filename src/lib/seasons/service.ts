import 'server-only'
import type { Prisma, SeasonLifecycleState, CompetitionPlatform } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { SEASON_ORDER, currentCompetitionYear, parseCompetitionYear } from '@/lib/competition/competition-year'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import {
  parseSeasonNumber, suggestSeasonNumber, isSeasonNumberTaken, conflictFor, isSeasonNumberCollision,
} from './numbering'
import { hashJoinPassword } from '@/lib/competition/join-password'
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
  /** Season number, unique within this Competition and year. Omitted = the next one going spare. */
  number?: number | string | null
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
  /**
   * Part of the Season's identity, not decoration.
   *
   * The unique index is (Competition, year, number, division), so a divisional pair may share a
   * number. It has to be present at INSERT for that to mean anything: setting it afterwards makes
   * the row briefly a duplicate of its sibling, which the index correctly refuses.
   */
  division?: string | null
}

const clampRace = (v: number | undefined, dflt: number) => {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : dflt
}

export async function createSeason(
  actor: Actor,
  cfg: CreateSeasonConfig,
): Promise<{ ok: boolean; error?: string; id?: number; number?: number; suggestion?: number; existingSeasonId?: number | null }> {
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
    select: { id: true, active: true, name: true, slug: true },
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

  // The Season number is unique within this Competition and year only. An omitted number takes the
  // next one going spare there; a supplied one is validated and used as given.
  const parsed = cfg.number == null || cfg.number === ''
    ? { ok: true as const, value: await suggestSeasonNumber(seriesId, year) }
    : parseSeasonNumber(cfg.number)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const number = parsed.value

  // Checked before submitting so the administrator gets a sentence rather than a constraint error.
  // The database index below is still the authority — two simultaneous creates can both pass here.
  const division = cfg.division?.trim() || null
  if (await isSeasonNumberTaken(seriesId, year, number, undefined, division)) {
    const c = await conflictFor(seriesId, year, number, division)
    return { ok: false, error: c.error, suggestion: c.suggestion, existingSeasonId: c.existingSeasonId ?? null }
  }

  let created
  try {
  created = await prisma.$transaction(async (tx) => {
    const season = await tx.season.create({
      data: {
        number,
        competitionYear: year,
        competitionSeriesId: seriesId,
        // The slug carries the Competition too: with per-Competition numbering, "season-1-2026"
        // alone would collide the moment a second Competition ran its own Season 1 that year.
        division,
        // The slug carries the division too: without it a divisional pair would collide on the slug
        // even though the identity index allows them, and the second one could never be created.
        slug: `${series.slug}-season-${number}-${year}${division ? `-${division.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ''}`,
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
    await recordAudit(actor, { action: 'season.create', entity: 'Season', entityId: season.id, newValue: { number, year, competitionSeriesId: seriesId, title: seasonOfficialTitle(seriesName, number, year) } }, tx)
    return season
  })
  } catch (e) {
    // Lost the race: the composite index rejected the duplicate. Answer in the same words the
    // pre-flight check uses, and hand back a fresh suggestion so nothing has to be worked out again.
    if (isSeasonNumberCollision(e)) {
      const c = await conflictFor(seriesId, year, number, division)
      return { ok: false, error: c.error, suggestion: c.suggestion, existingSeasonId: c.existingSeasonId ?? null }
    }
    throw e
  }
  return { ok: true, id: created.id, number: created.number }
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
  /** The champion's CueVerse ID — the half that identifies them, so it leads wherever they appear. */
  championHandle: string | null
  runnerUpName: string | null
  runnerUpHandle: string | null
  isActive: boolean
  isCompleted: boolean
}

function toSummary(s: { competitionSeries: { id: number; name: string; shortName: string; slug: string; iconMediaId: string | null }; number: number; competitionYear: number; subtitle: string | null; lifecycleState: SeasonLifecycleState; entrantsCount: number; championName: string | null; championHandle: string | null; runnerUpName: string | null; runnerUpHandle: string | null }): SeasonSummary {
  return {
    number: s.number,
    competition: s.competitionSeries,
    year: s.competitionYear,
    title: seasonOfficialTitle(s.competitionSeries?.name ?? '', s.number, s.competitionYear),
    subtitle: s.subtitle,
    lifecycleState: s.lifecycleState,
    entrantsCount: s.entrantsCount,
    championName: s.championName,
    championHandle: s.championHandle,
    runnerUpName: s.runnerUpName,
    runnerUpHandle: s.runnerUpHandle,
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
  /** Which platform this Season was played on — Yahoo history, or CueVerse present. */
  platform: CompetitionPlatform
  /** Division code, when the competition ran divided ones. */
  division: string | null
  /** Whether it contributes to a ladder. Division B is preserved in full but ranks nothing. */
  ranked: boolean
  lounge: string
  accessMode: string
  requiresJoinPassword: boolean
  registrationOpensAt: string | null
  format: { groupStageGames: number; earlyRaceTo: number; semifinalRaceTo: number; finalRaceTo: number }
  entrants: SeasonEntrantView[]
  entrantsCount: number
  championName: string | null
  championHandle: string | null
  runnerUpName: string | null
  runnerUpHandle: string | null
  finalScore: string | null
}

/**
 * A Season by its immutable database id.
 *
 * Deliberately NOT by number: a number is only unique within a Competition and year now, so it
 * cannot identify a Season on its own. The id never changes, which is what keeps a Season's URL and
 * every relationship stable when its display identity is edited.
 */
export async function getSeasonView(id: number): Promise<SeasonView | null> {
  const s = await prisma.season.findUnique({
    where: { id },
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
    platform: s.platform,
    division: s.division,
    ranked: s.countsTowardRankings,
    lounge: s.lounge,
    accessMode: s.accessMode,
    requiresJoinPassword: s.accessMode === 'PASSWORD',
    registrationOpensAt: s.registrationOpensAt?.toISOString() ?? null,
    format: { groupStageGames: s.groupStageGames, earlyRaceTo: s.earlyRaceTo, semifinalRaceTo: s.semifinalRaceTo, finalRaceTo: s.finalRaceTo },
    entrants,
    entrantsCount: entrants.filter((e) => !e.withdrawn).length,
    championName: s.championName,
    championHandle: s.championHandle,
    runnerUpName: s.runnerUpName,
    runnerUpHandle: s.runnerUpHandle,
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
  const rows = await prisma.player.findMany({ where: { active: true, managementOnly: false, ...match }, orderBy: [{ cueverseId: 'asc' }, { primaryName: 'asc' }], take: Math.max(limit, entered.size + limit), select: { id: true, primaryName: true, cueverseId: true } })
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

/**
 * Self-registration by an authenticated player.
 *
 * ── The gate is enforced here, not on the page ───────────────────────────────────────────────────
 * Hiding the button is presentation. This is the check, and it asks the same question the page does:
 * the site-wide policy, plus the Season's lifecycle. A member who posts this action directly under
 * an ADMIN_ONLY policy is refused, whatever their browser was showing.
 *
 * The per-Season join password is deliberately no longer consulted. Two gates that both have to
 * agree meant a member could satisfy the policy and still be refused for a secret nobody had given
 * them, and there was no message that could usefully explain which one had said no. Legacy
 * PASSWORD Seasons keep `accessMode` and `joinPasswordHash` — the records are intact and readable —
 * the values simply no longer decide who may enter.
 */
export async function registerSelf(
  userId: number,
  identity: { playerId?: string | null; name: string; handle?: string | null },
  seasonId: number,
  _joinPassword?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'REGISTRATION_OPEN') return { ok: false, error: 'Registration is not open for this Season.' }
  const { publicRegistrationOpen } = await import('@/lib/competition/registration-policy')
  if (!(await publicRegistrationOpen({ lifecycleState: s.lifecycleState }))) {
    return { ok: false, error: 'Entries for this Season are added by an administrator.' }
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
  /** Season number — a display label, editable at any point including after the Season closes. */
  number?: number | string | null
  /**
   * Division code. Identity metadata, editable at any point including after the Season closes.
   *
   * Correcting which division a finished Season belonged to changes no result, no champion and no
   * rating — it records a fact about the competition that was always true and simply was not
   * captured at the time. Requiring a reopen for that would put a Season through the whole
   * withdraw-and-reapply cycle to fix a label.
   *
   * Empty or null clears it, which the Rankings filter reports as "Unassigned".
   */
  division?: string | null
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

/**
 * A division code, as stored.
 *
 * Short by design: these are codes like "A" and "B", not names. Anything longer is a mistake worth
 * refusing rather than truncating, because a truncated code silently becomes a different division.
 */
export function normalizeDivision(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null }
  const v = String(raw).trim().toUpperCase()
  if (v === '') return { ok: true, value: null }
  if (v.length > 8) return { ok: false, error: 'A division code is at most 8 characters.' }
  if (!/^[A-Z0-9 -]+$/.test(v)) return { ok: false, error: 'A division code uses letters, digits, spaces and hyphens only.' }
  return { ok: true, value: v }
}

const REG_EDITABLE = new Set(['REGISTRATION_SCHEDULED', 'REGISTRATION_OPEN'])
const FORMAT_EDITABLE = new Set(['REGISTRATION_SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUP_SETUP', 'GROUP_STAGE_LIVE', 'GROUPS_CLOSED'])

/** Update Season settings with server-enforced, lifecycle-aware gating. Fields the current phase does
 *  not permit are silently ignored (the UI hides them; this is the authoritative backstop). */
export async function updateSeasonSettings(
  actor: Actor,
  seasonId: number,
  patch: SeasonSettingsPatch,
): Promise<{ ok: boolean; error?: string; suggestion?: number }> {
  const s = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { lifecycleState: true, accessMode: true, number: true, competitionYear: true, competitionSeriesId: true },
  })
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
  // The Season number is display identity, so it is editable at any point in the lifecycle — a
  // finished Season included. Renumbering changes a label and nothing else: no match, playoff,
  // seed, ranking or historical result is recalculated, because none of them reference it.
  if (patch.number !== undefined && patch.number !== null && patch.number !== '') {
    const parsed = parseSeasonNumber(patch.number)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    // Checked against wherever the Season will END UP, which may be a Competition or year this same
    // save is moving it to.
    const targetSeries = (data.competitionSeriesId as number | undefined) ?? s.competitionSeriesId
    const targetYear = (data.competitionYear as number | undefined) ?? s.competitionYear
    if (parsed.value !== s.number || targetSeries !== s.competitionSeriesId || targetYear !== s.competitionYear) {
      if (await isSeasonNumberTaken(targetSeries, targetYear, parsed.value, seasonId)) {
        const c = await conflictFor(targetSeries, targetYear, parsed.value)
        return { ok: false, error: c.error, suggestion: c.suggestion }
      }
    }
    data.number = parsed.value
  }
  if (patch.division !== undefined) {
    const d = normalizeDivision(patch.division)
    if (!d.ok) return { ok: false, error: d.error }
    data.division = d.value
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
  try {
    await prisma.season.update({ where: { id: seasonId }, data })
  } catch (e) {
    // The composite index has the final word here too, in case another save claimed the same
    // Competition/year/number between the check above and this write.
    if (isSeasonNumberCollision(e)) {
      const targetSeries = (data.competitionSeriesId as number | undefined) ?? s.competitionSeriesId
      const targetYear = (data.competitionYear as number | undefined) ?? s.competitionYear
      const c = await conflictFor(targetSeries, targetYear, (data.number as number | undefined) ?? s.number)
      return { ok: false, error: c.error, suggestion: c.suggestion }
    }
    throw e
  }
  await recordAudit(actor, { action: 'season.settings.update', entity: 'Season', entityId: seasonId, newValue: { fields: Object.keys(data) } })
  return { ok: true }
}

/**
 * Set the division on several Seasons at once, atomically.
 *
 * A division correction is usually not about one Season. Divisions are a property of a set of
 * competitions that ran alongside each other, so "these three were Division A" is a single fact,
 * and applying it one row at a time can leave the archive half-corrected if the second write fails
 * — a state that looks deliberate to anyone reading it later.
 *
 * Shares `normalizeDivision` with the settings patch, so a code accepted here is a code accepted
 * there. Writes only the `division` column: no result, champion, rating or ledger row is touched,
 * and a Season does not need reopening, because recording which division a finished competition
 * belonged to asserts nothing new about how it was played.
 *
 * Every change is audited individually inside the same transaction, so the trail either describes
 * every row or none of them.
 */
export async function setSeasonDivisions(
  actor: Actor,
  changes: { seasonId: number; division: string | null }[],
): Promise<{ ok: boolean; error?: string; updated?: { seasonId: number; from: string | null; to: string | null }[] }> {
  if (changes.length === 0) return { ok: true, updated: [] }

  const normalised: { seasonId: number; value: string | null }[] = []
  for (const c of changes) {
    if (!Number.isInteger(c.seasonId) || c.seasonId <= 0) return { ok: false, error: 'Invalid Season id.' }
    const d = normalizeDivision(c.division)
    if (!d.ok) return { ok: false, error: d.error }
    normalised.push({ seasonId: c.seasonId, value: d.value })
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const out: { seasonId: number; from: string | null; to: string | null }[] = []
      for (const { seasonId, value } of normalised) {
        const before = await tx.season.findUnique({ where: { id: seasonId }, select: { division: true } })
        if (!before) throw new Error(`Season ${seasonId} not found.`)
        if (before.division === value) { out.push({ seasonId, from: before.division, to: value }); continue }
        await tx.season.update({ where: { id: seasonId }, data: { division: value } })
        await recordAudit(actor, {
          action: 'season.division.set',
          entity: 'Season',
          entityId: seasonId,
          oldValue: { division: before.division },
          newValue: { division: value },
        }, tx)
        out.push({ seasonId, from: before.division, to: value })
      }
      return out
    })
    return { ok: true, updated }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The divisions could not be saved.' }
  }
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
