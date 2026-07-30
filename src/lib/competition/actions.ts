'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffActor } from './staff-auth'
import * as svc from './service'
import type { RegistrationStatus, LiveMatchStatus } from '@prisma/client'

export interface ActionResult {
  ok?: boolean
  error?: string
  message?: string
}

/** Revalidate every public + staff surface that consumes competition data. */
function revalidateAll() {
  for (const p of ['/', '/groups', '/playoffs', '/seasons', '/account', '/register']) revalidatePath(p)
  for (const p of [
    '/staff',
    '/staff/season',
    '/staff/registrations',
    '/staff/groups',
    '/staff/matches',
    '/staff/standings',
    '/staff/playoffs',
    '/staff/audit',
  ])
    revalidatePath(p)
}

function num(fd: FormData, name: string): number {
  return Number(fd.get(name))
}
function str(fd: FormData, name: string): string {
  return String(fd.get(name) ?? '').trim()
}

// ---- Season ---------------------------------------------------------------

export async function createSeasonAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const slug = str(fd, 'slug').toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const name = str(fd, 'name')
  if (!slug || !name) return { error: 'Provide a season name and slug.' }
  try {
    await svc.createSeason(actor, { slug, name })
    revalidateAll()
    return { ok: true, message: 'Season created.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|exists/i.test(msg)) return { error: 'A season with that slug already exists.' }
    return { error: 'Could not create the season.' }
  }
}

export async function updateSeasonAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const seasonId = num(fd, 'seasonId')
  const opensAt = str(fd, 'registrationOpensAt')
  const closesAt = str(fd, 'registrationClosesAt')
  try {
    await svc.updateSeason(
      actor,
      seasonId,
      {
        seasonStatus: str(fd, 'seasonStatus') as 'UPCOMING' | 'ACTIVE' | 'COMPLETED',
        registrationStatus: str(fd, 'registrationStatus') as 'NOT_OPEN' | 'OPEN' | 'CLOSED',
        registrationOpensAt: opensAt ? new Date(opensAt) : null,
        registrationClosesAt: closesAt ? new Date(closesAt) : null,
        groupsStatus: str(fd, 'groupsStatus') as 'PENDING' | 'PUBLISHED' | 'COMPLETED',
        playoffsStatus: str(fd, 'playoffsStatus') as 'PENDING' | 'PUBLISHED' | 'COMPLETED',
        raceLength: num(fd, 'raceLength'),
        qualifiersPerGroup: num(fd, 'qualifiersPerGroup'),
      },
      str(fd, 'reason') || undefined,
    )
    revalidateAll()
    return { ok: true, message: 'Season updated. Public pages refreshed.' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Update failed.' }
  }
}

// ---- Registrations --------------------------------------------------------

export async function setRegistrationStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  try {
    await svc.setRegistrationStatus(actor, num(fd, 'registrationId'), str(fd, 'status') as RegistrationStatus, str(fd, 'reason') || undefined)
    revalidateAll()
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Action failed.' }
  }
}

// ---- Groups ---------------------------------------------------------------

export async function generateGroupsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const res = await svc.generateGroups(actor, num(fd, 'seasonId'), num(fd, 'numGroups'), str(fd, 'seed') || undefined, {
    force: fd.get('force') === 'on',
  })
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: `Groups generated (seed ${res.seed}).` }
}

export async function movePlayerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const res = await svc.movePlayer(actor, num(fd, 'seasonId'), num(fd, 'registrationId'), num(fd, 'toGroupId'), {
    force: fd.get('force') === 'on',
  })
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function publishGroupsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const res = await svc.publishGroups(actor, num(fd, 'seasonId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Groups published. Round-robin matches generated.' }
}

// ---- Matches --------------------------------------------------------------

export async function recordScoreAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const res = await svc.recordScore(actor, num(fd, 'matchId'), num(fd, 'homeGames'), num(fd, 'awayGames'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function setResolutionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const kind = str(fd, 'kind') as Extract<LiveMatchStatus, 'FORFEIT' | 'NO_SHOW' | 'DISPUTED'>
  const winner = fd.get('winnerRegistrationId') ? num(fd, 'winnerRegistrationId') : null
  const res = await svc.setMatchResolution(actor, num(fd, 'matchId'), kind, winner, str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function verifyMatchAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const res = await svc.verifyMatch(actor, num(fd, 'matchId'), fd.get('verified') !== 'false', str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

// ---- Playoffs -------------------------------------------------------------

export async function generatePlayoffAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const res = await svc.generatePlayoff(actor, num(fd, 'seasonId'), { force: fd.get('force') === 'on' })
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Playoff bracket generated.' }
}

export async function publishPlayoffAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const res = await svc.publishPlayoff(actor, num(fd, 'seasonId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Playoffs published.' }
}

export async function recordPlayoffScoreAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const res = await svc.recordPlayoffScore(actor, num(fd, 'matchId'), num(fd, 'homeGames'), num(fd, 'awayGames'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function verifyPlayoffMatchAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireStaffActor()
  const res = await svc.verifyPlayoffMatch(actor, num(fd, 'matchId'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}
