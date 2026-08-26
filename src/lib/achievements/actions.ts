'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { recordAudit } from '@/lib/competition/audit'

import { validateDefinition, isValid, slugify, type DefinitionInput, type ValidationErrors } from './validate'
import { invalidateAchievements } from './service'
import { buildContext, evaluate } from './engine'
import type { Achievement } from './types'

/**
 * Administrative actions for achievement definitions.
 *
 * ── Every action re-checks permission ────────────────────────────────────────────────────────────
 * A Server Action is a network endpoint. The page hides these controls from non-staff, but hiding a
 * control is presentation — the refusal has to live here, where the mutation actually happens, or
 * anybody who can craft a POST can edit the site's achievements.
 *
 * ── And re-validates ─────────────────────────────────────────────────────────────────────────────
 * The form validates so the message lands next to the field. This validates because the form's
 * result is a claim made by the client, and a rule that cannot produce a sensible holder must not
 * be publishable regardless of what reached the server.
 */

export interface ActionResult {
  ok: boolean
  errors?: ValidationErrors
  id?: number
  message?: string
}

const REQUIRED_CAPABILITY = 'manage_competitions' as const

async function requireAdmin() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return { ok: false as const, message: 'Staff access is required.' }
  if (!access.actor.can(REQUIRED_CAPABILITY)) {
    return { ok: false as const, message: 'Your role cannot manage achievements.' }
  }
  return { ok: true as const, actor: access.actor }
}

/** Everything the form can set, normalised out of the raw payload. */
function shape(input: DefinitionInput) {
  const num = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : v)
  return {
    title: input.title.trim(),
    flavorText: input.flavorText?.trim() || null,
    description: input.description?.trim() || null,
    awardType: input.awardType,
    status: input.status ?? 'ACTIVE',
    displayFormat: input.displayFormat.trim(),
    statistic: input.awardType === 'AUTOMATIC' ? input.statistic || null : null,
    scope: (input.scope ?? 'ALL_COMPETITIONS') as never,
    competitionId: input.scope === 'SPECIFIC_COMPETITION' ? num(input.competitionId) : null,
    seasonId: input.scope === 'SPECIFIC_SEASON' ? num(input.seasonId) : null,
    tournamentId: input.scope === 'SPECIFIC_TOURNAMENT' ? num(input.tournamentId) : null,
    stage: (input.stage ?? 'ALL_MATCHES') as never,
    winner: (input.winner ?? 'HIGHEST') as never,
    minMatches: num(input.minMatches),
    minSeasons: num(input.minSeasons),
    minFinals: num(input.minFinals),
    minPlayoffMatches: num(input.minPlayoffMatches),
    tiePolicy: (input.tiePolicy ?? 'SHOW_ALL') as never,
    tieBreakStat: input.tiePolicy === 'SECONDARY_STAT' ? input.tieBreakStat || null : null,
    manualPlayerId: input.awardType === 'MANUAL' ? input.manualPlayerId || null : null,
    manualValue: input.awardType === 'MANUAL' ? input.manualValue?.trim() || null : null,
  }
}

export async function createAchievementAction(input: DefinitionInput): Promise<ActionResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const errors = validateDefinition(input)
  if (!isValid(errors)) return { ok: false, errors }

  /* A unique key, derived from the title and suffixed only if that name is already taken. */
  let key = input.key?.trim() || slugify(input.title)
  for (let n = 2; await prisma.achievementDefinition.findUnique({ where: { key } }); n++) {
    key = `${slugify(input.title)}-${n}`
  }

  const last = await prisma.achievementDefinition.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
  const created = await prisma.achievementDefinition.create({
    data: {
      ...shape(input),
      key,
      sortOrder: (last?.sortOrder ?? 0) + 10,
      createdBy: gate.actor.username,
      updatedBy: gate.actor.username,
    },
  })

  await recordAudit(gate.actor, {
    action: 'achievement.create', entity: 'AchievementDefinition', entityId: created.id,
    newValue: { key: created.key, title: created.title, awardType: created.awardType },
  })
  invalidateAchievements()
  revalidatePath('/achievements')
  revalidatePath('/')
  return { ok: true, id: created.id }
}

export async function updateAchievementAction(id: number, input: DefinitionInput): Promise<ActionResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const errors = validateDefinition(input)
  if (!isValid(errors)) return { ok: false, errors }

  const before = await prisma.achievementDefinition.findUnique({ where: { id } })
  if (!before) return { ok: false, message: 'That achievement no longer exists.' }

  const updated = await prisma.achievementDefinition.update({
    where: { id },
    data: { ...shape(input), updatedBy: gate.actor.username },
  })

  await recordAudit(gate.actor, {
    action: 'achievement.update', entity: 'AchievementDefinition', entityId: id,
    oldValue: { title: before.title, statistic: before.statistic, status: before.status },
    newValue: { title: updated.title, statistic: updated.statistic, status: updated.status },
  })
  invalidateAchievements()
  revalidatePath('/achievements')
  revalidatePath('/')
  return { ok: true, id }
}

/**
 * Archive, and its inverse.
 *
 * Removal is archival by default: the definition stops appearing anywhere public, keeps its full
 * configuration, and stays listed in Admin. Nothing about a rule is expensive to keep, and getting
 * one back after a real delete means rebuilding it from memory.
 */
export async function setAchievementStatusAction(id: number, status: 'ACTIVE' | 'ARCHIVED'): Promise<ActionResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const updated = await prisma.achievementDefinition.update({
    where: { id }, data: { status, updatedBy: gate.actor.username },
  })
  await recordAudit(gate.actor, {
    action: status === 'ARCHIVED' ? 'achievement.archive' : 'achievement.restore',
    entity: 'AchievementDefinition', entityId: id, newValue: { key: updated.key, status },
  })
  invalidateAchievements()
  revalidatePath('/achievements')
  revalidatePath('/')
  return { ok: true, id }
}

export async function duplicateAchievementAction(id: number): Promise<ActionResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const source = await prisma.achievementDefinition.findUnique({ where: { id } })
  if (!source) return { ok: false, message: 'That achievement no longer exists.' }

  let key = `${source.key}-copy`
  for (let n = 2; await prisma.achievementDefinition.findUnique({ where: { key } }); n++) {
    key = `${source.key}-copy-${n}`
  }

  const {
    id: _id, key: _key, createdAt: _c, updatedAt: _u, createdBy: _cb, updatedBy: _ub, ...rest
  } = source
  const copy = await prisma.achievementDefinition.create({
    data: {
      ...rest,
      key,
      title: `${source.title} (copy)`,
      /* A duplicate arrives archived, so an unfinished edit cannot appear on the homepage. */
      status: 'ARCHIVED',
      sortOrder: source.sortOrder + 1,
      createdBy: gate.actor.username,
      updatedBy: gate.actor.username,
    },
  })
  await recordAudit(gate.actor, {
    action: 'achievement.duplicate', entity: 'AchievementDefinition', entityId: copy.id,
    oldValue: { from: source.key }, newValue: { key: copy.key },
  })
  invalidateAchievements()
  revalidatePath('/achievements')
  return { ok: true, id: copy.id }
}

/**
 * Permanent deletion, behind archival.
 *
 * Only offered for something already archived, and only to an Owner. Two deliberate steps rather
 * than one, because this is the one action here that cannot be undone.
 */
export async function deleteAchievementAction(id: number): Promise<ActionResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate
  if (!gate.actor.isOwner) return { ok: false, message: 'Only the Owner can permanently delete an achievement.' }

  const existing = await prisma.achievementDefinition.findUnique({ where: { id } })
  if (!existing) return { ok: false, message: 'That achievement no longer exists.' }
  if (existing.status !== 'ARCHIVED') {
    return { ok: false, message: 'Archive it first. Permanent deletion is only available for archived achievements.' }
  }

  await prisma.achievementDefinition.delete({ where: { id } })
  await recordAudit(gate.actor, {
    action: 'achievement.delete', entity: 'AchievementDefinition', entityId: id,
    oldValue: { key: existing.key, title: existing.title },
    reason: 'Permanent deletion of an archived achievement',
  })
  invalidateAchievements()
  revalidatePath('/achievements')
  return { ok: true }
}

export async function reorderAchievementAction(id: number, direction: 'up' | 'down'): Promise<ActionResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const all = await prisma.achievementDefinition.findMany({
    where: { status: 'ACTIVE' }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, sortOrder: true },
  })
  const i = all.findIndex((a) => a.id === id)
  if (i < 0) return { ok: false, message: 'That achievement is not in the active list.' }
  const j = direction === 'up' ? i - 1 : i + 1
  if (j < 0 || j >= all.length) return { ok: true, id }

  /* Swap the two positions outright rather than renumbering the list, so one move is one write. */
  await prisma.$transaction([
    prisma.achievementDefinition.update({ where: { id: all[i].id }, data: { sortOrder: all[j].sortOrder } }),
    prisma.achievementDefinition.update({ where: { id: all[j].id }, data: { sortOrder: all[i].sortOrder } }),
  ])
  invalidateAchievements()
  revalidatePath('/achievements')
  revalidatePath('/')
  return { ok: true, id }
}

/**
 * Render a definition as it WOULD appear, without saving it.
 *
 * Runs the real engine over the real data, so the preview shows the actual current holder, the
 * actual formatted figure, and the actual empty state when a rule matches nobody. A preview built
 * from anything else would be a drawing of a card rather than the card.
 */
export async function previewAchievementAction(
  input: DefinitionInput,
): Promise<{ ok: boolean; errors?: ValidationErrors; card?: Achievement; empty?: boolean }> {
  const gate = await requireAdmin()
  if (!gate.ok) return { ok: false }

  const errors = validateDefinition(input)
  if (!isValid(errors)) return { ok: false, errors }

  /* A throwaway record shape — never written, only handed to the engine. */
  const draft = {
    id: -1,
    key: 'preview',
    sortOrder: 0,
    platform: 'YAHOO',
    emptyBehavior: 'SHOW_PLACEHOLDER',
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    manualNote: null,
    manualDate: null,
    ...shape(input),
  } as unknown as Parameters<typeof evaluate>[0]

  const ctx = await buildContext([draft])
  const card = evaluate(draft, ctx)
  return { ok: true, card: card ?? undefined, empty: card == null || card.winners.length === 0 }
}
