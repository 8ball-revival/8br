import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'

/**
 * Competitions — internally `CompetitionSeries`, labelled "Competition" everywhere in the UI so it
 * is never confused with an individual Tournament record.
 *
 * A Competition is the recurring series a Season belongs to (e.g. 8BRCAM). Every Season must belong
 * to exactly one; there is deliberately no generic "Unassigned" Competition.
 *
 * The icon reuses the existing Payload media system: `iconMediaId` is a Payload media id held as a
 * plain string (no cross-ORM FK, matching Season.bannerMediaId), served from /api/media/file/…
 * When it is absent the UI renders an initials badge derived from `shortName`.
 */

import { slugifyCompetition, type CompetitionRef, type CreateCompetitionInput } from './shared'

// Re-exported so server callers can keep importing everything Competition-related from one place.
export type { CompetitionRef, CreateCompetitionInput } from './shared'
export { slugifyCompetition, competitionInitials, competitionIconUrl } from './shared'

const SELECT = {
  id: true,
  name: true,
  slug: true,
  shortName: true,
  iconMediaId: true,
  active: true,
} as const

/** Active Competitions, for the Season form selector. */
export async function listActiveCompetitions(): Promise<CompetitionRef[]> {
  return prisma.competitionSeries.findMany({
    where: { active: true },
    orderBy: [{ name: 'asc' }],
    select: SELECT,
  })
}

/** Every Competition, active or not — staff management view. */
export async function listAllCompetitions(): Promise<CompetitionRef[]> {
  return prisma.competitionSeries.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: SELECT,
  })
}

/** Only the Competitions that actually own at least one Season — powers the public filter. */
export async function listCompetitionsWithSeasons(): Promise<CompetitionRef[]> {
  return prisma.competitionSeries.findMany({
    where: { active: true, seasons: { some: {} } },
    orderBy: [{ name: 'asc' }],
    select: SELECT,
  })
}

export async function getCompetition(id: number): Promise<CompetitionRef | null> {
  return prisma.competitionSeries.findUnique({ where: { id }, select: SELECT })
}

function validate(input: CreateCompetitionInput): { ok: true } | { ok: false; error: string } {
  const name = input.name?.trim() ?? ''
  if (!name) return { ok: false, error: 'A Competition name is required.' }
  if (name.length > 80) return { ok: false, error: 'Competition name must be 80 characters or fewer.' }
  const short = (input.shortName ?? name).trim()
  if (!short) return { ok: false, error: 'A short name is required.' }
  if (short.length > 20) return { ok: false, error: 'Short name must be 20 characters or fewer.' }
  return { ok: true }
}

/**
 * Create a Competition. The caller must already have proved ADMIN/OWNER authority — see
 * `createCompetitionAction`, which is the only path the UI uses.
 */
export async function createCompetition(
  actor: Actor,
  input: CreateCompetitionInput,
): Promise<{ ok: boolean; error?: string; competition?: CompetitionRef }> {
  const valid = validate(input)
  if (!valid.ok) return { ok: false, error: valid.error }

  const name = input.name.trim()
  const shortName = (input.shortName ?? name).trim()
  const slug = slugifyCompetition(input.slug?.trim() || shortName || name)
  if (!slug) return { ok: false, error: 'Could not derive a slug — use letters or numbers.' }

  const clash = await prisma.competitionSeries.findUnique({ where: { slug }, select: { id: true } })
  if (clash) return { ok: false, error: `A Competition with the slug "${slug}" already exists.` }

  const competition = await prisma.competitionSeries.create({
    data: { name, shortName, slug, iconMediaId: input.iconMediaId?.trim() || null, active: true },
    select: SELECT,
  })
  await recordAudit(actor, {
    action: 'competition.create',
    entity: 'CompetitionSeries',
    entityId: competition.id,
    newValue: { name, shortName, slug },
  })
  return { ok: true, competition }
}

/** Update a Competition's editable fields. ADMIN/OWNER only (enforced by the action). */
export async function updateCompetition(
  actor: Actor,
  id: number,
  patch: Partial<CreateCompetitionInput> & { active?: boolean },
): Promise<{ ok: boolean; error?: string; competition?: CompetitionRef }> {
  const existing = await prisma.competitionSeries.findUnique({ where: { id }, select: SELECT })
  if (!existing) return { ok: false, error: 'Competition not found.' }

  const next: CreateCompetitionInput = {
    name: patch.name?.trim() || existing.name,
    shortName: patch.shortName?.trim() || existing.shortName,
  }
  const valid = validate(next)
  if (!valid.ok) return { ok: false, error: valid.error }

  let slug = existing.slug
  if (patch.slug != null && patch.slug.trim()) {
    slug = slugifyCompetition(patch.slug)
    if (!slug) return { ok: false, error: 'Could not derive a slug — use letters or numbers.' }
    const clash = await prisma.competitionSeries.findFirst({
      where: { slug, id: { not: id } },
      select: { id: true },
    })
    if (clash) return { ok: false, error: `A Competition with the slug "${slug}" already exists.` }
  }

  // Deactivating is safe (it only hides the Competition from new-Season selectors); the database
  // RESTRICT on the relation is what prevents an owning Competition from being deleted.
  const competition = await prisma.competitionSeries.update({
    where: { id },
    data: {
      name: next.name,
      shortName: next.shortName ?? existing.shortName,
      slug,
      ...(patch.iconMediaId !== undefined ? { iconMediaId: patch.iconMediaId?.trim() || null } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    },
    select: SELECT,
  })
  await recordAudit(actor, {
    action: 'competition.update',
    entity: 'CompetitionSeries',
    entityId: id,
    oldValue: existing,
    newValue: competition,
  })
  return { ok: true, competition }
}
