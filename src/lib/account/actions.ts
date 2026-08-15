'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getPayload, type Where } from 'payload'
import config from '@payload-config'

import {
  normalizeUsername,
  normalizeCueverseId,
  cueverseLoginKey,
  validateEmail,
  validatePassword,
  validatePreferredName,
  validateCueverseId,
  validateDiscord,
  validateTimeZone,
} from './validation'
import { getCurrentUser } from './auth'
import { safeReturnTo } from './return-to'
import { getActiveSeason } from '@/lib/competition/queries'
import { createPublicRegistration, withdrawPublicRegistration } from '@/lib/competition/service'
import { getProfileByUserId, changeCueverseId, createOrLinkAccountProfile } from '@/lib/players/service'

export interface FormResult {
  ok?: boolean
  error?: string
  already?: boolean
}

const COOKIE = 'payload-token'

async function payload() {
  return getPayload({ config: await config })
}

async function setSessionCookie(token: string, exp?: number) {
  const store = await cookies()
  store.set(COOKIE, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: exp ? new Date(exp * 1000) : undefined,
  })
  // The auth-dependent SiteHeader lives in the shared root layout, which the client Router
  // Cache persists across navigations. Invalidate the layout so the header reflects the NEW
  // session immediately after any login (no manual refresh). Every login path routes through
  // here (signIn / createAccount / claimAccount / resetPassword), so this covers them all.
  revalidatePath('/', 'layout')
}

/** Whether any account exists yet. First-owner setup is only available while this is false. */
export async function ownerExists(): Promise<boolean> {
  const p = await payload()
  const { totalDocs } = await p.count({ collection: 'users' })
  return totalDocs > 0
}

/**
 * SECURE FIRST-OWNER SETUP. Creates the very first administrator (Owner) account. Works ONLY
 * while NO account exists, and — if the SETUP_SECRET env var is set — requires the matching
 * secret. It self-disables permanently once any account exists. There is no default password
 * and no hardcoded credentials; the human chooses them here. This is the ONLY path that may
 * mint the Owner (the Users bootstrap hook rejects any other first-account creation).
 */
export async function createFirstOwner(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const p = await payload()
  const { totalDocs } = await p.count({ collection: 'users' })
  if (totalDocs > 0) return { error: 'Setup is already complete — an administrator account already exists.' }

  const secret = process.env.SETUP_SECRET
  if (secret && String(formData.get('setupSecret') ?? '') !== secret) {
    return { error: 'Invalid setup secret.' }
  }

  const username = normalizeUsername(String(formData.get('username') ?? ''))
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')
  if (!username) return { error: 'Choose a username for the owner account.' }
  const emErr = validateEmail(email)
  if (emErr) return { error: emErr }
  const pwErr = validatePassword(password)
  if (pwErr) return { error: pwErr }
  if (password !== confirm) return { error: 'Passwords do not match.' }

  try {
    await p.create({
      collection: 'users',
      data: { username, email, password, roles: ['owner'] },
      overrideAccess: true,
      // The ONLY place this flag is set — authorizes the Users bootstrap hook to mint the Owner.
      context: { allowBootstrap: true },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|already|duplicate/i.test(msg)) return { error: 'That username or email is already in use.' }
    return { error: 'Could not create the owner account.' }
  }

  try {
    const res = await p.login({ collection: 'users', data: { username, password } })
    if (res.token) await setSessionCookie(res.token, res.exp)
  } catch {
    redirect('/login')
  }
  redirect('/account')
}

/** Create an account (User ID + email + password). Email verification is DISABLED
 *  for launch — the account is usable immediately. Auto-signs-in and redirects. */
export async function createAccount(_prev: FormResult, formData: FormData): Promise<FormResult> {
  // Signup captures ONLY: CueVerse ID, Email, Password. The CueVerse ID is the account's
  // public identity AND its login handle. Preferred Name / Discord / Time Zone are OPTIONAL
  // and are added later in My Account — never required here or to enter a competition.
  const cueverseId = normalizeCueverseId(String(formData.get('cueverseId') ?? '')) // trimmed, capitalization preserved
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const err = validateCueverseId(cueverseId) || validateEmail(email) || validatePassword(password)
  if (err) return { error: err }

  // Login handle = case-insensitive CueVerse ID (Payload username uniqueness is the enforcement).
  const username = cueverseLoginKey(cueverseId)

  const p = await payload()

  // Public registration is locked until the site owner has completed first-run setup. (The Users
  // bootstrap hook also enforces this server-side; this yields a friendlier message.)
  const { totalDocs: userCount } = await p.count({ collection: 'users' })
  if (userCount === 0) {
    return { error: 'Registration opens once the site owner completes setup. Please check back soon.' }
  }

  // Reject a duplicate CueVerse ID regardless of capitalization (username is the lowered form).
  const existing = await p.find({ collection: 'users', where: { username: { equals: username } }, limit: 1, overrideAccess: true })
  if (existing.totalDocs > 0) {
    return { error: 'That CueVerse ID or email is already in use.' }
  }

  let newUserId: number
  try {
    // skipAutoProfile: this flow creates the linked profile below with the chosen CueVerse ID
    // casing, so the Users afterChange back-fill hook must not pre-create one from the username.
    const created = await p.create({ collection: 'users', data: { username, email, password, roles: ['member'] }, overrideAccess: true, context: { skipAutoProfile: true } })
    newUserId = Number(created.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|already|duplicate/i.test(msg)) return { error: 'That CueVerse ID or email is already in use.' }
    return { error: 'Could not create the account. Please check your details and try again.' }
  }

  // One account = one Player profile. The display CueVerse ID keeps its original capitalization;
  // no Preferred Name yet (public pages fall back to the CueVerse ID).
  const provision = await createOrLinkAccountProfile(newUserId, username, { cueverseId })
  if (!provision.ok) {
    await p.delete({ collection: 'users', id: newUserId, overrideAccess: true }).catch(() => {})
    return { error: provision.error }
  }

  const returnTo = safeReturnTo(String(formData.get('returnTo') ?? ''))
  try {
    const res = await p.login({ collection: 'users', data: { username, password } })
    if (res.token) await setSessionCookie(res.token, res.exp)
  } catch {
    redirect(returnTo === '/account' ? '/login' : `/login?returnTo=${encodeURIComponent(returnTo)}`)
  }
  // Send a new member back to where they started (e.g. the tournament they were joining).
  redirect(returnTo)
}

/** Sign in with User ID or email + password. */
export async function signIn(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const identifier = String(formData.get('identifier') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  if (!identifier || !password) return { error: 'Enter your CueVerse ID (or email) and password.' }

  const data = identifier.includes('@')
    ? { email: identifier.toLowerCase(), password }
    : { username: normalizeUsername(identifier), password }

  const p = await payload()
  let token: string | undefined
  let exp: number | undefined
  let userId: number | undefined
  try {
    const res = await p.login({ collection: 'users', data })
    if (!res.token) return { error: 'Invalid credentials.' }
    token = res.token
    exp = res.exp
    userId = Number(res.user?.id)
  } catch {
    return { error: 'Invalid CueVerse ID/email or password.' }
  }
  // Block disabled provisioned accounts from signing in.
  if (userId) {
    const { prisma } = await import('@/lib/prisma')
    const claim = await prisma.accountClaim.findUnique({ where: { userId } })
    if (claim?.disabledAt) return { error: 'This account has been disabled. Contact an administrator.' }
    // Moderation gate: banned or deleted accounts cannot sign in.
    const { resolveMemberStatus } = await import('@/lib/moderation/service')
    const status = await resolveMemberStatus(userId)
    if (!status.canLogin)
      return { error: status.status === 'BANNED' ? 'This account has been banned.' : 'This account has been deleted.' }
    // Admin-initiated password reset: an expired temporary code blocks sign-in; a still-valid one lets
    // the player in but forces them straight to setting a permanent password.
    const { pendingResetGate } = await import('@/lib/staff/password-reset')
    const gate = await pendingResetGate(userId)
    if (gate.expired) return { error: 'Your temporary access code has expired. Ask an administrator to issue a new one.' }
    if (gate.forceChange) {
      await setSessionCookie(token!, exp)
      redirect('/account/set-password')
    }
  }
  await setSessionCookie(token!, exp)
  // Return the user to where they started (e.g. the tournament they were joining), if a safe local
  // path was carried through; otherwise the account page.
  redirect(safeReturnTo(String(formData.get('returnTo') ?? '')))
}

/**
 * Request a password reset. Accepts a CueVerse ID (User ID) or email, resolves it to the
 * account's recovery email, and triggers Payload's forgotPassword (which emails a reset link
 * via the configured adapter). ALWAYS returns a generic success — it never reveals whether an
 * account exists, and never surfaces email-delivery errors (no account enumeration).
 */
export async function requestPasswordReset(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const identifier = String(formData.get('identifier') ?? '').trim()
  if (!identifier) return { error: 'Enter your CueVerse ID or email.' }

  const p = await payload()
  const where: Where = identifier.includes('@')
    ? { email: { equals: identifier.toLowerCase() } }
    : { username: { equals: normalizeUsername(identifier) } }
  try {
    const found = await p.find({ collection: 'users', where, limit: 1, overrideAccess: true })
    const email = found.docs[0]?.email
    if (email) await p.forgotPassword({ collection: 'users', data: { email }, disableEmail: false })
  } catch {
    // Swallow: never reveal whether the account exists or whether delivery failed.
  }
  return { ok: true }
}

/** Complete a password reset from an emailed token. Sets the new password and signs the user in. */
export async function resetPassword(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const token = String(formData.get('token') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')
  if (!token) return { error: 'This reset link is missing its token. Request a new one.' }
  const perr = validatePassword(password)
  if (perr) return { error: perr }
  if (password !== confirm) return { error: 'Passwords do not match.' }

  const p = await payload()
  try {
    const res = await p.resetPassword({ collection: 'users', data: { token, password }, overrideAccess: true })
    if (res?.token) await setSessionCookie(res.token)
  } catch {
    return { error: 'This reset link is invalid or has expired. Request a new one.' }
  }
  redirect('/account')
}

export async function signOut(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE)
  // Refresh the shared layout so the header drops the authenticated UI immediately on logout
  // (same Router-Cache reason as setSessionCookie).
  revalidatePath('/', 'layout')
  redirect('/')
}

/** Enter the current user into the active tournament (distinct from account creation). */
export async function registerSeason2(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to register.' }
  if (formData.get('rulesAck') !== 'on') return { error: 'Please acknowledge the rules to register.' }

  const tournament = await getActiveSeason()
  if (!tournament) return { error: 'There is no active tournament open for registration.' }

  // Identity is NEVER taken from the form. Eligibility (status + complete linked profile +
  // no duplicate + open window) is checked server-side, then we register using the canonical
  // profile re-read here.
  const { checkSelfSignupEligibility } = await import('@/lib/competition/eligibility')
  const elig = await checkSelfSignupEligibility(Number(user.id), tournament.id)
  if (!elig.ok) return { error: elig.reason ?? 'You cannot register right now.' }
  const profile = await getProfileByUserId(Number(user.id))
  if (!profile) return { error: 'Complete your player profile before registering.' }

  const identity = { displayName: profile.primaryName, cueverseId: profile.cueverseId, discord: profile.discord, timeZone: profile.timeZone, playerId: profile.id }
  const res = await createPublicRegistration(tournament.id, Number(user.id), user.username, identity)
  if (!res.ok) return { error: res.error }
  revalidatePath('/account')
  revalidatePath('/register')
  revalidatePath('/')
  revalidatePath('/staff/registrations')
  return { ok: true, already: res.already }
}

/** Self-service: update my public profile fields (Preferred Name, Discord, Time Zone).
 *  CueVerse ID is intentionally NOT here — it stays on the dedicated 7-day cooldown path. */
export async function updateMyProfileAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }
  const profile = await getProfileByUserId(Number(user.id))
  if (!profile) return { error: 'You have no linked player profile yet.' }

  const preferredName = String(formData.get('preferredName') ?? '').trim()
  const discord = String(formData.get('discord') ?? '').trim()
  const timeZone = String(formData.get('timeZone') ?? '').trim()
  // All three are OPTIONAL — validate only what was provided; blanks clear the field.
  const err =
    (preferredName ? validatePreferredName(preferredName) : null) ||
    (discord ? validateDiscord(discord) : null) ||
    (timeZone ? validateTimeZone(timeZone) : null)
  if (err) return { error: err }

  const { updateProfile } = await import('@/lib/players/service')
  await updateProfile({ userId: Number(user.id), username: user.username }, profile.id, {
    // A blank Preferred Name falls back to the CueVerse ID so public pages always have a value.
    primaryName: preferredName || profile.cueverseId || profile.primaryName,
    discord: discord || null,
    timeZone: timeZone || null,
  })
  // Public identity appears across the site — refresh derived surfaces.
  for (const p of ['/account', '/', '/rankings', '/players', '/cups', '/seasons', '/groups', '/playoffs']) revalidatePath(p)
  return { ok: true }
}

/** Self-service: change my private email (never public). */
export async function changeMyEmailAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }
  const email = String(formData.get('email') ?? '').trim()
  const err = validateEmail(email)
  if (err) return { error: err }
  const p = await payload()
  try {
    await p.update({ collection: 'users', id: Number(user.id), data: { email }, overrideAccess: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|already|duplicate/i.test(msg)) return { error: 'That email is already in use.' }
    return { error: 'Could not update your email.' }
  }
  revalidatePath('/account')
  return { ok: true }
}

/** Self-service: change my password. */
export async function changeMyPasswordAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')
  const err = validatePassword(password)
  if (err) return { error: err }
  if (password !== confirm) return { error: 'Passwords do not match.' }
  const p = await payload()
  await p.update({ collection: 'users', id: Number(user.id), data: { password }, overrideAccess: true })
  return { ok: true }
}

/** Self-service: change my own CueVerse ID (the site-wide display identity). Enforces the
 *  7-day cooldown server-side. Requires a linked Player Profile. */
export async function changeMyCueverseId(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }
  const profile = await getProfileByUserId(Number(user.id))
  if (!profile) return { error: 'You need a linked Player Profile before setting a CueVerse ID. Ask staff to link your profile.' }

  const newId = String(formData.get('cueverseId') ?? '').trim()
  if (!newId) return { error: 'Please enter a CueVerse ID.' }
  if (newId.length > 40) return { error: 'That CueVerse ID is too long.' }

  const res = await changeCueverseId({ userId: Number(user.id), username: user.username }, profile.id, newId, { override: false })
  if (!res.ok) return { error: res.error }

  // The display identity appears across the whole site — refresh the derived surfaces.
  for (const p of ['/account', '/', '/rankings', '/players', '/cups', '/seasons', '/groups', '/playoffs', '/search', '/register']) revalidatePath(p)
  return { ok: true }
}

export async function withdrawSeason2(_prev: FormResult, _formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }

  const tournament = await getActiveSeason()
  if (!tournament) return { error: 'There is no active tournament.' }

  const res = await withdrawPublicRegistration(tournament.id, Number(user.id), user.username)
  if (!res.ok) return { error: res.error }
  revalidatePath('/account')
  revalidatePath('/register')
  revalidatePath('/')
  revalidatePath('/staff/registrations')
  return { ok: true }
}

/** Resolve a live TournamentView (a comp_season row of type CUP) by its public cup number. */
async function cupByNumber(number: number) {
  if (!Number.isFinite(number)) return null
  const { prisma } = await import('@/lib/prisma')
  return prisma.tournament.findFirst({ where: { number } })
}

/** Enter the current user into a specific live TournamentView (the same public-registration path as
 *  seasons — a tournament is just a comp_season row). Registration must be OPEN. */
export async function joinTournamentAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to join this tournament.' }
  if (formData.get('rulesAck') !== 'on') return { error: 'Please acknowledge the rules to join.' }

  const number = Number(formData.get('number'))
  const cup = await cupByNumber(number)
  if (!cup) return { error: 'Tournament not found.' }

  // Identity is NEVER taken from the form — same shared eligibility + canonical-profile path
  // as Tournament signup.
  const { checkSelfSignupEligibility } = await import('@/lib/competition/eligibility')
  const elig = await checkSelfSignupEligibility(Number(user.id), cup.id)
  if (!elig.ok) return { error: elig.reason ?? 'You cannot join this tournament right now.' }
  const profile = await getProfileByUserId(Number(user.id))
  if (!profile) return { error: 'Complete your player profile before joining.' }

  const identity = { displayName: profile.primaryName, cueverseId: profile.cueverseId, discord: profile.discord, timeZone: profile.timeZone, playerId: profile.id }
  const joinPassword = String(formData.get('joinPassword') ?? '')
  const res = await createPublicRegistration(cup.id, Number(user.id), user.username, identity, joinPassword)
  if (!res.ok) return { error: res.error }
  revalidatePath(`/tournaments/${number}`)
  revalidatePath("/tournaments")
  revalidatePath('/account')
  return { ok: true, already: res.already }
}

/** Self-withdraw the current user from a specific live TournamentView (only while registration is OPEN). */
export async function withdrawTournamentAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }

  const number = Number(formData.get('number'))
  const cup = await cupByNumber(number)
  if (!cup) return { error: 'Tournament not found.' }

  const res = await withdrawPublicRegistration(cup.id, Number(user.id), user.username)
  if (!res.ok) return { error: res.error }
  revalidatePath(`/tournaments/${number}`)
  revalidatePath("/tournaments")
  revalidatePath('/account')
  return { ok: true }
}

/** Resolve the signed-in player's identity from their profile (never from the form). */
async function playerIdentityOf(userId: number): Promise<{ userId: number; playerId: string | null; name: string; handle: string | null } | null> {
  const profile = await getProfileByUserId(userId)
  if (!profile) return null
  return { userId, playerId: profile.id, name: profile.primaryName, handle: profile.cueverseId }
}
function teamRevalidate(number: number) {
  revalidatePath(`/tournaments/${number}`)
  revalidatePath('/tournaments')
  revalidatePath('/account')
}

/** START a new team — the signed-in player becomes captain + first member. Optional join code. */
export async function startTeamAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to start a team.' }
  if (formData.get('rulesAck') !== 'on') return { error: 'Please agree to the tournament rules first.' }
  const number = Number(formData.get('number'))
  const cup = await cupByNumber(number)
  if (!cup) return { error: 'Tournament not found.' }
  const identity = await playerIdentityOf(Number(user.id))
  if (!identity) return { error: 'Complete your player profile before registering.' }
  const joinCode = String(formData.get('joinCode') ?? '')
  const { startTeam } = await import('@/lib/competition/teams')
  const res = await startTeam({ userId: Number(user.id), username: user.username }, cup.id, String(formData.get('teamName') ?? ''), identity, joinCode.trim() ? joinCode : null, String(formData.get('joinPassword') ?? ''))
  if (!res.ok) return { error: res.error }
  teamRevalidate(number)
  return { ok: true }
}

/** JOIN an existing team (open, or with the correct join code if protected). */
export async function joinTeamAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to join a team.' }
  if (formData.get('rulesAck') !== 'on') return { error: 'Please agree to the tournament rules first.' }
  const number = Number(formData.get('number'))
  const cup = await cupByNumber(number)
  if (!cup) return { error: 'Tournament not found.' }
  const teamId = Number(formData.get('teamId'))
  if (!Number.isFinite(teamId)) return { error: 'Choose a team to join.' }
  const identity = await playerIdentityOf(Number(user.id))
  if (!identity) return { error: 'Complete your player profile before registering.' }
  const joinCode = String(formData.get('joinCode') ?? '')
  const { joinTeam } = await import('@/lib/competition/teams')
  const res = await joinTeam({ userId: Number(user.id), username: user.username }, cup.id, teamId, identity, joinCode.trim() ? joinCode : null, String(formData.get('joinPassword') ?? ''))
  if (!res.ok) return { error: res.error }
  teamRevalidate(number)
  return { ok: true }
}

/** WITHDRAW from your team (registration OPEN). Captain leaving promotes the next member / disbands. */
export async function withdrawFromTeamAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }
  const number = Number(formData.get('number'))
  const cup = await cupByNumber(number)
  if (!cup) return { error: 'Tournament not found.' }
  const { withdrawFromTeam } = await import('@/lib/competition/teams')
  const res = await withdrawFromTeam({ userId: Number(user.id), username: user.username }, cup.id)
  if (!res.ok) return { error: res.error }
  teamRevalidate(number)
  return { ok: true }
}

/** Captain REMOVES a roster member (by their account id). */
export async function removeTeamMemberAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }
  const number = Number(formData.get('number'))
  const cup = await cupByNumber(number)
  if (!cup) return { error: 'Tournament not found.' }
  const memberUserId = Number(formData.get('memberUserId'))
  const { removeTeamMember } = await import('@/lib/competition/teams')
  const res = await removeTeamMember({ userId: Number(user.id), username: user.username }, cup.id, memberUserId)
  if (!res.ok) return { error: res.error }
  teamRevalidate(number)
  return { ok: true }
}

/** REGISTER as a Free Agent (no team) — to be placed at registration close. */
export async function registerFreeAgentAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to register.' }
  if (formData.get('rulesAck') !== 'on') return { error: 'Please agree to the tournament rules first.' }
  const number = Number(formData.get('number'))
  const cup = await cupByNumber(number)
  if (!cup) return { error: 'Tournament not found.' }
  const identity = await playerIdentityOf(Number(user.id))
  if (!identity) return { error: 'Complete your player profile before registering.' }
  const { registerFreeAgent } = await import('@/lib/competition/free-agents')
  const res = await registerFreeAgent({ userId: Number(user.id), username: user.username }, cup.id, identity, String(formData.get('joinPassword') ?? ''))
  if (!res.ok) return { error: res.error }
  teamRevalidate(number)
  return { ok: true }
}

/** WITHDRAW a Free Agent registration (registration OPEN). */
export async function withdrawFreeAgentAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }
  const number = Number(formData.get('number'))
  const cup = await cupByNumber(number)
  if (!cup) return { error: 'Tournament not found.' }
  const { withdrawFreeAgent } = await import('@/lib/competition/free-agents')
  const res = await withdrawFreeAgent({ userId: Number(user.id), username: user.username }, cup.id)
  if (!res.ok) return { error: res.error }
  teamRevalidate(number)
  return { ok: true }
}

/** Captain SETS / CHANGES / REMOVES the team join code (empty = open the team). */
export async function setTeamJoinCodeAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }
  const number = Number(formData.get('number'))
  const cup = await cupByNumber(number)
  if (!cup) return { error: 'Tournament not found.' }
  const code = String(formData.get('joinCode') ?? '')
  const { setTeamJoinCode } = await import('@/lib/competition/teams')
  const res = await setTeamJoinCode({ userId: Number(user.id), username: user.username }, cup.id, code.trim() ? code : null)
  if (!res.ok) return { error: res.error }
  teamRevalidate(number)
  return { ok: true }
}
