import 'server-only'
import type { Prisma, RegistrationStatus, LiveMatchStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { planGroups, type SeedableRegistration, type GroupPlan } from './groups'
import { roundRobin, type SchedulePlayer } from './schedule'
import { computeStandings, type StandingMatchInput } from './standings'
import { validateScore } from './scoring'
import { planBracket, orderQualifiers, type GroupQualifiers, type BracketPlan } from './bracket'

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

export async function createSeason(
  actor: Actor,
  data: { slug: string; name: string },
): Promise<{ id: number }> {
  const season = await prisma.season.create({ data: { slug: data.slug, name: data.name } })
  await recordAudit(actor, { action: 'season.create', entity: 'Season', entityId: season.id, newValue: data })
  return { id: season.id }
}

export interface SeasonPatch {
  name?: string
  seasonStatus?: 'UPCOMING' | 'ACTIVE' | 'COMPLETED'
  registrationStatus?: 'NOT_OPEN' | 'OPEN' | 'CLOSED'
  registrationOpensAt?: Date | null
  registrationClosesAt?: Date | null
  groupsStatus?: 'PENDING' | 'PUBLISHED' | 'COMPLETED'
  playoffsStatus?: 'PENDING' | 'PUBLISHED' | 'COMPLETED'
  raceLength?: number
  qualifiersPerGroup?: number
  formatSummary?: string
  eligibilitySummary?: string
}

export async function updateSeason(
  actor: Actor,
  seasonId: number,
  patch: SeasonPatch,
  reason?: string,
): Promise<void> {
  const before = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })
  const after = await prisma.season.update({ where: { id: seasonId }, data: patch })
  await recordAudit(actor, {
    action: 'season.update',
    entity: 'Season',
    entityId: seasonId,
    oldValue: diffSubset(before, patch),
    newValue: diffSubset(after, patch),
    reason,
  })
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

/** Public sign-up: creates a PENDING registration. Enforces open state + dedupe. */
export async function createPublicRegistration(
  seasonId: number,
  userId: number,
  username: string,
): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!season) return { ok: false, error: 'Season not found.' }
  if (season.registrationStatus !== 'OPEN') return { ok: false, error: 'Registration is closed.' }

  const existing = await prisma.registration.findUnique({
    where: { seasonId_userId: { seasonId, userId } },
  })
  if (existing) {
    if (existing.status === 'WITHDRAWN' || existing.status === 'REJECTED') {
      await prisma.registration.update({
        where: { id: existing.id },
        data: { status: 'PENDING', withdrawnAt: null },
      })
      return { ok: true }
    }
    return { ok: true, already: true }
  }
  await prisma.registration.create({ data: { seasonId, userId, username, status: 'PENDING' } })
  return { ok: true }
}

export async function setRegistrationStatus(
  actor: Actor,
  registrationId: number,
  status: RegistrationStatus,
  reason?: string,
): Promise<void> {
  const before = await prisma.registration.findUniqueOrThrow({ where: { id: registrationId } })
  const data: Prisma.RegistrationUpdateInput = { status }
  if (status === 'APPROVED') {
    data.approvedAt = new Date()
    data.approvedByUserId = actor.userId
    data.withdrawnAt = null
  }
  if (status === 'WITHDRAWN') data.withdrawnAt = new Date()
  await prisma.registration.update({ where: { id: registrationId }, data })
  await recordAudit(actor, {
    action: `registration.${status.toLowerCase()}`,
    entity: 'Registration',
    entityId: registrationId,
    oldValue: { status: before.status },
    newValue: { status },
    reason,
  })
}

// ---------------------------------------------------------------------------
// Group generation
// ---------------------------------------------------------------------------

async function approvedSeedables(seasonId: number): Promise<SeedableRegistration[]> {
  const regs = await prisma.registration.findMany({
    where: { seasonId, status: 'APPROVED' },
    select: { id: true, username: true, seed: true },
  })
  return regs.map((r) => ({ id: r.id, username: r.username, seed: r.seed }))
}

/** Non-persisting preview of a group draw. */
export async function previewGroups(
  seasonId: number,
  numGroups: number,
  seed: string,
): Promise<GroupPlan> {
  const regs = await approvedSeedables(seasonId)
  return planGroups(regs, numGroups, seed)
}

/** Generate (persist) groups from a deterministic plan. Blocks if already published unless forced. */
export async function generateGroups(
  actor: Actor,
  seasonId: number,
  numGroups: number,
  seedInput: string | undefined,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string; seed?: string }> {
  const published = await prisma.seasonGroup.count({ where: { seasonId, published: true } })
  if (published > 0 && !opts.force)
    return { ok: false, error: 'Groups are already published. Confirm to regenerate.' }

  const seed = seedInput?.trim() || `season:${seasonId}:groups:${numGroups}:${Date.now()}`
  const regs = await approvedSeedables(seasonId)
  let plan: GroupPlan
  try {
    plan = planGroups(regs, numGroups, seed)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not generate groups.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.seasonGroup.deleteMany({ where: { seasonId } }) // cascades players/matches/standings
    for (const g of plan.groups) {
      await tx.seasonGroup.create({
        data: {
          seasonId,
          code: g.code,
          name: g.name,
          ordinal: g.ordinal,
          generationSeed: seed,
          players: {
            create: g.players.map((p) => ({ registrationId: p.registrationId, seed: p.seed })),
          },
        },
      })
    }
    await recordAudit(
      actor,
      {
        action: 'groups.generate',
        entity: 'Season',
        entityId: seasonId,
        newValue: { numGroups, seed, players: regs.length },
      },
      tx,
    )
  })
  return { ok: true, seed }
}

/** Move a player to another group (pre-publish, or with force after publish). Re-seeds affected groups. */
export async function movePlayer(
  actor: Actor,
  seasonId: number,
  registrationId: number,
  toGroupId: number,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const gp = await prisma.groupPlayer.findFirst({
    where: { registrationId, group: { seasonId } },
    include: { group: true },
  })
  if (!gp) return { ok: false, error: 'Player is not assigned to a group.' }
  const toGroup = await prisma.seasonGroup.findFirst({ where: { id: toGroupId, seasonId } })
  if (!toGroup) return { ok: false, error: 'Target group not found.' }
  if (gp.groupId === toGroupId) return { ok: true }
  const anyPublished = await prisma.seasonGroup.count({ where: { seasonId, published: true } })
  if (anyPublished > 0 && !opts.force)
    return { ok: false, error: 'Groups are published. Confirm to move players.' }

  await prisma.$transaction(async (tx) => {
    const fromGroupId = gp.groupId
    await tx.groupPlayer.delete({ where: { id: gp.id } })
    const maxSeed = await tx.groupPlayer.aggregate({
      where: { groupId: toGroupId },
      _max: { seed: true },
    })
    await tx.groupPlayer.create({
      data: { groupId: toGroupId, registrationId, seed: (maxSeed._max.seed ?? 0) + 1 },
    })
    // If groups already had matches, regenerate both affected groups' matches.
    if (anyPublished > 0) {
      for (const gid of [fromGroupId, toGroupId]) {
        await tx.seasonMatch.deleteMany({ where: { groupId: gid } })
        await generateMatchesForGroup(tx, seasonId, gid)
      }
    }
    await recordAudit(
      actor,
      {
        action: 'groups.movePlayer',
        entity: 'Registration',
        entityId: registrationId,
        oldValue: { groupId: gp.groupId },
        newValue: { groupId: toGroupId },
      },
      tx,
    )
  })
  await recomputeStandings(seasonId)
  return { ok: true }
}

/** Publish groups: lock them, generate round-robin matches, seed standings. */
export async function publishGroups(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const groups = await prisma.seasonGroup.findMany({ where: { seasonId }, include: { players: true } })
  if (groups.length === 0) return { ok: false, error: 'Generate groups before publishing.' }

  await prisma.$transaction(async (tx) => {
    await tx.seasonGroup.updateMany({ where: { seasonId }, data: { published: true } })
    await tx.season.update({ where: { id: seasonId }, data: { groupsStatus: 'PUBLISHED' } })
    for (const g of groups) {
      const existing = await tx.seasonMatch.count({ where: { groupId: g.id } })
      if (existing === 0) await generateMatchesForGroup(tx, seasonId, g.id)
    }
    await recordAudit(actor, { action: 'groups.publish', entity: 'Season', entityId: seasonId, newValue: { groups: groups.length } }, tx)
  })
  await recomputeStandings(seasonId)
  return { ok: true }
}

/** Create round-robin matches for one group from its seeded players. */
async function generateMatchesForGroup(tx: Prisma.TransactionClient, seasonId: number, groupId: number) {
  const players = await tx.groupPlayer.findMany({
    where: { groupId },
    orderBy: { seed: 'asc' },
    include: { registration: true },
  })
  const sched: SchedulePlayer[] = players.map((p) => ({
    registrationId: p.registrationId,
    username: p.registration.username,
  }))
  const matches = roundRobin(sched)
  for (const m of matches) {
    await tx.seasonMatch.create({
      data: {
        seasonId,
        groupId,
        round: m.round,
        homeRegistrationId: m.home.registrationId,
        awayRegistrationId: m.away.registrationId,
        homeUsername: m.home.username,
        awayUsername: m.away.username,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Match results
// ---------------------------------------------------------------------------

export async function recordScore(
  actor: Actor,
  matchId: number,
  homeGames: number,
  awayGames: number,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const match = await prisma.seasonMatch.findUniqueOrThrow({
    where: { id: matchId },
    include: { season: true },
  })
  const result = validateScore(
    match.season.raceLength,
    match.homeRegistrationId,
    match.awayRegistrationId,
    homeGames,
    awayGames,
  )
  if (!result.ok) return { ok: false, error: result.error }

  await prisma.seasonMatch.update({
    where: { id: matchId },
    data: {
      homeGames,
      awayGames,
      status: 'COMPLETED',
      winnerRegistrationId: result.winnerRegistrationId,
      loserRegistrationId: result.loserRegistrationId,
      verification: 'UNVERIFIED',
      completedAt: new Date(),
    },
  })
  await recordAudit(actor, {
    action: 'match.recordScore',
    entity: 'Match',
    entityId: matchId,
    oldValue: { homeGames: match.homeGames, awayGames: match.awayGames, status: match.status },
    newValue: { homeGames, awayGames, status: 'COMPLETED' },
    reason,
  })
  await recomputeStandings(match.seasonId)
  return { ok: true }
}

/** Forfeit / no-show / dispute. Forfeit & no-show award the game to the present player. */
export async function setMatchResolution(
  actor: Actor,
  matchId: number,
  kind: Extract<LiveMatchStatus, 'FORFEIT' | 'NO_SHOW' | 'DISPUTED'>,
  winnerRegistrationId: number | null,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const match = await prisma.seasonMatch.findUniqueOrThrow({
    where: { id: matchId },
    include: { season: true },
  })
  const data: Prisma.SeasonMatchUpdateInput = { status: kind, verification: 'UNVERIFIED' }
  if (kind === 'DISPUTED') {
    data.winnerRegistrationId = null
    data.loserRegistrationId = null
    data.homeGames = null
    data.awayGames = null
    data.completedAt = null
  } else {
    if (winnerRegistrationId !== match.homeRegistrationId && winnerRegistrationId !== match.awayRegistrationId)
      return { ok: false, error: 'Pick which player advances.' }
    const loserId =
      winnerRegistrationId === match.homeRegistrationId ? match.awayRegistrationId : match.homeRegistrationId
    const winnerIsHome = winnerRegistrationId === match.homeRegistrationId
    data.winnerRegistrationId = winnerRegistrationId
    data.loserRegistrationId = loserId
    data.homeGames = winnerIsHome ? match.season.raceLength : 0
    data.awayGames = winnerIsHome ? 0 : match.season.raceLength
    data.completedAt = new Date()
  }
  await prisma.seasonMatch.update({ where: { id: matchId }, data })
  await recordAudit(actor, {
    action: `match.${kind.toLowerCase()}`,
    entity: 'Match',
    entityId: matchId,
    oldValue: { status: match.status },
    newValue: { status: kind, winnerRegistrationId },
    reason,
  })
  await recomputeStandings(match.seasonId)
  return { ok: true }
}

export async function verifyMatch(actor: Actor, matchId: number, verified: boolean, reason?: string) {
  const match = await prisma.seasonMatch.findUniqueOrThrow({ where: { id: matchId } })
  if (verified && (match.status === 'SCHEDULED' || match.status === 'DISPUTED'))
    return { ok: false, error: 'Only a decided match can be verified.' }
  await prisma.seasonMatch.update({
    where: { id: matchId },
    data: { verification: verified ? 'VERIFIED' : 'UNVERIFIED' },
  })
  await recordAudit(actor, {
    action: verified ? 'match.verify' : 'match.unverify',
    entity: 'Match',
    entityId: matchId,
    oldValue: { verification: match.verification },
    newValue: { verification: verified ? 'VERIFIED' : 'UNVERIFIED' },
    reason,
  })
  await recomputeStandings(match.seasonId)
  return { ok: true }
}

export async function rescheduleMatch(actor: Actor, matchId: number, scheduledAt: Date | null, reason?: string) {
  const match = await prisma.seasonMatch.findUniqueOrThrow({ where: { id: matchId } })
  await prisma.seasonMatch.update({ where: { id: matchId }, data: { scheduledAt } })
  await recordAudit(actor, {
    action: 'match.reschedule',
    entity: 'Match',
    entityId: matchId,
    oldValue: { scheduledAt: match.scheduledAt },
    newValue: { scheduledAt },
    reason,
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Standings (single deterministic compute path, persisted)
// ---------------------------------------------------------------------------

export async function recomputeStandings(seasonId: number): Promise<void> {
  const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })
  const groups = await prisma.seasonGroup.findMany({
    where: { seasonId },
    include: { players: { include: { registration: true } } },
  })

  for (const group of groups) {
    const roster = group.players.map((p) => ({
      registrationId: p.registrationId,
      username: p.registration.username,
    }))
    const decided = await prisma.seasonMatch.findMany({
      where: {
        groupId: group.id,
        verification: 'VERIFIED',
        status: { in: ['COMPLETED', 'FORFEIT', 'NO_SHOW'] },
        NOT: { winnerRegistrationId: null },
      },
    })
    const inputs: StandingMatchInput[] = decided.map((m) => ({
      homeRegistrationId: m.homeRegistrationId,
      awayRegistrationId: m.awayRegistrationId,
      homeUsername: m.homeUsername,
      awayUsername: m.awayUsername,
      homeGames: m.homeGames ?? 0,
      awayGames: m.awayGames ?? 0,
      winnerRegistrationId: m.winnerRegistrationId!,
    }))
    const rows = computeStandings(roster, inputs, season.qualifiersPerGroup)

    await prisma.$transaction([
      prisma.standing.deleteMany({ where: { groupId: group.id } }),
      ...rows.map((r) =>
        prisma.standing.create({
          data: {
            seasonId,
            groupId: group.id,
            registrationId: r.registrationId,
            username: r.username,
            played: r.played,
            wins: r.wins,
            losses: r.losses,
            gamesWon: r.gamesWon,
            gamesLost: r.gamesLost,
            gameDiff: r.gameDiff,
            points: r.points,
            rank: r.rank,
            qualified: r.qualified,
          },
        }),
      ),
    ])
  }
}

// ---------------------------------------------------------------------------
// Playoffs
// ---------------------------------------------------------------------------

async function buildQualifiers(seasonId: number): Promise<GroupQualifiers[]> {
  const groups = await prisma.seasonGroup.findMany({
    where: { seasonId },
    orderBy: { ordinal: 'asc' },
    include: { standings: { where: { qualified: true }, orderBy: { rank: 'asc' } } },
  })
  return groups.map((g) => ({
    groupOrdinal: g.ordinal,
    players: g.standings.map((s) => ({ registrationId: s.registrationId, username: s.username })),
  }))
}

export async function previewPlayoff(seasonId: number): Promise<{ ok: boolean; error?: string; plan?: BracketPlan }> {
  const qGroups = await buildQualifiers(seasonId)
  const qualifiers = orderQualifiers(qGroups)
  if (qualifiers.length < 2) return { ok: false, error: 'Need at least 2 qualified players. Finish and verify group results first.' }
  try {
    return { ok: true, plan: planBracket(qualifiers) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not build bracket.' }
  }
}

export async function generatePlayoff(
  actor: Actor,
  seasonId: number,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const publishedCount = await prisma.playoffMatch.count({ where: { seasonId, published: true } })
  if (publishedCount > 0 && !opts.force) return { ok: false, error: 'Playoffs are published. Confirm to regenerate.' }

  const preview = await previewPlayoff(seasonId)
  if (!preview.ok || !preview.plan) return { ok: false, error: preview.error }
  const plan = preview.plan

  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.deleteMany({ where: { seasonId } })
    const idByIndex: Record<number, number> = {}
    for (const m of plan.matches) {
      const created = await tx.playoffMatch.create({
        data: {
          seasonId,
          round: m.round,
          slot: m.slot,
          label: m.label,
          homeRegistrationId: m.home.registrationId,
          awayRegistrationId: m.away.registrationId,
          homeUsername: m.home.username,
          awayUsername: m.away.username,
          homeSeed: m.home.seed,
          awaySeed: m.away.seed,
        },
      })
      idByIndex[m.index] = created.id
    }
    for (const m of plan.matches) {
      if (m.feedsIndex !== null) {
        await tx.playoffMatch.update({
          where: { id: idByIndex[m.index] },
          data: { feedsMatchId: idByIndex[m.feedsIndex], feedsSlot: m.feedsSlot },
        })
      }
    }
    await recordAudit(actor, { action: 'playoff.generate', entity: 'Season', entityId: seasonId, newValue: { matches: plan.matches.length, size: plan.bracketSize } }, tx)
  })
  return { ok: true }
}

export async function publishPlayoff(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const count = await prisma.playoffMatch.count({ where: { seasonId } })
  if (count === 0) return { ok: false, error: 'Generate the bracket before publishing.' }
  await prisma.$transaction([
    prisma.playoffMatch.updateMany({ where: { seasonId }, data: { published: true } }),
    prisma.season.update({ where: { id: seasonId }, data: { playoffsStatus: 'PUBLISHED' } }),
  ])
  await recordAudit(actor, { action: 'playoff.publish', entity: 'Season', entityId: seasonId, newValue: { published: true } })
  return { ok: true }
}

export async function recordPlayoffScore(
  actor: Actor,
  matchId: number,
  homeGames: number,
  awayGames: number,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const match = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: matchId }, include: { season: true } })
  if (match.homeRegistrationId == null || match.awayRegistrationId == null)
    return { ok: false, error: 'Both players must be determined before entering a score.' }
  const result = validateScore(match.season.raceLength, match.homeRegistrationId, match.awayRegistrationId, homeGames, awayGames)
  if (!result.ok) return { ok: false, error: result.error }
  await prisma.playoffMatch.update({
    where: { id: matchId },
    data: {
      homeGames,
      awayGames,
      status: 'COMPLETED',
      winnerRegistrationId: result.winnerRegistrationId,
      verification: 'UNVERIFIED',
      completedAt: new Date(),
    },
  })
  await recordAudit(actor, {
    action: 'playoff.recordScore',
    entity: 'PlayoffMatch',
    entityId: matchId,
    oldValue: { homeGames: match.homeGames, awayGames: match.awayGames },
    newValue: { homeGames, awayGames },
    reason,
  })
  return { ok: true }
}

/** Verify a playoff result and advance the winner into the next match. */
export async function verifyPlayoffMatch(actor: Actor, matchId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const match = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: matchId } })
  if (match.winnerRegistrationId == null) return { ok: false, error: 'Record a result before verifying.' }
  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.update({ where: { id: matchId }, data: { verification: 'VERIFIED' } })
    if (match.feedsMatchId != null) {
      const winnerIsHome = match.winnerRegistrationId === match.homeRegistrationId
      const winnerId = match.winnerRegistrationId
      const winnerName = winnerIsHome ? match.homeUsername : match.awayUsername
      const winnerSeed = winnerIsHome ? match.homeSeed : match.awaySeed
      const slotData =
        match.feedsSlot === 0
          ? { homeRegistrationId: winnerId, homeUsername: winnerName, homeSeed: winnerSeed }
          : { awayRegistrationId: winnerId, awayUsername: winnerName, awaySeed: winnerSeed }
      await tx.playoffMatch.update({ where: { id: match.feedsMatchId }, data: slotData })
    }
    await recordAudit(actor, { action: 'playoff.verify', entity: 'PlayoffMatch', entityId: matchId, newValue: { verification: 'VERIFIED' }, reason }, tx)
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function diffSubset<T extends Record<string, unknown>>(obj: T, keys: Partial<T>): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(keys) as (keyof T)[]) out[k] = obj[k]
  return out
}
