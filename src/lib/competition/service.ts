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
  const season = await prisma.tournament.create({ data: { slug: data.slug, name: data.name } })
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
  const before = await prisma.tournament.findUniqueOrThrow({ where: { id: seasonId } })
  const after = await prisma.tournament.update({ where: { id: seasonId }, data: patch })
  await recordAudit(actor, {
    action: 'season.update',
    entity: 'Season',
    entityId: seasonId,
    oldValue: diffSubset(before, patch),
    newValue: diffSubset(after, patch),
    reason,
  })
}

/** Mark a competition COMPLETED (final; results are locked in). Reversible via updateSeason. */
export async function completeCompetition(actor: Actor, seasonId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!s) return { ok: false, error: 'Competition not found.' }
  if (s.seasonStatus === 'COMPLETED') return { ok: true }
  await prisma.tournament.update({ where: { id: seasonId }, data: { seasonStatus: 'COMPLETED' } })
  await recordAudit(actor, { action: 'competition.complete', entity: 'Season', entityId: seasonId, oldValue: { seasonStatus: s.seasonStatus }, newValue: { seasonStatus: 'COMPLETED' }, reason })
  return { ok: true }
}

/** Archive a competition (moves it to read-only history). Reversible via unarchive. */
export async function archiveCompetition(actor: Actor, seasonId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!s) return { ok: false, error: 'Competition not found.' }
  if (s.archivedAt) return { ok: true }
  await prisma.tournament.update({ where: { id: seasonId }, data: { archivedAt: new Date() } })
  await recordAudit(actor, { action: 'competition.archive', entity: 'Season', entityId: seasonId, oldValue: { archivedAt: s.archivedAt }, newValue: { archivedAt: 'now' }, reason })
  return { ok: true }
}

export async function unarchiveCompetition(actor: Actor, seasonId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!s) return { ok: false, error: 'Competition not found.' }
  if (!s.archivedAt) return { ok: true }
  await prisma.tournament.update({ where: { id: seasonId }, data: { archivedAt: null } })
  await recordAudit(actor, { action: 'competition.unarchive', entity: 'Season', entityId: seasonId, oldValue: { archivedAt: s.archivedAt }, newValue: { archivedAt: null }, reason })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Historical Cup locking (imported cups are ARCHIVED + locked; edits require an
// Owner to explicitly unlock, with typed-code confirmation + reason + audit).
// ---------------------------------------------------------------------------

/** Throws if the competition is a locked historical competition. Every cup-mutating
 *  service path calls this so historical results can never be changed accidentally. */
export async function assertCompetitionUnlocked(client: Prisma.TransactionClient | typeof prisma, seasonId: number): Promise<void> {
  const s = await client.season.findUnique({ where: { id: seasonId }, select: { locked: true, competitionCode: true } })
  if (s?.locked) throw new Error(`This is a locked historical competition (${s.competitionCode ?? seasonId}). An Owner must unlock it before editing.`)
}

export async function isCompetitionLocked(seasonId: number): Promise<boolean> {
  return (await prisma.tournament.findUnique({ where: { id: seasonId }, select: { locked: true } }))?.locked ?? false
}

/** OWNER-ONLY: unlock a locked historical competition for correction. Requires the
 *  typed competition code + a reason; records who/when in the audit log. */
export async function unlockHistoricalCompetition(actor: Actor, seasonId: number, typedCode: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!s) return { ok: false, error: 'Competition not found.' }
  if (!s.locked) return { ok: true }
  if (!reason.trim()) return { ok: false, error: 'A reason is required to unlock a historical competition.' }
  if (typedCode.trim() !== (s.competitionCode ?? '')) return { ok: false, error: `Confirmation code does not match. Type ${s.competitionCode} to confirm.` }
  await prisma.tournament.update({ where: { id: seasonId }, data: { locked: false, unlockedAt: new Date() } })
  await recordAudit(actor, { action: 'competition.unlock', entity: 'Season', entityId: seasonId, oldValue: { locked: true }, newValue: { locked: false, unlockedBy: actor.username, code: s.competitionCode }, reason })
  return { ok: true }
}

/** OWNER-ONLY: re-lock a competition after corrections. */
export async function relockCompetition(actor: Actor, seasonId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!s) return { ok: false, error: 'Competition not found.' }
  if (s.locked) return { ok: true }
  await prisma.tournament.update({ where: { id: seasonId }, data: { locked: true } })
  await recordAudit(actor, { action: 'competition.relock', entity: 'Season', entityId: seasonId, oldValue: { locked: false }, newValue: { locked: true }, reason })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

/** Public sign-up: creates a PENDING registration. Enforces open state + dedupe. */
export interface RegistrationIdentity {
  displayName?: string | null
  cueverseId?: string | null
  discord?: string | null
  timeZone?: string | null
  playerId?: string | null // set when the account is already linked to a canonical profile
}

export async function createPublicRegistration(
  seasonId: number,
  userId: number,
  username: string,
  identity: RegistrationIdentity = {},
): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const season = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!season) return { ok: false, error: 'Season not found.' }
  if (season.registrationStatus !== 'OPEN') return { ok: false, error: 'Registration is closed.' }

  // Moderation gate (single point for every self-signup path — season + cup): a banned,
  // timed-out or deleted account can never enter, regardless of the form used.
  const { resolveMemberStatus } = await import('@/lib/moderation/service')
  const modStatus = await resolveMemberStatus(userId)
  if (!modStatus.canRegister)
    return { ok: false, error: modStatus.status === 'BANNED' ? 'This account is banned and cannot register.' : modStatus.status === 'TIMED_OUT' ? 'This account is timed out and cannot register.' : 'This account cannot register.' }

  const idData = {
    displayName: identity.displayName ?? null,
    cueverseId: identity.cueverseId ?? null,
    discord: identity.discord ?? null,
    timeZone: identity.timeZone ?? null,
    playerId: identity.playerId ?? null,
  }

  // If this account is linked to a profile that an admin already entered (account-less),
  // ADOPT that existing entrant instead of creating a duplicate — the account takes it over.
  if (idData.playerId) {
    const byPlayer = await prisma.registration.findUnique({ where: { seasonId_playerId: { seasonId, playerId: idData.playerId } } })
    if (byPlayer && byPlayer.userId == null) {
      await prisma.registration.update({
        where: { id: byPlayer.id },
        data: { userId, username, status: 'APPROVED', approvedAt: new Date(), withdrawnAt: null, ...idData },
      })
      return { ok: true }
    }
    if (byPlayer && byPlayer.userId !== userId) return { ok: false, error: 'That player is already entered under another account.' }
  }

  const existing = await prisma.registration.findUnique({
    where: { seasonId_userId: { seasonId, userId } },
  })
  if (existing) {
    // Re-registering after withdrawing/being rejected reactivates immediately.
    if (existing.status === 'WITHDRAWN' || existing.status === 'REJECTED') {
      await prisma.registration.update({
        where: { id: existing.id },
        data: { status: 'APPROVED', approvedAt: new Date(), withdrawnAt: null, ...idData },
      })
      return { ok: true }
    }
    return { ok: true, already: true }
  }
  // Normal public registration is ACTIVE immediately — no staff approval required.
  // (Staff retain moderation: withdraw/reject/restore, and PENDING for manual flags.)
  await prisma.registration.create({
    data: { seasonId, userId, username, status: 'APPROVED', approvedAt: new Date(), ...idData },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Entrant management (admin-added, account-independent)
// ---------------------------------------------------------------------------

/**
 * Add a tournament entrant from an existing Player profile — NO website account
 * required. The entrant carries the profile's public identity and is APPROVED
 * immediately. A profile can only be entered once per season (unique constraint).
 */
export async function addEntrantByProfile(actor: Actor, seasonId: number, playerId: string): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const season = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!season) return { ok: false, error: 'Season not found.' }
  await assertCompetitionUnlocked(prisma, seasonId)
  const profile = await prisma.player.findUnique({ where: { id: playerId } })
  if (!profile) return { ok: false, error: 'Player profile not found.' }

  const existing = await prisma.registration.findUnique({ where: { seasonId_playerId: { seasonId, playerId } } })
  if (existing) {
    if (existing.status === 'WITHDRAWN' || existing.status === 'REJECTED') {
      await prisma.registration.update({ where: { id: existing.id }, data: { status: 'APPROVED', approvedAt: new Date(), withdrawnAt: null } })
      await recordAudit(actor, { action: 'entrant.restore', entity: 'Registration', entityId: existing.id, newValue: { playerId, name: profile.primaryName } })
      return { ok: true }
    }
    return { ok: true, already: true }
  }

  const created = await prisma.registration.create({
    data: {
      seasonId,
      userId: null,
      username: profile.primaryName,
      status: 'APPROVED',
      approvedAt: new Date(),
      addedByAdmin: true,
      displayName: profile.primaryName,
      cueverseId: profile.cueverseId,
      discord: profile.discord,
      timeZone: profile.timeZone,
      playerId,
    },
  })
  await recordAudit(actor, { action: 'entrant.add', entity: 'Registration', entityId: created.id, newValue: { playerId, name: profile.primaryName } })
  return { ok: true }
}

export interface BulkImportReport {
  ok: boolean
  added: string[]
  duplicates: string[]
  unmatched: string[]
}

/**
 * Bulk-add entrants by pasting CueVerse IDs (one per line). Each line is matched to
 * an existing Player profile (by primary CueVerse ID or a known alias); matches are
 * added (already-entered profiles are skipped as duplicates); unmatched lines are
 * reported back so staff can create those profiles first.
 */
export async function bulkImportEntrants(actor: Actor, seasonId: number, rawLines: string[]): Promise<BulkImportReport> {
  await assertCompetitionUnlocked(prisma, seasonId)
  const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const lines = [...new Set(rawLines.map((l) => l.trim()).filter(Boolean))]
  const added: string[] = []
  const duplicates: string[] = []
  const unmatched: string[] = []

  for (const line of lines) {
    const key = nk(line)
    if (!key) continue
    // Match by primary CueVerse ID first, then by any alias.
    let profile = await prisma.player.findFirst({ where: { cueverseId: { equals: line, mode: 'insensitive' } } })
    if (!profile) {
      const alias = await prisma.playerAlias.findFirst({ where: { alias: key }, include: { player: true } })
      profile = alias?.player ?? null
    }
    if (!profile) { unmatched.push(line); continue }
    const res = await addEntrantByProfile(actor, seasonId, profile.id)
    if (res.already) duplicates.push(`${line} (${profile.primaryName})`)
    else if (res.ok) added.push(`${line} → ${profile.primaryName}`)
    else unmatched.push(line)
  }
  await recordAudit(actor, { action: 'entrant.bulkImport', entity: 'Season', entityId: seasonId, newValue: { added: added.length, duplicates: duplicates.length, unmatched: unmatched.length } })
  return { ok: true, added, duplicates, unmatched }
}

/** Remove an entrant from a season — reversible (status → WITHDRAWN, history kept). */
export async function removeEntrant(actor: Actor, seasonId: number, registrationId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, seasonId)
  const reg = await prisma.registration.findFirst({ where: { id: registrationId, seasonId } })
  if (!reg) return { ok: false, error: 'Entrant not found.' }
  const inGroup = await prisma.groupPlayer.count({ where: { registrationId } })
  if (inGroup > 0) return { ok: false, error: 'This entrant is placed in a group — remove them from the group first.' }
  await prisma.registration.update({ where: { id: registrationId }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } })
  await recordAudit(actor, { action: 'entrant.remove', entity: 'Registration', entityId: registrationId, oldValue: { status: reg.status }, newValue: { status: 'WITHDRAWN' }, reason })
  return { ok: true }
}

/** Restore a removed entrant (undo). */
export async function restoreEntrant(actor: Actor, seasonId: number, registrationId: number): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, seasonId)
  const reg = await prisma.registration.findFirst({ where: { id: registrationId, seasonId } })
  if (!reg) return { ok: false, error: 'Entrant not found.' }
  await prisma.registration.update({ where: { id: registrationId }, data: { status: 'APPROVED', approvedAt: new Date(), withdrawnAt: null } })
  await recordAudit(actor, { action: 'entrant.restore', entity: 'Registration', entityId: registrationId, oldValue: { status: reg.status }, newValue: { status: 'APPROVED' } })
  return { ok: true }
}

/** Add a manual, account-less entrant by display name (temporary / unlinked competitor). */
/**
 * REMOVED capability — free-text / "temporary" entrants are no longer permitted. Every entrant in a
 * new cup must reference a permanent registered player (use `addEntrantByProfile`). This backstop
 * stays so any lingering caller fails loudly on the server instead of silently creating an
 * account-less, ranking-orphaning entrant. Historical temporary entrants are untouched.
 */
export async function addManualEntrant(_actor: Actor, _seasonId: number, _name: string): Promise<{ ok: boolean; error?: string; id?: number }> {
  return { ok: false, error: 'Temporary entrants are no longer supported. Add a registered player instead.' }
}

/** Persist the entrant seeding order (Registration.seed = position). Drives the default
 *  bracket seed order; blocked while a published bracket exists (return to draft first). */
export async function reseedEntrants(actor: Actor, seasonId: number, orderedRegistrationIds: number[]): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, seasonId)
  const published = await prisma.playoffMatch.count({ where: { seasonId, published: true } })
  if (published > 0) return { ok: false, error: 'Bracket is published — return it to draft before reseeding.' }
  const ids = [...new Set(orderedRegistrationIds)].filter((n) => Number.isFinite(n))
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.registration.updateMany({ where: { id: ids[i], seasonId }, data: { seed: i + 1 } })
    }
    await recordAudit(actor, { action: 'entrant.reseed', entity: 'Season', entityId: seasonId, newValue: { order: ids.length } }, tx)
  })
  return { ok: true }
}

/**
 * Public SELF-withdrawal: a member removes their own entry, allowed ONLY while
 * registration is still OPEN ("before registration closes"). History is preserved
 * (status → WITHDRAWN) and the member is recorded as the actor. After close, only
 * staff can withdraw via setRegistrationStatus.
 */
export async function withdrawPublicRegistration(
  seasonId: number,
  userId: number,
  username: string,
): Promise<{ ok: boolean; error?: string }> {
  const season = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!season) return { ok: false, error: 'Season not found.' }
  if (season.registrationStatus !== 'OPEN')
    return { ok: false, error: 'Registration has closed — contact staff to withdraw.' }
  const reg = await prisma.registration.findUnique({
    where: { seasonId_userId: { seasonId, userId } },
  })
  if (!reg || (reg.status !== 'PENDING' && reg.status !== 'APPROVED'))
    return { ok: false, error: 'You are not currently registered.' }
  await prisma.registration.update({
    where: { id: reg.id },
    data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
  })
  await recordAudit(
    { userId, username },
    {
      action: 'registration.withdrawn',
      entity: 'Registration',
      entityId: reg.id,
      oldValue: { status: reg.status },
      newValue: { status: 'WITHDRAWN' },
      reason: 'Self-withdrawal by member',
    },
  )
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

/**
 * Open / close / reopen registration. This manual staff status is AUTHORITATIVE —
 * registration is allowed if and only if it is OPEN, regardless of any deadline
 * (the deadline is informational only). Records the transition in the audit log
 * (staff member, previous status, new status, timestamp, season id).
 */
export type RegistrationStateValue = 'NOT_OPEN' | 'OPEN' | 'CLOSED'

export async function setRegistrationState(
  actor: Actor,
  seasonId: number,
  next: RegistrationStateValue,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const before = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!before) return { ok: false, error: 'Season not found.' }
  if (before.registrationStatus === next) return { ok: true }

  const action =
    next === 'OPEN'
      ? before.registrationStatus === 'CLOSED'
        ? 'registration.reopen'
        : 'registration.open'
      : next === 'CLOSED'
        ? 'registration.close'
        : 'registration.reset'

  await prisma.tournament.update({ where: { id: seasonId }, data: { registrationStatus: next } })
  await recordAudit(actor, {
    action,
    entity: 'Season',
    entityId: seasonId,
    oldValue: { registrationStatus: before.registrationStatus },
    newValue: { registrationStatus: next },
    reason,
  })
  return { ok: true }
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
  const published = await prisma.tournamentGroup.count({ where: { seasonId, published: true } })
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
    await tx.tournamentGroup.deleteMany({ where: { seasonId } }) // cascades players/matches/standings
    for (const g of plan.groups) {
      await tx.tournamentGroup.create({
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
  const toGroup = await prisma.tournamentGroup.findFirst({ where: { id: toGroupId, seasonId } })
  if (!toGroup) return { ok: false, error: 'Target group not found.' }
  if (gp.groupId === toGroupId) return { ok: true }
  const anyPublished = await prisma.tournamentGroup.count({ where: { seasonId, published: true } })
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
        await tx.tournamentMatch.deleteMany({ where: { groupId: gid } })
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
  const groups = await prisma.tournamentGroup.findMany({ where: { seasonId }, include: { players: true } })
  if (groups.length === 0) return { ok: false, error: 'Create at least one group before publishing.' }

  // Never publish an empty group.
  const empty = groups.filter((g) => g.players.length === 0)
  if (empty.length > 0)
    return { ok: false, error: `Cannot publish empty group(s): ${empty.map((g) => g.name).join(', ')}. Add players or delete them.` }

  // Never publish while any player is assigned to more than one group.
  const seen = new Map<number, string>()
  for (const g of groups) {
    for (const p of g.players) {
      const prior = seen.get(p.registrationId)
      if (prior) return { ok: false, error: `A player is assigned to both ${prior} and ${g.name}. Fix duplicate assignments before publishing.` }
      seen.set(p.registrationId, g.name)
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.tournamentGroup.updateMany({ where: { seasonId }, data: { published: true } })
    await tx.tournament.update({ where: { id: seasonId }, data: { groupsStatus: 'PUBLISHED' } })
    for (const g of groups) {
      const existing = await tx.tournamentMatch.count({ where: { groupId: g.id } })
      if (existing === 0) await generateMatchesForGroup(tx, seasonId, g.id)
    }
    await recordAudit(actor, { action: 'groups.publish', entity: 'Season', entityId: seasonId, newValue: { groups: groups.length } }, tx)
  })
  await recomputeStandings(seasonId)
  return { ok: true }
}

/**
 * Unpublish groups (revert to DRAFT for corrections). Allowed only while NO result
 * has been recorded; deletes the generated round-robin matches + standings so a
 * later re-publish regenerates them cleanly. The public groups page hides them.
 */
export async function unpublishGroups(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const withResults = await prisma.tournamentMatch.count({ where: { seasonId, NOT: { winnerRegistrationId: null } } })
  if (withResults > 0)
    return { ok: false, error: 'Results have already been recorded — unpublishing would discard them. Correct the results instead.' }
  const published = await prisma.tournamentGroup.count({ where: { seasonId, published: true } })
  if (published === 0) return { ok: true }

  await prisma.$transaction(async (tx) => {
    await tx.tournamentMatch.deleteMany({ where: { seasonId } })
    await tx.standing.deleteMany({ where: { seasonId } })
    await tx.tournamentGroup.updateMany({ where: { seasonId }, data: { published: false } })
    await tx.tournament.update({ where: { id: seasonId }, data: { groupsStatus: 'PENDING' } })
    await recordAudit(actor, { action: 'groups.unpublish', entity: 'Season', entityId: seasonId, newValue: { published: false } }, tx)
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Manual group building (staff select the Season 2 groups by hand)
// ---------------------------------------------------------------------------

const GROUP_CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** True if any group in the season is published (structural edits then need confirm). */
async function groupsArePublished(seasonId: number): Promise<boolean> {
  return (await prisma.tournamentGroup.count({ where: { seasonId, published: true } })) > 0
}

/** Create a new empty group with the next free code (Group A, Group B, …). */
export async function createGroup(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string; id?: number }> {
  const season = await prisma.tournament.findUnique({ where: { id: seasonId } })
  if (!season) return { ok: false, error: 'Season not found.' }
  const groups = await prisma.tournamentGroup.findMany({ where: { seasonId } })
  const used = new Set(groups.map((g) => g.code))
  const code = [...GROUP_CODES].find((c) => !used.has(c))
  if (!code) return { ok: false, error: 'Maximum of 26 groups reached.' }
  const ordinal = groups.reduce((max, g) => Math.max(max, g.ordinal), -1) + 1
  const g = await prisma.tournamentGroup.create({ data: { seasonId, code, name: `Group ${code}`, ordinal } })
  await recordAudit(actor, { action: 'groups.createGroup', entity: 'SeasonGroup', entityId: g.id, newValue: { code, name: g.name } })
  return { ok: true, id: g.id }
}

/** Ensure the season has exactly `count` groups (A..). Adds missing groups; never
 *  deletes a group that has players. Used by the "choose number of groups" control. */
export async function setGroupCount(actor: Actor, seasonId: number, count: number): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(count) || count < 1 || count > 26) return { ok: false, error: 'Choose between 1 and 26 groups.' }
  if (await groupsArePublished(seasonId)) return { ok: false, error: 'Unpublish groups before changing the group count.' }
  const groups = await prisma.tournamentGroup.findMany({ where: { seasonId }, orderBy: { ordinal: 'asc' } })
  if (groups.length < count) {
    for (let i = groups.length; i < count; i++) await createGroup(actor, seasonId)
  } else if (groups.length > count) {
    // Remove trailing groups only if they are empty.
    const removable = groups.slice(count)
    for (const g of removable) {
      const players = await prisma.groupPlayer.count({ where: { groupId: g.id } })
      if (players > 0) return { ok: false, error: `Cannot reduce below ${groups.length} — ${g.name} still has players. Empty it first.` }
    }
    for (const g of removable) await deleteGroup(actor, seasonId, g.id)
  }
  return { ok: true }
}

/** Swap two players' group memberships (drag one player onto another). Both must be
 *  assigned to a group in this season; their seeds are exchanged too. */
export async function swapGroupPlayers(actor: Actor, seasonId: number, regA: number, regB: number): Promise<{ ok: boolean; error?: string }> {
  if (regA === regB) return { ok: true }
  const a = await prisma.groupPlayer.findFirst({ where: { registrationId: regA, group: { seasonId } } })
  const b = await prisma.groupPlayer.findFirst({ where: { registrationId: regB, group: { seasonId } } })
  if (!a || !b) return { ok: false, error: 'Both players must already be in a group to swap.' }
  if (a.groupId === b.groupId) {
    // Same group → just exchange seed order.
    await prisma.$transaction(async (tx) => {
      await tx.groupPlayer.update({ where: { id: a.id }, data: { seed: b.seed } })
      await tx.groupPlayer.update({ where: { id: b.id }, data: { seed: a.seed } })
    })
  } else {
    const published = await groupsArePublished(seasonId)
    await prisma.$transaction(async (tx) => {
      // Move via a temp seed to avoid any (groupId,registrationId) uniqueness churn.
      await tx.groupPlayer.update({ where: { id: a.id }, data: { groupId: b.groupId, seed: b.seed } })
      await tx.groupPlayer.update({ where: { id: b.id }, data: { groupId: a.groupId, seed: a.seed } })
      if (published) {
        for (const gid of [a.groupId, b.groupId]) {
          await tx.tournamentMatch.deleteMany({ where: { groupId: gid } })
          await generateMatchesForGroup(tx, seasonId, gid)
        }
      }
      await recordAudit(actor, { action: 'groups.swapPlayers', entity: 'Season', entityId: seasonId, newValue: { a: regA, b: regB } }, tx)
    })
    if (published) await recomputeStandings(seasonId)
  }
  return { ok: true }
}

/** Bulk-add several approved entrants to a group in one call (drag-select / bulk). */
export async function addPlayersToGroup(actor: Actor, seasonId: number, groupId: number, registrationIds: number[]): Promise<{ ok: boolean; error?: string; added: number }> {
  let added = 0
  for (const rid of registrationIds) {
    const res = await addPlayerToGroup(actor, seasonId, groupId, rid)
    if (res.ok) added++
  }
  return { ok: true, added }
}

/** Rename a group's display name (its code is stable). */
export async function renameGroup(actor: Actor, seasonId: number, groupId: number, name: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'Enter a group name.' }
  if (trimmed.length > 60) return { ok: false, error: 'Group name is too long.' }
  const g = await prisma.tournamentGroup.findFirst({ where: { id: groupId, seasonId } })
  if (!g) return { ok: false, error: 'Group not found.' }
  if (g.name === trimmed) return { ok: true }
  await prisma.tournamentGroup.update({ where: { id: groupId }, data: { name: trimmed } })
  await recordAudit(actor, { action: 'groups.renameGroup', entity: 'SeasonGroup', entityId: groupId, oldValue: { name: g.name }, newValue: { name: trimmed } })
  return { ok: true }
}

/** Delete an EMPTY group. Non-empty groups must be emptied first. */
export async function deleteGroup(actor: Actor, seasonId: number, groupId: number): Promise<{ ok: boolean; error?: string }> {
  const g = await prisma.tournamentGroup.findFirst({ where: { id: groupId, seasonId }, include: { _count: { select: { players: true } } } })
  if (!g) return { ok: false, error: 'Group not found.' }
  if (g._count.players > 0) return { ok: false, error: 'Only an empty group can be deleted. Remove or move its players first.' }
  await prisma.tournamentGroup.delete({ where: { id: groupId } })
  await recordAudit(actor, { action: 'groups.deleteGroup', entity: 'SeasonGroup', entityId: groupId, oldValue: { code: g.code, name: g.name } })
  return { ok: true }
}

/** Reorder a group up or down (swaps ordinal with its neighbour). */
export async function moveGroup(actor: Actor, seasonId: number, groupId: number, direction: 'up' | 'down'): Promise<{ ok: boolean; error?: string }> {
  const groups = await prisma.tournamentGroup.findMany({ where: { seasonId }, orderBy: { ordinal: 'asc' } })
  const idx = groups.findIndex((g) => g.id === groupId)
  if (idx < 0) return { ok: false, error: 'Group not found.' }
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= groups.length) return { ok: true }
  const a = groups[idx]
  const b = groups[swapIdx]
  await prisma.$transaction(async (tx) => {
    await tx.tournamentGroup.update({ where: { id: a.id }, data: { ordinal: b.ordinal } })
    await tx.tournamentGroup.update({ where: { id: b.id }, data: { ordinal: a.ordinal } })
    await recordAudit(actor, { action: 'groups.reorderGroup', entity: 'SeasonGroup', entityId: groupId, newValue: { direction } }, tx)
  })
  return { ok: true }
}

/**
 * Add an APPROVED entrant to a group. Guards: entrant belongs to the season, is
 * active (APPROVED), and is not already assigned to ANY group of this season (the
 * @@unique([groupId, registrationId]) covers same-group; this covers cross-group).
 */
export async function addPlayerToGroup(
  actor: Actor,
  seasonId: number,
  groupId: number,
  registrationId: number,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const group = await prisma.tournamentGroup.findFirst({ where: { id: groupId, seasonId } })
  if (!group) return { ok: false, error: 'Group not found.' }
  const reg = await prisma.registration.findFirst({ where: { id: registrationId, seasonId } })
  if (!reg) return { ok: false, error: 'That registration is not part of this season.' }
  if (reg.status !== 'APPROVED') return { ok: false, error: 'Only active (approved) registrations can be assigned to a group.' }
  const existing = await prisma.groupPlayer.findFirst({ where: { registrationId, group: { seasonId } } })
  if (existing)
    return { ok: false, error: existing.groupId === groupId ? 'That player is already in this group.' : 'That player is already assigned to another group — move them instead.' }
  const published = await groupsArePublished(seasonId)
  if (published && !opts.force) return { ok: false, error: 'Groups are published. Confirm to edit them.' }

  await prisma.$transaction(async (tx) => {
    const maxSeed = await tx.groupPlayer.aggregate({ where: { groupId }, _max: { seed: true } })
    await tx.groupPlayer.create({ data: { groupId, registrationId, seed: (maxSeed._max.seed ?? 0) + 1 } })
    if (published) {
      await tx.tournamentMatch.deleteMany({ where: { groupId } })
      await generateMatchesForGroup(tx, seasonId, groupId)
    }
    await recordAudit(actor, { action: 'groups.addPlayer', entity: 'SeasonGroup', entityId: groupId, newValue: { registrationId, username: reg.username } }, tx)
  })
  if (published) await recomputeStandings(seasonId)
  return { ok: true }
}

/** Remove a player from a group. Re-seeds the remaining players to stay 1..n. */
export async function removePlayerFromGroup(
  actor: Actor,
  seasonId: number,
  groupId: number,
  registrationId: number,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const gp = await prisma.groupPlayer.findFirst({ where: { groupId, registrationId, group: { seasonId } } })
  if (!gp) return { ok: false, error: 'That player is not in this group.' }
  const published = await groupsArePublished(seasonId)
  if (published && !opts.force) return { ok: false, error: 'Groups are published. Confirm to edit them.' }

  await prisma.$transaction(async (tx) => {
    await tx.groupPlayer.delete({ where: { id: gp.id } })
    const rest = await tx.groupPlayer.findMany({ where: { groupId }, orderBy: { seed: 'asc' } })
    let s = 1
    for (const p of rest) {
      if (p.seed !== s) await tx.groupPlayer.update({ where: { id: p.id }, data: { seed: s } })
      s++
    }
    if (published) {
      await tx.tournamentMatch.deleteMany({ where: { groupId } })
      await generateMatchesForGroup(tx, seasonId, groupId)
    }
    await recordAudit(actor, { action: 'groups.removePlayer', entity: 'SeasonGroup', entityId: groupId, oldValue: { registrationId } }, tx)
  })
  if (published) await recomputeStandings(seasonId)
  return { ok: true }
}

/** Reorder a player within their group (swaps seed with the neighbour). */
export async function reorderGroupPlayer(
  actor: Actor,
  seasonId: number,
  groupId: number,
  registrationId: number,
  direction: 'up' | 'down',
): Promise<{ ok: boolean; error?: string }> {
  const group = await prisma.tournamentGroup.findFirst({ where: { id: groupId, seasonId } })
  if (!group) return { ok: false, error: 'Group not found.' }
  const players = await prisma.groupPlayer.findMany({ where: { groupId }, orderBy: { seed: 'asc' } })
  const idx = players.findIndex((p) => p.registrationId === registrationId)
  if (idx < 0) return { ok: false, error: 'Player not in group.' }
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= players.length) return { ok: true }
  const a = players[idx]
  const b = players[swapIdx]
  await prisma.$transaction(async (tx) => {
    await tx.groupPlayer.update({ where: { id: a.id }, data: { seed: b.seed } })
    await tx.groupPlayer.update({ where: { id: b.id }, data: { seed: a.seed } })
    await recordAudit(actor, { action: 'groups.reorderPlayer', entity: 'SeasonGroup', entityId: groupId, newValue: { registrationId, direction } }, tx)
  })
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
    await tx.tournamentMatch.create({
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
  const match = await prisma.tournamentMatch.findUniqueOrThrow({
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

  await prisma.tournamentMatch.update({
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
  const match = await prisma.tournamentMatch.findUniqueOrThrow({
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
  await prisma.tournamentMatch.update({ where: { id: matchId }, data })
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
  const match = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } })
  if (verified && (match.status === 'SCHEDULED' || match.status === 'DISPUTED'))
    return { ok: false, error: 'Only a decided match can be verified.' }
  await prisma.tournamentMatch.update({
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
  const match = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } })
  await prisma.tournamentMatch.update({ where: { id: matchId }, data: { scheduledAt } })
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

/**
 * Undo a group match result — revert it to SCHEDULED, clearing the score, winner,
 * and verification. Standings are recomputed (verified results only), so rankings
 * and player stats that read from this data update on next read.
 */
export async function undoMatchResult(actor: Actor, matchId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const m = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } })
  if (m.status === 'SCHEDULED' && m.winnerRegistrationId == null && m.homeGames == null)
    return { ok: false, error: 'This match has no recorded result to undo.' }
  await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: { status: 'SCHEDULED', homeGames: null, awayGames: null, winnerRegistrationId: null, loserRegistrationId: null, verification: 'UNVERIFIED', completedAt: null },
  })
  await recordAudit(actor, {
    action: 'match.undo',
    entity: 'Match',
    entityId: matchId,
    oldValue: { status: m.status, homeGames: m.homeGames, awayGames: m.awayGames, winnerRegistrationId: m.winnerRegistrationId },
    newValue: { status: 'SCHEDULED' },
    reason,
  })
  await recomputeStandings(m.seasonId)
  return { ok: true }
}

/** Attach / update / clear an optional admin note on a group match result. */
export async function setMatchNote(actor: Actor, matchId: number, note: string): Promise<{ ok: boolean; error?: string }> {
  const m = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } })
  const clean = note.trim() || null
  if (clean === (m.note ?? null)) return { ok: true }
  await prisma.tournamentMatch.update({ where: { id: matchId }, data: { note: clean } })
  await recordAudit(actor, { action: 'match.note', entity: 'Match', entityId: matchId, oldValue: { note: m.note }, newValue: { note: clean } })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Standings (single deterministic compute path, persisted)
// ---------------------------------------------------------------------------

export async function recomputeStandings(seasonId: number): Promise<void> {
  const season = await prisma.tournament.findUniqueOrThrow({ where: { id: seasonId } })
  const groups = await prisma.tournamentGroup.findMany({
    where: { seasonId },
    include: { players: { include: { registration: true } } },
  })

  for (const group of groups) {
    const roster = group.players.map((p) => ({
      registrationId: p.registrationId,
      username: p.registration.username,
    }))
    const decided = await prisma.tournamentMatch.findMany({
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

    await prisma.$transaction(async (tx) => {
      await tx.standing.deleteMany({ where: { groupId: group.id } })
      for (const r of rows) {
        await tx.standing.create({
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
        })
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Playoffs
// ---------------------------------------------------------------------------

async function buildQualifiers(seasonId: number): Promise<GroupQualifiers[]> {
  const groups = await prisma.tournamentGroup.findMany({
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
  await assertCompetitionUnlocked(prisma, seasonId)
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
  await assertCompetitionUnlocked(prisma, seasonId)
  const count = await prisma.playoffMatch.count({ where: { seasonId } })
  if (count === 0) return { ok: false, error: 'Generate the bracket before publishing.' }
  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.updateMany({ where: { seasonId }, data: { published: true } })
    await tx.tournament.update({ where: { id: seasonId }, data: { playoffsStatus: 'PUBLISHED' } })
  })
  await recordAudit(actor, { action: 'playoff.publish', entity: 'Season', entityId: seasonId, newValue: { published: true } })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Manual playoff builder (staff seed the bracket by hand — single elimination)
// ---------------------------------------------------------------------------

/**
 * Rebuild the DRAFT single-elimination bracket from a manual, ordered seed list
 * (seed 1 = the first entry). The bracket auto-sizes to the next power of two with
 * byes for empty slots (`planBracket`), reusing the exact same persistence + public
 * rendering as the auto-generator. Blocked while published (return to draft first).
 * Names are the entrants' resolved public display identity.
 */
export async function rebuildManualPlayoff(actor: Actor, seasonId: number, orderedRegistrationIds: number[]): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, seasonId)
  const publishedCount = await prisma.playoffMatch.count({ where: { seasonId, published: true } })
  if (publishedCount > 0) return { ok: false, error: 'Bracket is published — return it to draft before editing.' }

  const ids = [...new Set(orderedRegistrationIds)].filter((n) => Number.isFinite(n))
  if (ids.length < 2) {
    // Not enough seeds to form a bracket yet — clear any draft and keep the seeds in the pool.
    await prisma.playoffMatch.deleteMany({ where: { seasonId } })
    return { ok: true }
  }

  const { resolveEntrants } = await import('./entrants')
  const regs = await prisma.registration.findMany({ where: { id: { in: ids }, seasonId }, select: { id: true, username: true, displayName: true, cueverseId: true, discord: true, playerId: true } })
  const idn = await resolveEntrants(regs)
  const nameById = new Map(regs.map((r) => [r.id, idn.get(r.id)?.displayName ?? r.username]))
  const qualifiers = ids.filter((id) => nameById.has(id)).map((id, i) => ({ registrationId: id, username: nameById.get(id)!, seed: i + 1 }))
  if (qualifiers.length < 2) return { ok: false, error: 'Selected players are not valid entrants for this season.' }

  let plan: BracketPlan
  try {
    plan = planBracket(qualifiers)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not build the bracket.' }
  }

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
        await tx.playoffMatch.update({ where: { id: idByIndex[m.index] }, data: { feedsMatchId: idByIndex[m.feedsIndex], feedsSlot: m.feedsSlot } })
      }
    }
    await tx.tournament.update({ where: { id: seasonId }, data: { playoffsStatus: 'PENDING' } })
    await recordAudit(actor, { action: 'playoff.manualBuild', entity: 'Season', entityId: seasonId, newValue: { seeds: qualifiers.length, size: plan.bracketSize } }, tx)
  })
  return { ok: true }
}

/** Return a published bracket to DRAFT so it can be edited again (only before results). */
export async function returnPlayoffToDraft(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, seasonId)
  const withResults = await prisma.playoffMatch.count({ where: { seasonId, NOT: { winnerRegistrationId: null } } })
  if (withResults > 0) return { ok: false, error: 'Results have been recorded — cannot return to draft. Undo those results first.' }
  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.updateMany({ where: { seasonId }, data: { published: false } })
    await tx.tournament.update({ where: { id: seasonId }, data: { playoffsStatus: 'PENDING' } })
    await recordAudit(actor, { action: 'playoff.returnToDraft', entity: 'Season', entityId: seasonId, newValue: { published: false } }, tx)
  })
  return { ok: true }
}

/** Delete the entire playoff bracket (draft only). */
export async function deletePlayoff(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, seasonId)
  const publishedCount = await prisma.playoffMatch.count({ where: { seasonId, published: true } })
  if (publishedCount > 0) return { ok: false, error: 'Return the bracket to draft before deleting it.' }
  await prisma.playoffMatch.deleteMany({ where: { seasonId } })
  await prisma.tournament.update({ where: { id: seasonId }, data: { playoffsStatus: 'PENDING' } })
  await recordAudit(actor, { action: 'playoff.delete', entity: 'Season', entityId: seasonId })
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
  await assertCompetitionUnlocked(prisma, match.seasonId)
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

/**
 * A cup ENTRANT self-reports their OWN LOSS (never a win). Verifies the caller is a participant,
 * the cup is IN_PROGRESS, and the match is undecided; then records the OPPONENT as the winner
 * (race length) with the reporter's games, and advances the bracket. Duplicate/conflicting
 * submissions are rejected. A player can never report themselves as the winner (structural).
 */
export async function reportOwnLoss(userId: number, username: string, matchId: number, myGamesWon: number): Promise<{ ok: boolean; error?: string }> {
  const match = await prisma.playoffMatch.findUnique({ where: { id: matchId }, include: { season: true } })
  if (!match) return { ok: false, error: 'Match not found.' }
  if (match.season.competitionType !== 'CUP') return { ok: false, error: 'This is not a cup match.' }
  const { getCupState } = await import('./cup-lifecycle')
  if (getCupState(match.season) !== 'IN_PROGRESS') return { ok: false, error: 'This cup is not currently in progress.' }
  if (match.winnerRegistrationId != null) return { ok: false, error: 'This match already has a reported result.' }
  if (match.homeRegistrationId == null || match.awayRegistrationId == null) return { ok: false, error: 'This match is not ready to be played yet.' }

  // Resolve the caller's entrant in this cup (by account OR linked profile).
  const profile = await prisma.player.findUnique({ where: { linkedUserId: String(userId) }, select: { id: true } })
  const myReg = await prisma.registration.findFirst({
    where: { seasonId: match.seasonId, OR: [{ userId }, ...(profile ? [{ playerId: profile.id }] : [])] },
    select: { id: true },
  })
  if (!myReg) return { ok: false, error: 'You are not an entrant in this cup.' }
  const isHome = match.homeRegistrationId === myReg.id
  const isAway = match.awayRegistrationId === myReg.id
  if (!isHome && !isAway) return { ok: false, error: 'You can only report a match you are playing in.' }

  const race = match.season.raceLength
  const mine = Math.max(0, Math.min(Number.isFinite(myGamesWon) ? myGamesWon : 0, race - 1)) // a loss is strictly < race
  const homeGames = isHome ? mine : race // the OPPONENT (winner) gets the full race
  const awayGames = isHome ? race : mine

  const actor: Actor = { userId, username }
  const rec = await recordPlayoffScore(actor, matchId, homeGames, awayGames, 'Self-reported loss')
  if (!rec.ok) return rec
  await verifyPlayoffMatch(actor, matchId, 'Self-reported loss')
  return { ok: true }
}

/** Verify a playoff result and advance the winner into the next match. */
export async function verifyPlayoffMatch(actor: Actor, matchId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const match = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: matchId } })
  await assertCompetitionUnlocked(prisma, match.seasonId)
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

/**
 * Undo a playoff match result — revert it to SCHEDULED and clear its score/winner.
 * If the (now-undone) winner had already advanced into a downstream slot, that slot
 * is cleared too, so the bracket stays consistent.
 */
export async function undoPlayoffResult(actor: Actor, matchId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const m = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: matchId } })
  await assertCompetitionUnlocked(prisma, m.seasonId)
  if (m.winnerRegistrationId == null && m.status === 'SCHEDULED' && m.homeGames == null)
    return { ok: false, error: 'This match has no recorded result to undo.' }
  await prisma.$transaction(async (tx) => {
    if (m.feedsMatchId != null && m.winnerRegistrationId != null) {
      const down = await tx.playoffMatch.findUnique({ where: { id: m.feedsMatchId } })
      const heldId = m.feedsSlot === 0 ? down?.homeRegistrationId : down?.awayRegistrationId
      // Only clear the downstream slot if it still holds THIS match's winner.
      if (down && heldId === m.winnerRegistrationId) {
        const slotData =
          m.feedsSlot === 0
            ? { homeRegistrationId: null, homeUsername: null, homeSeed: null }
            : { awayRegistrationId: null, awayUsername: null, awaySeed: null }
        await tx.playoffMatch.update({ where: { id: m.feedsMatchId }, data: slotData })
      }
    }
    await tx.playoffMatch.update({
      where: { id: matchId },
      data: { status: 'SCHEDULED', homeGames: null, awayGames: null, winnerRegistrationId: null, verification: 'UNVERIFIED', completedAt: null },
    })
    await recordAudit(actor, {
      action: 'playoff.undo',
      entity: 'PlayoffMatch',
      entityId: matchId,
      oldValue: { homeGames: m.homeGames, awayGames: m.awayGames, winnerRegistrationId: m.winnerRegistrationId },
      newValue: { status: 'SCHEDULED' },
      reason,
    }, tx)
  })
  return { ok: true }
}

/** Attach / update / clear an optional admin note on a playoff match result. */
export async function setPlayoffNote(actor: Actor, matchId: number, note: string): Promise<{ ok: boolean; error?: string }> {
  const m = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: matchId } })
  await assertCompetitionUnlocked(prisma, m.seasonId)
  const clean = note.trim() || null
  if (clean === (m.note ?? null)) return { ok: true }
  await prisma.playoffMatch.update({ where: { id: matchId }, data: { note: clean } })
  await recordAudit(actor, { action: 'playoff.note', entity: 'PlayoffMatch', entityId: matchId, oldValue: { note: m.note }, newValue: { note: clean } })
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
