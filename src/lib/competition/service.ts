import 'server-only'
import type { Prisma, RegistrationStatus, LiveMatchStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { currentCompetitionYear } from './competition-year'
import { recordAudit, type Actor } from './audit'
import { planGroups, type SeedableRegistration, type GroupPlan } from './groups'
import { roundRobin, type SchedulePlayer } from './schedule'
import { computeStandings, type StandingMatchInput } from './standings'
import { validateResult } from './scoring'
import { isGroupsPlayoffs, GROUP_STAGE_GAMES, computeBracketShape, playoffRaceLength } from './match-format'
import { planBracket, orderQualifiers, type GroupQualifiers, type BracketPlan, type Qualifier } from './bracket'
import { planDoubleElim } from './bracket-de'

// ---------------------------------------------------------------------------
// Tournament
// ---------------------------------------------------------------------------

export async function createSeason(
  actor: Actor,
  data: { slug: string; name: string; competitionYear?: number },
): Promise<{ id: number }> {
  const tournament = await prisma.tournament.create({
    // Competition Year is required; callers that do not supply one get the current year.
    data: { slug: data.slug, name: data.name, competitionYear: data.competitionYear ?? currentCompetitionYear() },
  })
  await recordAudit(actor, { action: 'tournament.create', entity: 'Cup', entityId: tournament.id, newValue: data })
  return { id: tournament.id }
}

export interface TournamentPatch {
  name?: string
  status?: 'UPCOMING' | 'ACTIVE' | 'COMPLETED'
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
  tournamentId: number,
  patch: TournamentPatch,
  reason?: string,
): Promise<void> {
  const before = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } })
  const after = await prisma.tournament.update({ where: { id: tournamentId }, data: patch })
  await recordAudit(actor, {
    action: 'tournament.update',
    entity: 'Cup',
    entityId: tournamentId,
    oldValue: diffSubset(before, patch),
    newValue: diffSubset(after, patch),
    reason,
  })
}

/** Mark a competition COMPLETED (final; results are locked in). Reversible via updateSeason. */
export async function completeCompetition(actor: Actor, tournamentId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!s) return { ok: false, error: 'Competition not found.' }
  if (s.status === 'COMPLETED') return { ok: true }
  await prisma.tournament.update({ where: { id: tournamentId }, data: { status: 'COMPLETED' } })
  await recordAudit(actor, { action: 'competition.complete', entity: 'Cup', entityId: tournamentId, oldValue: { status: s.status }, newValue: { status: 'COMPLETED' }, reason })
  return { ok: true }
}

/** Archive a competition (moves it to read-only history). Reversible via unarchive. */
export async function archiveCompetition(actor: Actor, tournamentId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!s) return { ok: false, error: 'Competition not found.' }
  if (s.archivedAt) return { ok: true }
  await prisma.tournament.update({ where: { id: tournamentId }, data: { archivedAt: new Date() } })
  await recordAudit(actor, { action: 'competition.archive', entity: 'Cup', entityId: tournamentId, oldValue: { archivedAt: s.archivedAt }, newValue: { archivedAt: 'now' }, reason })
  return { ok: true }
}

export async function unarchiveCompetition(actor: Actor, tournamentId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!s) return { ok: false, error: 'Competition not found.' }
  if (!s.archivedAt) return { ok: true }
  await prisma.tournament.update({ where: { id: tournamentId }, data: { archivedAt: null } })
  await recordAudit(actor, { action: 'competition.unarchive', entity: 'Cup', entityId: tournamentId, oldValue: { archivedAt: s.archivedAt }, newValue: { archivedAt: null }, reason })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Competition locking — retained as no-ops. The imported/locked historical-cup
// feature was removed in the 8BR reset; every tournament is live and editable per
// its lifecycle state, so there is nothing to lock/unlock. These stubs keep the
// call sites (teams, actions) stable.
// ---------------------------------------------------------------------------

/** No-op: locked historical competitions no longer exist. */
export async function assertCompetitionUnlocked(
  _client: Prisma.TransactionClient | typeof prisma,
  _tournamentId: number,
): Promise<void> {
  return
}

export async function isCompetitionLocked(_tournamentId: number): Promise<boolean> {
  return false
}

/** No-op (feature removed). */
export async function unlockHistoricalCompetition(_actor: Actor, _tournamentId: number, _typedCode: string, _reason: string): Promise<{ ok: boolean; error?: string }> {
  return { ok: true }
}

/** No-op (feature removed). */
export async function relockCompetition(_actor: Actor, _tournamentId: number, _reason?: string): Promise<{ ok: boolean; error?: string }> {
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
  tournamentId: number,
  userId: number,
  username: string,
  identity: RegistrationIdentity = {},
  joinPassword?: string | null,
): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!tournament) return { ok: false, error: 'Cup not found.' }
  if (tournament.registrationStatus !== 'OPEN') return { ok: false, error: 'Registration is closed.' }

  // Private tournament: the join password is verified server-side against the stored scrypt hash.
  if (tournament.accessMode === 'PASSWORD') {
    const { verifyJoinPassword } = await import('./join-password')
    if (!verifyJoinPassword((joinPassword ?? '').trim(), tournament.joinPasswordHash)) {
      return { ok: false, error: 'Incorrect join password for this private Cup.' }
    }
  }

  // Moderation gate (single point for every self-signup path — tournament + cup): a banned,
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
    const byPlayer = await prisma.registration.findUnique({ where: { tournamentId_playerId: { tournamentId, playerId: idData.playerId } } })
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
    where: { tournamentId_userId: { tournamentId, userId } },
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
    data: { tournamentId, userId, username, status: 'APPROVED', approvedAt: new Date(), ...idData },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Entrant management (admin-added, account-independent)
// ---------------------------------------------------------------------------

/**
 * Add a tournament entrant from an existing Player profile — NO website account
 * required. The entrant carries the profile's public identity and is APPROVED
 * immediately. A profile can only be entered once per tournament (unique constraint).
 */
export async function addEntrantByProfile(actor: Actor, tournamentId: number, playerId: string): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!tournament) return { ok: false, error: 'Cup not found.' }
  await assertCompetitionUnlocked(prisma, tournamentId)
  const profile = await prisma.player.findUnique({ where: { id: playerId } })
  if (!profile) return { ok: false, error: 'Player profile not found.' }

  const existing = await prisma.registration.findUnique({ where: { tournamentId_playerId: { tournamentId, playerId } } })
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
      tournamentId,
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
export async function bulkImportEntrants(actor: Actor, tournamentId: number, rawLines: string[]): Promise<BulkImportReport> {
  await assertCompetitionUnlocked(prisma, tournamentId)
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
    // A typed handle may belong to an account that has since been merged into another. Enter the
    // canonical account, not the hidden secondary, so the same person cannot be entered twice
    // under two names.
    const { resolveCanonicalPlayerId } = await import('@/lib/players/merge')
    const canonicalId = await resolveCanonicalPlayerId(profile.id)
    if (canonicalId !== profile.id) {
      profile = (await prisma.player.findUnique({ where: { id: canonicalId } })) ?? profile
    }
    const res = await addEntrantByProfile(actor, tournamentId, profile.id)
    if (res.already) duplicates.push(`${line} (${profile.primaryName})`)
    else if (res.ok) added.push(`${line} → ${profile.primaryName}`)
    else unmatched.push(line)
  }
  await recordAudit(actor, { action: 'entrant.bulkImport', entity: 'Cup', entityId: tournamentId, newValue: { added: added.length, duplicates: duplicates.length, unmatched: unmatched.length } })
  return { ok: true, added, duplicates, unmatched }
}

/** Remove an entrant from a tournament — reversible (status → WITHDRAWN, history kept). */
export async function removeEntrant(actor: Actor, tournamentId: number, registrationId: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, tournamentId)
  const reg = await prisma.registration.findFirst({ where: { id: registrationId, tournamentId } })
  if (!reg) return { ok: false, error: 'Entrant not found.' }
  const inGroup = await prisma.groupPlayer.count({ where: { registrationId } })
  if (inGroup > 0) return { ok: false, error: 'This entrant is placed in a group — remove them from the group first.' }
  await prisma.registration.update({ where: { id: registrationId }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } })
  await recordAudit(actor, { action: 'entrant.remove', entity: 'Registration', entityId: registrationId, oldValue: { status: reg.status }, newValue: { status: 'WITHDRAWN' }, reason })
  return { ok: true }
}

/** Restore a removed entrant (undo). */
export async function restoreEntrant(actor: Actor, tournamentId: number, registrationId: number): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, tournamentId)
  const reg = await prisma.registration.findFirst({ where: { id: registrationId, tournamentId } })
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
export async function reseedEntrants(actor: Actor, tournamentId: number, orderedRegistrationIds: number[]): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, tournamentId)
  const published = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (published > 0) return { ok: false, error: 'Bracket is published — return it to draft before reseeding.' }
  const ids = [...new Set(orderedRegistrationIds)].filter((n) => Number.isFinite(n))
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.registration.updateMany({ where: { id: ids[i], tournamentId }, data: { seed: i + 1 } })
    }
    await recordAudit(actor, { action: 'entrant.reseed', entity: 'Cup', entityId: tournamentId, newValue: { order: ids.length } }, tx)
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
  tournamentId: number,
  userId: number,
  username: string,
): Promise<{ ok: boolean; error?: string }> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!tournament) return { ok: false, error: 'Cup not found.' }
  if (tournament.registrationStatus !== 'OPEN')
    return { ok: false, error: 'Registration has closed — contact staff to withdraw.' }
  const reg = await prisma.registration.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
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
 * (staff member, previous status, new status, timestamp, tournament id).
 */
export type RegistrationStateValue = 'NOT_OPEN' | 'OPEN' | 'CLOSED'

export async function setRegistrationState(
  actor: Actor,
  tournamentId: number,
  next: RegistrationStateValue,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const before = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!before) return { ok: false, error: 'Cup not found.' }
  if (before.registrationStatus === next) return { ok: true }

  const action =
    next === 'OPEN'
      ? before.registrationStatus === 'CLOSED'
        ? 'registration.reopen'
        : 'registration.open'
      : next === 'CLOSED'
        ? 'registration.close'
        : 'registration.reset'

  await prisma.tournament.update({ where: { id: tournamentId }, data: { registrationStatus: next } })
  await recordAudit(actor, {
    action,
    entity: 'Cup',
    entityId: tournamentId,
    oldValue: { registrationStatus: before.registrationStatus },
    newValue: { registrationStatus: next },
    reason,
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Group generation
// ---------------------------------------------------------------------------

/**
 * Approved entrants, in the order they were added.
 *
 * The ordering is explicit rather than left to the database. Without an ORDER BY, Postgres is free to
 * return rows however it likes — usually insertion order, but not after an update rewrites a row, and
 * that is precisely the kind of difference nobody notices until a draw comes out wrong. Ordering here
 * as well as in orderRegistrations costs nothing and means the engine is handed what it expects.
 */
async function approvedSeedables(tournamentId: number): Promise<SeedableRegistration[]> {
  const regs = await prisma.registration.findMany({
    where: { tournamentId, status: 'APPROVED' },
    select: { id: true, username: true, seed: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return regs.map((r) => ({ id: r.id, username: r.username, seed: r.seed, enteredAt: r.createdAt }))
}

/** Non-persisting preview of a group draw. */
export async function previewGroups(
  tournamentId: number,
  numGroups: number,
  seed: string,
): Promise<GroupPlan> {
  const regs = await approvedSeedables(tournamentId)
  return planGroups(regs, numGroups, seed)
}

/** Generate (persist) groups from a deterministic plan. Blocks if already published unless forced. */
export async function generateGroups(
  actor: Actor,
  tournamentId: number,
  numGroups: number,
  seedInput: string | undefined,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string; seed?: string }> {
  const published = await prisma.tournamentGroup.count({ where: { tournamentId, published: true } })
  if (published > 0 && !opts.force)
    return { ok: false, error: 'Groups are already published. Confirm to regenerate.' }

  const seed = seedInput?.trim() || `Cup:${tournamentId}:groups:${numGroups}:${Date.now()}`
  const regs = await approvedSeedables(tournamentId)
  let plan: GroupPlan
  try {
    plan = planGroups(regs, numGroups, seed)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not generate groups.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.tournamentGroup.deleteMany({ where: { tournamentId } }) // cascades players/matches/standings
    for (const g of plan.groups) {
      await tx.tournamentGroup.create({
        data: {
          tournamentId,
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
        entity: 'Cup',
        entityId: tournamentId,
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
  tournamentId: number,
  registrationId: number,
  toGroupId: number,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const gp = await prisma.groupPlayer.findFirst({
    where: { registrationId, group: { tournamentId } },
    include: { group: true },
  })
  if (!gp) return { ok: false, error: 'Player is not assigned to a group.' }
  const toGroup = await prisma.tournamentGroup.findFirst({ where: { id: toGroupId, tournamentId } })
  if (!toGroup) return { ok: false, error: 'Target group not found.' }
  if (gp.groupId === toGroupId) return { ok: true }
  const anyPublished = await prisma.tournamentGroup.count({ where: { tournamentId, published: true } })
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
        await generateMatchesForGroup(tx, tournamentId, gid)
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
  await recomputeStandings(tournamentId)
  return { ok: true }
}

/** Publish groups: lock them, generate round-robin matches, seed standings. */
export async function publishGroups(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const groups = await prisma.tournamentGroup.findMany({ where: { tournamentId }, include: { players: true } })
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
    await tx.tournamentGroup.updateMany({ where: { tournamentId }, data: { published: true } })
    await tx.tournament.update({ where: { id: tournamentId }, data: { groupsStatus: 'PUBLISHED' } })
    for (const g of groups) {
      const existing = await tx.tournamentMatch.count({ where: { groupId: g.id } })
      if (existing === 0) await generateMatchesForGroup(tx, tournamentId, g.id)
    }
    await recordAudit(actor, { action: 'groups.publish', entity: 'Cup', entityId: tournamentId, newValue: { groups: groups.length } }, tx)
  })
  await recomputeStandings(tournamentId)
  return { ok: true }
}

/**
 * Unpublish groups (revert to DRAFT for corrections). Allowed only while NO result
 * has been recorded; deletes the generated round-robin matches + standings so a
 * later re-publish regenerates them cleanly. The public groups page hides them.
 */
export async function unpublishGroups(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const withResults = await prisma.tournamentMatch.count({ where: { tournamentId, NOT: { winnerRegistrationId: null } } })
  if (withResults > 0)
    return { ok: false, error: 'Results have already been recorded — unpublishing would discard them. Correct the results instead.' }
  const published = await prisma.tournamentGroup.count({ where: { tournamentId, published: true } })
  if (published === 0) return { ok: true }

  await prisma.$transaction(async (tx) => {
    await tx.tournamentMatch.deleteMany({ where: { tournamentId } })
    await tx.standing.deleteMany({ where: { tournamentId } })
    await tx.tournamentGroup.updateMany({ where: { tournamentId }, data: { published: false } })
    await tx.tournament.update({ where: { id: tournamentId }, data: { groupsStatus: 'PENDING' } })
    await recordAudit(actor, { action: 'groups.unpublish', entity: 'Cup', entityId: tournamentId, newValue: { published: false } }, tx)
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Manual group building (staff select the the tournament groups by hand)
// ---------------------------------------------------------------------------

const GROUP_CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** True if any group in the tournament is published (structural edits then need confirm). */
async function groupsArePublished(tournamentId: number): Promise<boolean> {
  return (await prisma.tournamentGroup.count({ where: { tournamentId, published: true } })) > 0
}

/** Create a new empty group with the next free code (Group A, Group B, …). */
export async function createGroup(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string; id?: number }> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!tournament) return { ok: false, error: 'Cup not found.' }
  const groups = await prisma.tournamentGroup.findMany({ where: { tournamentId } })
  const used = new Set(groups.map((g) => g.code))
  const code = [...GROUP_CODES].find((c) => !used.has(c))
  if (!code) return { ok: false, error: 'Maximum of 26 groups reached.' }
  const ordinal = groups.reduce((max, g) => Math.max(max, g.ordinal), -1) + 1
  const g = await prisma.tournamentGroup.create({ data: { tournamentId, code, name: `Group ${code}`, ordinal } })
  await recordAudit(actor, { action: 'groups.createGroup', entity: 'TournamentGroup', entityId: g.id, newValue: { code, name: g.name } })
  return { ok: true, id: g.id }
}

/** Ensure the tournament has exactly `count` groups (A..). Adds missing groups; never
 *  deletes a group that has players. Used by the "choose number of groups" control. */
export async function setGroupCount(actor: Actor, tournamentId: number, count: number): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(count) || count < 1 || count > 26) return { ok: false, error: 'Choose between 1 and 26 groups.' }
  if (await groupsArePublished(tournamentId)) return { ok: false, error: 'Unpublish groups before changing the group count.' }
  const groups = await prisma.tournamentGroup.findMany({ where: { tournamentId }, orderBy: { ordinal: 'asc' } })
  if (groups.length < count) {
    for (let i = groups.length; i < count; i++) await createGroup(actor, tournamentId)
  } else if (groups.length > count) {
    // Remove trailing groups only if they are empty.
    const removable = groups.slice(count)
    for (const g of removable) {
      const players = await prisma.groupPlayer.count({ where: { groupId: g.id } })
      if (players > 0) return { ok: false, error: `Cannot reduce below ${groups.length} — ${g.name} still has players. Empty it first.` }
    }
    for (const g of removable) await deleteGroup(actor, tournamentId, g.id)
  }
  return { ok: true }
}

/** Swap two players' group memberships (drag one player onto another). Both must be
 *  assigned to a group in this tournament; their seeds are exchanged too. */
export async function swapGroupPlayers(actor: Actor, tournamentId: number, regA: number, regB: number): Promise<{ ok: boolean; error?: string }> {
  if (regA === regB) return { ok: true }
  const a = await prisma.groupPlayer.findFirst({ where: { registrationId: regA, group: { tournamentId } } })
  const b = await prisma.groupPlayer.findFirst({ where: { registrationId: regB, group: { tournamentId } } })
  if (!a || !b) return { ok: false, error: 'Both players must already be in a group to swap.' }
  if (a.groupId === b.groupId) {
    // Same group → just exchange seed order.
    await prisma.$transaction(async (tx) => {
      await tx.groupPlayer.update({ where: { id: a.id }, data: { seed: b.seed } })
      await tx.groupPlayer.update({ where: { id: b.id }, data: { seed: a.seed } })
    })
  } else {
    const published = await groupsArePublished(tournamentId)
    await prisma.$transaction(async (tx) => {
      // Move via a temp seed to avoid any (groupId,registrationId) uniqueness churn.
      await tx.groupPlayer.update({ where: { id: a.id }, data: { groupId: b.groupId, seed: b.seed } })
      await tx.groupPlayer.update({ where: { id: b.id }, data: { groupId: a.groupId, seed: a.seed } })
      if (published) {
        for (const gid of [a.groupId, b.groupId]) {
          await tx.tournamentMatch.deleteMany({ where: { groupId: gid } })
          await generateMatchesForGroup(tx, tournamentId, gid)
        }
      }
      await recordAudit(actor, { action: 'groups.swapPlayers', entity: 'Cup', entityId: tournamentId, newValue: { a: regA, b: regB } }, tx)
    })
    if (published) await recomputeStandings(tournamentId)
  }
  return { ok: true }
}

/** Bulk-add several approved entrants to a group in one call (drag-select / bulk). */
export async function addPlayersToGroup(actor: Actor, tournamentId: number, groupId: number, registrationIds: number[]): Promise<{ ok: boolean; error?: string; added: number }> {
  let added = 0
  for (const rid of registrationIds) {
    const res = await addPlayerToGroup(actor, tournamentId, groupId, rid)
    if (res.ok) added++
  }
  return { ok: true, added }
}

/** Rename a group's display name (its code is stable). */
export async function renameGroup(actor: Actor, tournamentId: number, groupId: number, name: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: 'Enter a group name.' }
  if (trimmed.length > 60) return { ok: false, error: 'Group name is too long.' }
  const g = await prisma.tournamentGroup.findFirst({ where: { id: groupId, tournamentId } })
  if (!g) return { ok: false, error: 'Group not found.' }
  if (g.name === trimmed) return { ok: true }
  await prisma.tournamentGroup.update({ where: { id: groupId }, data: { name: trimmed } })
  await recordAudit(actor, { action: 'groups.renameGroup', entity: 'TournamentGroup', entityId: groupId, oldValue: { name: g.name }, newValue: { name: trimmed } })
  return { ok: true }
}

/** Delete an EMPTY group. Non-empty groups must be emptied first. */
export async function deleteGroup(actor: Actor, tournamentId: number, groupId: number): Promise<{ ok: boolean; error?: string }> {
  const g = await prisma.tournamentGroup.findFirst({ where: { id: groupId, tournamentId }, include: { _count: { select: { players: true } } } })
  if (!g) return { ok: false, error: 'Group not found.' }
  if (g._count.players > 0) return { ok: false, error: 'Only an empty group can be deleted. Remove or move its players first.' }
  await prisma.tournamentGroup.delete({ where: { id: groupId } })
  await recordAudit(actor, { action: 'groups.deleteGroup', entity: 'TournamentGroup', entityId: groupId, oldValue: { code: g.code, name: g.name } })
  return { ok: true }
}

/** Reorder a group up or down (swaps ordinal with its neighbour). */
export async function moveGroup(actor: Actor, tournamentId: number, groupId: number, direction: 'up' | 'down'): Promise<{ ok: boolean; error?: string }> {
  const groups = await prisma.tournamentGroup.findMany({ where: { tournamentId }, orderBy: { ordinal: 'asc' } })
  const idx = groups.findIndex((g) => g.id === groupId)
  if (idx < 0) return { ok: false, error: 'Group not found.' }
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= groups.length) return { ok: true }
  const a = groups[idx]
  const b = groups[swapIdx]
  await prisma.$transaction(async (tx) => {
    await tx.tournamentGroup.update({ where: { id: a.id }, data: { ordinal: b.ordinal } })
    await tx.tournamentGroup.update({ where: { id: b.id }, data: { ordinal: a.ordinal } })
    await recordAudit(actor, { action: 'groups.reorderGroup', entity: 'TournamentGroup', entityId: groupId, newValue: { direction } }, tx)
  })
  return { ok: true }
}

/**
 * Add an APPROVED entrant to a group. Guards: entrant belongs to the tournament, is
 * active (APPROVED), and is not already assigned to ANY group of this tournament (the
 * @@unique([groupId, registrationId]) covers same-group; this covers cross-group).
 */
export async function addPlayerToGroup(
  actor: Actor,
  tournamentId: number,
  groupId: number,
  registrationId: number,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const group = await prisma.tournamentGroup.findFirst({ where: { id: groupId, tournamentId } })
  if (!group) return { ok: false, error: 'Group not found.' }
  const reg = await prisma.registration.findFirst({ where: { id: registrationId, tournamentId } })
  if (!reg) return { ok: false, error: 'That registration is not part of this Cup.' }
  if (reg.status !== 'APPROVED') return { ok: false, error: 'Only active (approved) registrations can be assigned to a group.' }
  const existing = await prisma.groupPlayer.findFirst({ where: { registrationId, group: { tournamentId } } })
  if (existing)
    return { ok: false, error: existing.groupId === groupId ? 'That player is already in this group.' : 'That player is already assigned to another group — move them instead.' }
  const published = await groupsArePublished(tournamentId)
  if (published && !opts.force) return { ok: false, error: 'Groups are published. Confirm to edit them.' }

  await prisma.$transaction(async (tx) => {
    const maxSeed = await tx.groupPlayer.aggregate({ where: { groupId }, _max: { seed: true } })
    await tx.groupPlayer.create({ data: { groupId, registrationId, seed: (maxSeed._max.seed ?? 0) + 1 } })
    if (published) {
      await tx.tournamentMatch.deleteMany({ where: { groupId } })
      await generateMatchesForGroup(tx, tournamentId, groupId)
    }
    await recordAudit(actor, { action: 'groups.addPlayer', entity: 'TournamentGroup', entityId: groupId, newValue: { registrationId, username: reg.username } }, tx)
  })
  if (published) await recomputeStandings(tournamentId)
  return { ok: true }
}

/** Remove a player from a group. Re-seeds the remaining players to stay 1..n. */
export async function removePlayerFromGroup(
  actor: Actor,
  tournamentId: number,
  groupId: number,
  registrationId: number,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const gp = await prisma.groupPlayer.findFirst({ where: { groupId, registrationId, group: { tournamentId } } })
  if (!gp) return { ok: false, error: 'That player is not in this group.' }
  const published = await groupsArePublished(tournamentId)
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
      await generateMatchesForGroup(tx, tournamentId, groupId)
    }
    await recordAudit(actor, { action: 'groups.removePlayer', entity: 'TournamentGroup', entityId: groupId, oldValue: { registrationId } }, tx)
  })
  if (published) await recomputeStandings(tournamentId)
  return { ok: true }
}

/** Reorder a player within their group (swaps seed with the neighbour). */
export async function reorderGroupPlayer(
  actor: Actor,
  tournamentId: number,
  groupId: number,
  registrationId: number,
  direction: 'up' | 'down',
): Promise<{ ok: boolean; error?: string }> {
  const group = await prisma.tournamentGroup.findFirst({ where: { id: groupId, tournamentId } })
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
    await recordAudit(actor, { action: 'groups.reorderPlayer', entity: 'TournamentGroup', entityId: groupId, newValue: { registrationId, direction } }, tx)
  })
  return { ok: true }
}

/** Create round-robin matches for one group from its seeded players. */
async function generateMatchesForGroup(tx: Prisma.TransactionClient, tournamentId: number, groupId: number) {
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
        tournamentId,
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
    include: { tournament: true },
  })

  // Group Stage is round-robin and permits draws: any non-negative whole-number score is accepted, the
  // higher score wins, and an equal score is recorded as a draw (no winner/loser). The configured game
  // count is informational only and is not enforced.
  const result = validateResult(match.homeRegistrationId, match.awayRegistrationId, homeGames, awayGames, { allowDraw: true })
  if (!result.ok) return { ok: false, error: result.error }
  const winnerRegistrationId = result.winnerRegistrationId ?? null
  const loserRegistrationId = result.loserRegistrationId ?? null

  await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: {
      homeGames,
      awayGames,
      status: 'COMPLETED',
      winnerRegistrationId,
      loserRegistrationId,
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
  await recomputeStandings(match.tournamentId)
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
    include: { tournament: true },
  })
  const data: Prisma.TournamentMatchUpdateInput = { status: kind, verification: 'UNVERIFIED' }
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
    // Administrative forfeit/no-show awards the full match to the present player: the whole 10-game
    // Group Stage matchup for Group Stage + Playoffs, else the configurable race length.
    const fullGames = isGroupsPlayoffs(match.tournament.tournamentFormat) ? GROUP_STAGE_GAMES : match.tournament.raceLength
    data.homeGames = winnerIsHome ? fullGames : 0
    data.awayGames = winnerIsHome ? 0 : fullGames
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
  await recomputeStandings(match.tournamentId)
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
  await recomputeStandings(match.tournamentId)
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
  await recomputeStandings(m.tournamentId)
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

export async function recomputeStandings(tournamentId: number): Promise<void> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } })
  const groups = await prisma.tournamentGroup.findMany({
    where: { tournamentId },
    include: { players: { include: { registration: true } } },
  })

  for (const group of groups) {
    const roster = group.players.map((p) => ({
      registrationId: p.registrationId,
      username: p.registration.username,
    }))
    // Include every verified, completed match — a 5–5 Group Stage draw is completed with a null
    // winner and must still count (played + game stats), so it is NOT filtered out here.
    const decided = await prisma.tournamentMatch.findMany({
      where: {
        groupId: group.id,
        verification: 'VERIFIED',
        status: { in: ['COMPLETED', 'FORFEIT', 'NO_SHOW'] },
      },
    })
    const inputs: StandingMatchInput[] = decided.map((m) => ({
      homeRegistrationId: m.homeRegistrationId,
      awayRegistrationId: m.awayRegistrationId,
      homeUsername: m.homeUsername,
      awayUsername: m.awayUsername,
      homeGames: m.homeGames ?? 0,
      awayGames: m.awayGames ?? 0,
      winnerRegistrationId: m.winnerRegistrationId, // null for a draw
    }))
    const rows = computeStandings(roster, inputs, tournament.qualifiersPerGroup)

    await prisma.$transaction(async (tx) => {
      await tx.standing.deleteMany({ where: { groupId: group.id } })
      for (const r of rows) {
        await tx.standing.create({
          data: {
            tournamentId,
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

async function buildQualifiers(tournamentId: number): Promise<GroupQualifiers[]> {
  const groups = await prisma.tournamentGroup.findMany({
    where: { tournamentId },
    orderBy: { ordinal: 'asc' },
    include: { standings: { where: { qualified: true }, orderBy: { rank: 'asc' } } },
  })
  return groups.map((g) => ({
    groupOrdinal: g.ordinal,
    players: g.standings.map((s) => ({ registrationId: s.registrationId, username: s.username })),
  }))
}

export async function previewPlayoff(tournamentId: number): Promise<{ ok: boolean; error?: string; plan?: BracketPlan }> {
  const qGroups = await buildQualifiers(tournamentId)
  const qualifiers = orderQualifiers(qGroups)
  if (qualifiers.length < 2) return { ok: false, error: 'Need at least 2 qualified players. Finish and verify group results first.' }
  try {
    return { ok: true, plan: planBracket(qualifiers) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not build bracket.' }
  }
}

/** Global round number for ordering/indexing: WB 1..k, LB 101.., GF 201. Single-elim uses m.round. */
function deRound(section: 'WB' | 'LB' | 'GF', round: number): number {
  return section === 'WB' ? round : section === 'LB' ? 100 + round : 200 + round
}

/** Place a player into a downstream slot, and if that match becomes a walkover (a real player
 *  facing a Bye), auto-complete it and cascade the winner (and a Bye "loser") onward. Recursive. */
async function advancePlayerInto(
  tx: Prisma.TransactionClient,
  matchId: number,
  slot: number,
  player: { registrationId: number | null; username: string | null; seed: number | null },
): Promise<void> {
  const data =
    slot === 0
      ? { homeRegistrationId: player.registrationId, homeUsername: player.username, homeSeed: player.seed }
      : { awayRegistrationId: player.registrationId, awayUsername: player.username, awaySeed: player.seed }
  await tx.playoffMatch.update({ where: { id: matchId }, data })

  const t = await tx.playoffMatch.findUnique({ where: { id: matchId } })
  if (!t || t.status === 'COMPLETED') return
  const homeReal = t.homeRegistrationId !== null
  const awayReal = t.awayRegistrationId !== null
  const homeBye = t.homeRegistrationId === null && t.homeUsername === 'Bye'
  const awayBye = t.awayRegistrationId === null && t.awayUsername === 'Bye'
  if ((homeReal && awayBye) || (awayReal && homeBye)) {
    const winId = (homeReal ? t.homeRegistrationId : t.awayRegistrationId)!
    const winName = homeReal ? t.homeUsername : t.awayUsername
    const winSeed = homeReal ? t.homeSeed : t.awaySeed
    await tx.playoffMatch.update({
      where: { id: matchId },
      data: { winnerRegistrationId: winId, status: 'COMPLETED', verification: 'VERIFIED', completedAt: new Date() },
    })
    if (t.feedsMatchId != null) await advancePlayerInto(tx, t.feedsMatchId, t.feedsSlot!, { registrationId: winId, username: winName, seed: winSeed })
    if (t.loserFeedsMatchId != null) await advancePlayerInto(tx, t.loserFeedsMatchId, t.loserFeedsSlot!, { registrationId: null, username: 'Bye', seed: null })
  }
}

/** Persist a DOUBLE-ELIMINATION bracket (winners + losers + grand final) from seeded qualifiers. */
async function persistDoubleElimPlan(actor: Actor, tournamentId: number, qualifiers: Qualifier[]): Promise<{ ok: boolean; error?: string }> {
  let plan
  try {
    plan = planDoubleElim(qualifiers)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not build the double-elimination bracket.' }
  }
  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.deleteMany({ where: { tournamentId } })
    const idByIndex: Record<number, number> = {}
    for (const m of plan.matches) {
      const created = await tx.playoffMatch.create({
        data: {
          tournamentId,
          section: m.section,
          round: deRound(m.section, m.round),
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
      const upd: Prisma.PlayoffMatchUpdateInput = {}
      if (m.feedsIndex !== null) {
        upd.feedsMatchId = idByIndex[m.feedsIndex]
        upd.feedsSlot = m.feedsSlot
      }
      if (m.loserFeedsIndex !== null) {
        upd.loserFeedsMatchId = idByIndex[m.loserFeedsIndex]
        upd.loserFeedsSlot = m.loserFeedsSlot
      }
      if (Object.keys(upd).length) await tx.playoffMatch.update({ where: { id: idByIndex[m.index] }, data: upd })
    }
    // Mark generation-time walkovers (real vs Bye) as completed — the plan already seated the
    // advanced players downstream, so this just records the walkover result.
    for (const m of plan.matches) {
      const homeReal = m.home.registrationId !== null
      const awayReal = m.away.registrationId !== null
      const homeBye = m.home.registrationId === null && m.home.username === 'Bye'
      const awayBye = m.away.registrationId === null && m.away.username === 'Bye'
      if ((homeReal && awayBye) || (awayReal && homeBye)) {
        const winId = (homeReal ? m.home.registrationId : m.away.registrationId)!
        await tx.playoffMatch.update({
          where: { id: idByIndex[m.index] },
          data: { winnerRegistrationId: winId, status: 'COMPLETED', verification: 'VERIFIED', completedAt: new Date() },
        })
      }
    }
    await tx.tournament.update({ where: { id: tournamentId }, data: { playoffsStatus: 'PENDING' } })
    await recordAudit(actor, { action: 'playoff.generate', entity: 'Cup', entityId: tournamentId, newValue: { matches: plan.matches.length, size: plan.bracketSize, doubleElim: true } }, tx)
  })
  return { ok: true }
}

export async function generatePlayoff(
  actor: Actor,
  tournamentId: number,
  opts: { force?: boolean; doubleElim?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, tournamentId)
  const publishedCount = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (publishedCount > 0 && !opts.force) return { ok: false, error: 'Playoffs are published. Confirm to regenerate.' }

  const qualifiers = orderQualifiers(await buildQualifiers(tournamentId))
  if (qualifiers.length < 2) return { ok: false, error: 'Need at least 2 qualified players. Finish and verify group results first.' }

  if (opts.doubleElim) return persistDoubleElimPlan(actor, tournamentId, qualifiers)

  const plan = planBracket(qualifiers)
  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.deleteMany({ where: { tournamentId } })
    const idByIndex: Record<number, number> = {}
    for (const m of plan.matches) {
      const created = await tx.playoffMatch.create({
        data: {
          tournamentId,
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
    await recordAudit(actor, { action: 'playoff.generate', entity: 'Cup', entityId: tournamentId, newValue: { matches: plan.matches.length, size: plan.bracketSize } }, tx)
  })
  return { ok: true }
}

export async function publishPlayoff(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, tournamentId)
  const count = await prisma.playoffMatch.count({ where: { tournamentId } })
  if (count === 0) return { ok: false, error: 'Generate the bracket before publishing.' }
  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.updateMany({ where: { tournamentId }, data: { published: true } })
    await tx.tournament.update({ where: { id: tournamentId }, data: { playoffsStatus: 'PUBLISHED' } })
  })
  await recordAudit(actor, { action: 'playoff.publish', entity: 'Cup', entityId: tournamentId, newValue: { published: true } })
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
export async function rebuildManualPlayoff(actor: Actor, tournamentId: number, orderedRegistrationIds: number[], opts: { doubleElim?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, tournamentId)
  const publishedCount = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (publishedCount > 0) return { ok: false, error: 'Bracket is published — return it to draft before editing.' }

  const ids = [...new Set(orderedRegistrationIds)].filter((n) => Number.isFinite(n))
  if (ids.length < 2) {
    // Not enough seeds to form a bracket yet — clear any draft and keep the seeds in the pool.
    await prisma.playoffMatch.deleteMany({ where: { tournamentId } })
    return { ok: true }
  }

  const { resolveEntrants } = await import('./entrants')
  const regs = await prisma.registration.findMany({ where: { id: { in: ids }, tournamentId }, select: { id: true, username: true, displayName: true, cueverseId: true, discord: true, playerId: true } })
  const idn = await resolveEntrants(regs)
  const nameById = new Map(regs.map((r) => [r.id, idn.get(r.id)?.displayName ?? r.username]))
  const qualifiers = ids.filter((id) => nameById.has(id)).map((id, i) => ({ registrationId: id, username: nameById.get(id)!, seed: i + 1 }))
  if (qualifiers.length < 2) return { ok: false, error: 'Selected players are not valid entrants for this Cup.' }

  if (opts.doubleElim) return persistDoubleElimPlan(actor, tournamentId, qualifiers)

  let plan: BracketPlan
  try {
    plan = planBracket(qualifiers)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not build the bracket.' }
  }

  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.deleteMany({ where: { tournamentId } })
    const idByIndex: Record<number, number> = {}
    for (const m of plan.matches) {
      const created = await tx.playoffMatch.create({
        data: {
          tournamentId,
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
    await tx.tournament.update({ where: { id: tournamentId }, data: { playoffsStatus: 'PENDING' } })
    await recordAudit(actor, { action: 'playoff.manualBuild', entity: 'Cup', entityId: tournamentId, newValue: { seeds: qualifiers.length, size: plan.bracketSize } }, tx)
  })
  return { ok: true }
}

/** Return a published bracket to DRAFT so it can be edited again (only before results). */
export async function returnPlayoffToDraft(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, tournamentId)
  const withResults = await prisma.playoffMatch.count({ where: { tournamentId, NOT: { winnerRegistrationId: null } } })
  if (withResults > 0) return { ok: false, error: 'Results have been recorded — cannot return to draft. Undo those results first.' }
  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.updateMany({ where: { tournamentId }, data: { published: false } })
    await tx.tournament.update({ where: { id: tournamentId }, data: { playoffsStatus: 'PENDING' } })
    await recordAudit(actor, { action: 'playoff.returnToDraft', entity: 'Cup', entityId: tournamentId, newValue: { published: false } }, tx)
  })
  return { ok: true }
}

/** Delete the entire playoff bracket (draft only). */
export async function deletePlayoff(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  await assertCompetitionUnlocked(prisma, tournamentId)
  const publishedCount = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (publishedCount > 0) return { ok: false, error: 'Return the bracket to draft before deleting it.' }
  await prisma.playoffMatch.deleteMany({ where: { tournamentId } })
  await prisma.tournament.update({ where: { id: tournamentId }, data: { playoffsStatus: 'PENDING' } })
  await recordAudit(actor, { action: 'playoff.delete', entity: 'Cup', entityId: tournamentId })
  return { ok: true }
}

/**
 * Race length for a single playoff match. For Group Stage + Playoffs it is hard-coded per bracket
 * stage (Race to 7 early, Race to 9 for the semifinals/final/grand final) derived from the whole
 * bracket's shape; every other format uses the tournament's configurable race length.
 */
export async function resolvePlayoffRaceLength(match: { tournamentId: number; round: number; section: string | null; tournament: { tournamentFormat: string | null; raceLength: number } }): Promise<number> {
  if (!isGroupsPlayoffs(match.tournament.tournamentFormat)) return match.tournament.raceLength
  const all = await prisma.playoffMatch.findMany({ where: { tournamentId: match.tournamentId }, select: { round: true, section: true } })
  return playoffRaceLength({ round: match.round, section: match.section }, computeBracketShape(all))
}

export async function recordPlayoffScore(
  actor: Actor,
  matchId: number,
  homeGames: number,
  awayGames: number,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const match = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: matchId }, include: { tournament: true } })
  await assertCompetitionUnlocked(prisma, match.tournamentId)
  if (match.homeRegistrationId == null || match.awayRegistrationId == null)
    return { ok: false, error: 'Both players must be determined before entering a score.' }
  // A playoff bracket is elimination: any non-negative whole-number score is accepted, the higher score
  // wins, and a tie is rejected. The configured race length is an informational format, not a limit.
  const result = validateResult(match.homeRegistrationId, match.awayRegistrationId, homeGames, awayGames, { allowDraw: false })
  if (!result.ok) return { ok: false, error: result.error }
  await prisma.$transaction(async (tx) => {
    // Correcting a forfeit into a real score clears the forfeit, or the match would carry both a
    // score and a record of nobody having played it, and the ledger would still call it Elo-neutral.
    await clearStaleAdvancement(tx, match, result.winnerRegistrationId!)
    await tx.playoffMatch.update({
      where: { id: matchId },
      data: {
        homeGames,
        awayGames,
        status: 'COMPLETED',
        winnerRegistrationId: result.winnerRegistrationId,
        forfeitRegistrationId: null,
        verification: 'UNVERIFIED',
        completedAt: new Date(),
      },
    })
    await recordAudit(actor, {
      action: 'playoff.recordScore',
      entity: 'PlayoffMatch',
      entityId: matchId,
      oldValue: { homeGames: match.homeGames, awayGames: match.awayGames, status: match.status, forfeitRegistrationId: match.forfeitRegistrationId },
      newValue: { homeGames, awayGames, status: 'COMPLETED' },
      reason,
    }, tx)
  })
  return { ok: true }
}

/**
 * Clear a downstream slot that still holds the player this match USED to send there.
 *
 * A correction that changes who won leaves the previous winner sitting in the next round. Advancing
 * the new one overwrites that slot when both feed the same place, but on a double-elimination
 * bracket the loser's destination changes too. This clears whatever this match put there before the
 * new result is written, so a corrected bracket never shows both players.
 *
 * Only ever clears a slot that still holds THIS match's previous winner or loser. Somebody who
 * arrived there from a different match is left exactly where they are.
 */
async function clearStaleAdvancement(
  tx: Prisma.TransactionClient,
  match: {
    homeRegistrationId: number | null
    awayRegistrationId: number | null
    winnerRegistrationId: number | null
    feedsMatchId: number | null
    feedsSlot: number | null
    loserFeedsMatchId: number | null
    loserFeedsSlot: number | null
  },
  newWinnerId: number,
): Promise<void> {
  const prevWinner = match.winnerRegistrationId
  if (prevWinner == null || prevWinner === newWinnerId) return
  const prevLoser = prevWinner === match.homeRegistrationId ? match.awayRegistrationId : match.homeRegistrationId

  const clear = async (downId: number | null, slot: number | null, held: number | null) => {
    if (downId == null || slot == null || held == null) return
    const down = await tx.playoffMatch.findUnique({ where: { id: downId } })
    if (!down) return
    const occupant = slot === 0 ? down.homeRegistrationId : down.awayRegistrationId
    if (occupant !== held) return
    await tx.playoffMatch.update({
      where: { id: downId },
      data: slot === 0
        ? { homeRegistrationId: null, homeUsername: null, homeSeed: null }
        : { awayRegistrationId: null, awayUsername: null, awaySeed: null },
    })
  }
  await clear(match.feedsMatchId, match.feedsSlot, prevWinner)
  await clear(match.loserFeedsMatchId, match.loserFeedsSlot, prevLoser)
}

/**
 * Record a FORFEIT — one player did not play, and the other moves on.
 *
 * -- The opponent advances; the opponent does not earn a win --------------------------------------
 * `winnerRegistrationId` is set, because that is what the bracket advances on: `verifyPlayoffMatch`
 * reads it to fill the next slot, and leaving it null would strand the round. What stops it becoming
 * a competitive victory is the STATUS. `FORFEIT` makes the ledger row Elo-neutral (see matchDeltas)
 * and excludes it from W-L, streaks and the singles/team split (see computeAllTime), so the
 * advancing player's record is exactly what it was before.
 *
 * -- No fabricated score --------------------------------------------------------------------------
 * homeGames/awayGames stay NULL. A 7-0 written here would be indistinguishable from a real 7-0
 * forever after, and would feed a point differential nobody played for.
 */
export async function recordPlayoffForfeit(
  actor: Actor,
  matchId: number,
  forfeiter: 'home' | 'away',
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const match = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: matchId }, include: { tournament: true } })
  await assertCompetitionUnlocked(prisma, match.tournamentId)
  // Both sides must be real people. Without an opponent there is nobody to advance -- and a bye,
  // which is an empty slot rather than a no-show, must never be recordable as somebody's forfeit.
  if (match.homeRegistrationId == null || match.awayRegistrationId == null) {
    return { ok: false, error: 'Both players must be determined before a forfeit can be recorded.' }
  }
  const forfeiterId = forfeiter === 'home' ? match.homeRegistrationId : match.awayRegistrationId
  const winnerId = forfeiter === 'home' ? match.awayRegistrationId : match.homeRegistrationId

  await prisma.$transaction(async (tx) => {
    await clearStaleAdvancement(tx, match, winnerId)
    await tx.playoffMatch.update({
      where: { id: matchId },
      data: {
        homeGames: null,
        awayGames: null,
        status: 'FORFEIT',
        winnerRegistrationId: winnerId,
        forfeitRegistrationId: forfeiterId,
        verification: 'UNVERIFIED',
        completedAt: new Date(),
      },
    })
    await recordAudit(actor, {
      action: 'playoff.recordForfeit',
      entity: 'PlayoffMatch',
      entityId: matchId,
      oldValue: { homeGames: match.homeGames, awayGames: match.awayGames, status: match.status, winnerRegistrationId: match.winnerRegistrationId },
      newValue: { status: 'FORFEIT', forfeitRegistrationId: forfeiterId, advanced: winnerId },
      reason,
    }, tx)
  })
  return { ok: true }
}

/**
 * A cup ENTRANT self-reports their OWN LOSS (never a win). Verifies the caller is a participant,
 * the tournament is IN_PROGRESS, and the match is undecided; then records the OPPONENT as the winner
 * (race length) with the reporter's games, and advances the bracket. Duplicate/conflicting
 * submissions are rejected. A player can never report themselves as the winner (structural).
 */
export async function reportOwnLoss(userId: number, username: string, matchId: number, myGamesWon: number): Promise<{ ok: boolean; error?: string }> {
  const match = await prisma.playoffMatch.findUnique({ where: { id: matchId }, include: { tournament: true } })
  if (!match) return { ok: false, error: 'Match not found.' }
  const { getTournamentState } = await import('./tournament-lifecycle')
  if (getTournamentState(match.tournament) !== 'IN_PROGRESS') return { ok: false, error: 'This Cup is not currently in progress.' }
  if (match.winnerRegistrationId != null) return { ok: false, error: 'This match already has a reported result.' }
  if (match.homeRegistrationId == null || match.awayRegistrationId == null) return { ok: false, error: 'This match is not ready to be played yet.' }

  // Resolve the caller's entrant in this tournament (by account OR linked profile).
  const profile = await prisma.player.findUnique({ where: { linkedUserId: String(userId) }, select: { id: true } })
  const myReg = await prisma.registration.findFirst({
    where: { tournamentId: match.tournamentId, OR: [{ userId }, ...(profile ? [{ playerId: profile.id }] : [])] },
    select: { id: true },
  })
  if (!myReg) return { ok: false, error: 'You are not an entrant in this Cup.' }
  const isHome = match.homeRegistrationId === myReg.id
  const isAway = match.awayRegistrationId === myReg.id
  if (!isHome && !isAway) return { ok: false, error: 'You can only report a match you are playing in.' }

  const race = await resolvePlayoffRaceLength(match)
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
  await assertCompetitionUnlocked(prisma, match.tournamentId)
  if (match.winnerRegistrationId == null) return { ok: false, error: 'Record a result before verifying.' }
  await prisma.$transaction(async (tx) => {
    await tx.playoffMatch.update({ where: { id: matchId }, data: { verification: 'VERIFIED' } })
    const winnerIsHome = match.winnerRegistrationId === match.homeRegistrationId
    // Advance the WINNER (handles walkovers into a Bye).
    if (match.feedsMatchId != null) {
      await advancePlayerInto(tx, match.feedsMatchId, match.feedsSlot!, {
        registrationId: match.winnerRegistrationId,
        username: winnerIsHome ? match.homeUsername : match.awayUsername,
        seed: winnerIsHome ? match.homeSeed : match.awaySeed,
      })
    }
    // Double-elimination: drop the LOSER into the losers bracket (also handles walkovers).
    if (match.loserFeedsMatchId != null) {
      await advancePlayerInto(tx, match.loserFeedsMatchId, match.loserFeedsSlot!, {
        registrationId: winnerIsHome ? match.awayRegistrationId : match.homeRegistrationId,
        username: winnerIsHome ? match.awayUsername : match.homeUsername,
        seed: winnerIsHome ? match.awaySeed : match.homeSeed,
      })
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
  await assertCompetitionUnlocked(prisma, m.tournamentId)
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
    // Double-elimination: also clear the LOSER's dropped slot if it still holds this match's loser.
    if (m.loserFeedsMatchId != null && m.winnerRegistrationId != null) {
      const loserId = m.winnerRegistrationId === m.homeRegistrationId ? m.awayRegistrationId : m.homeRegistrationId
      const down = await tx.playoffMatch.findUnique({ where: { id: m.loserFeedsMatchId } })
      const heldId = m.loserFeedsSlot === 0 ? down?.homeRegistrationId : down?.awayRegistrationId
      if (down && loserId != null && heldId === loserId) {
        const slotData =
          m.loserFeedsSlot === 0
            ? { homeRegistrationId: null, homeUsername: null, homeSeed: null }
            : { awayRegistrationId: null, awayUsername: null, awaySeed: null }
        await tx.playoffMatch.update({ where: { id: m.loserFeedsMatchId }, data: slotData })
      }
    }
    await tx.playoffMatch.update({
      where: { id: matchId },
      data: { status: 'SCHEDULED', homeGames: null, awayGames: null, winnerRegistrationId: null, forfeitRegistrationId: null, verification: 'UNVERIFIED', completedAt: null },
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
  await assertCompetitionUnlocked(prisma, m.tournamentId)
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

/**
 * Set (or clear) the note shown under a tournament's playoff bracket.
 *
 * Mirrors `setSeasonPlayoffDisclaimer`. Requires a bracket to exist — there is nothing to annotate
 * before then — but is deliberately NOT gated on lifecycle beyond that: the note describes the
 * bracket rather than changing it, and the case that most needs one is a finished tournament
 * reconstructed from an archive whose scores were never recorded.
 */
export async function setTournamentPlayoffDisclaimer(
  actor: Actor,
  tournamentId: number,
  text: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } })
  if (!t) return { ok: false, error: 'Cup not found.' }

  const hasBracket =
    (await prisma.playoffMatch.count({ where: { tournamentId } })) > 0 ||
    (await prisma.tournamentBracketMatch.count({ where: { tournamentId } })) > 0
  if (!hasBracket) return { ok: false, error: 'There is no bracket to annotate yet.' }

  const value = (text ?? '').trim().slice(0, 500) || null
  await prisma.$transaction(async (tx) => {
    await tx.tournament.update({ where: { id: tournamentId }, data: { playoffDisclaimer: value } })
    await recordAudit(actor, {
      action: value ? 'tournament.playoff.disclaimer' : 'tournament.playoff.disclaimer.clear',
      entity: 'Cup', entityId: tournamentId, newValue: { length: value?.length ?? 0 },
    }, tx)
  })
  return { ok: true }
}
