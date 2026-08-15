'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/lib/competition/staff-auth'
import { getCurrentUser } from '@/lib/account/auth'
import { getProfileByUserId } from '@/lib/players/service'
import {
  createSeason,
  addSeasonEntrant,
  removeSeasonEntrant,
  searchSeasonCandidates,
  closeRegistration,
  registerSelf,
  type CreateSeasonConfig,
  type SeasonCandidate,
} from './service'
import { prisma } from '@/lib/prisma'

export interface SeasonActionResult {
  ok?: boolean
  error?: string
  message?: string
}

function revalidateSeason(number?: number | null) {
  if (number != null) revalidatePath(`/seasons/${number}`)
  revalidatePath('/seasons')
}

async function seasonNumberOf(seasonId: number): Promise<number | null> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { number: true } })
  return s?.number ?? null
}

// ---- Creation -------------------------------------------------------------

export async function createSeasonAction(cfg: CreateSeasonConfig): Promise<SeasonActionResult & { number?: number }> {
  const actor = await requireCapability('manage_competitions')
  const res = await createSeason(actor, cfg)
  if (!res.ok || !res.number) return { error: res.error ?? 'Could not create the Season.' }
  revalidateSeason(res.number)
  return { ok: true, number: res.number, message: `Created WCC Season ${res.number}.` }
}

// ---- Registration (admin) -------------------------------------------------

export async function searchSeasonPlayersAction(seasonId: number, query: string): Promise<SeasonCandidate[]> {
  await requireCapability('manage_registrations')
  return searchSeasonCandidates(seasonId, query)
}

export async function addSeasonEntrantAction(seasonId: number, playerId: string): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_registrations')
  const res = await addSeasonEntrant(actor, seasonId, playerId)
  if (!res.ok) return { error: res.error }
  revalidateSeason(await seasonNumberOf(seasonId))
  return { ok: true, message: 'Added 1 entrant.' }
}

export async function removeSeasonEntrantAction(seasonId: number, entrantId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_registrations')
  const res = await removeSeasonEntrant(actor, seasonId, entrantId)
  if (!res.ok) return { error: res.error }
  revalidateSeason(await seasonNumberOf(seasonId))
  return { ok: true, message: 'Entrant removed.' }
}

export async function closeSeasonRegistrationAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await closeRegistration(actor, seasonId)
  if (!res.ok) return { error: res.error }
  revalidateSeason(await seasonNumberOf(seasonId))
  return { ok: true, message: 'Registration closed — ratings snapshot captured. Set up the groups next.' }
}

// ---- Self-registration (members) ------------------------------------------

export async function registerForSeasonAction(seasonNumber: number, joinPassword: string): Promise<SeasonActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to register for this Season.' }
  const profile = await getProfileByUserId(Number(user.id))
  if (!profile) return { error: 'Complete your player profile before registering.' }
  const res = await registerSelf(Number(user.id), { playerId: profile.id, name: profile.primaryName, handle: profile.cueverseId }, seasonNumber, joinPassword)
  if (!res.ok) return { error: res.error }
  revalidateSeason(seasonNumber)
  revalidatePath('/account')
  return { ok: true, message: "You're registered for this Season." }
}
