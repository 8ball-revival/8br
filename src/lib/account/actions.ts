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
import { getActiveSeason } from '@/lib/competition/queries'
import { createPublicRegistration, withdrawPublicRegistration } from '@/lib/competition/service'
import { getProfileByUserId, changeCueverseId, createOrLinkAccountProfile } from '@/lib/players/service'
import { claimAccount, getClaimTarget } from '@/lib/accounts/provisioning'

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

  // Reject a duplicate CueVerse ID regardless of capitalization (username is the lowered form),
  // and direct pre-created/unclaimed accounts to the claim flow.
  const existing = await p.find({ collection: 'users', where: { username: { equals: username } }, limit: 1, overrideAccess: true })
  if (existing.totalDocs > 0) {
    const { prisma } = await import('@/lib/prisma')
    const claim = await prisma.accountClaim.findUnique({ where: { userId: Number(existing.docs[0].id) } })
    if (claim && claim.status === 'UNCLAIMED')
      return { error: 'An account for that CueVerse ID already exists and is waiting to be claimed. Use “Claim your account” instead.' }
    return { error: 'That CueVerse ID or email is already in use.' }
  }

  let newUserId: number
  try {
    const created = await p.create({ collection: 'users', data: { username, email, password, roles: ['member'] }, overrideAccess: true })
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

  try {
    const res = await p.login({ collection: 'users', data: { username, password } })
    if (res.token) await setSessionCookie(res.token, res.exp)
  } catch {
    redirect('/login')
  }
  redirect('/account')
}

/** Public: which Player profile a login id would claim (for the confirmation step). */
export async function lookupClaimTargetAction(loginId: string): Promise<{ ok: boolean; playerName?: string; error?: string }> {
  if (!loginId.trim()) return { ok: false }
  return getClaimTarget(loginId)
}

/** Claim a pre-created account: login id + one-time code → set password + recovery email,
 *  then sign in. The code is single-use (invalidated on success). */
export async function claimAccountAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const loginId = String(formData.get('loginId') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirmPassword') ?? '')
  const email = String(formData.get('email') ?? '').trim()

  if (!loginId || !code) return { error: 'Enter your login id and claim code.' }
  const pwErr = validatePassword(password)
  if (pwErr) return { error: pwErr }
  if (password !== confirm) return { error: 'Passwords do not match.' }
  const emErr = validateEmail(email)
  if (emErr) return { error: emErr }

  const res = await claimAccount(loginId, code, password, email)
  if (!res.ok) return { error: res.error }
  if (res.token) await setSessionCookie(res.token, res.exp)
  redirect('/account')
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
  }
  await setSessionCookie(token!, exp)
  redirect('/account')
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
  redirect('/')
}

/** Enter the current user into the active season (distinct from account creation). */
export async function registerSeason2(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to register.' }
  if (formData.get('rulesAck') !== 'on') return { error: 'Please acknowledge the rules to register.' }

  const season = await getActiveSeason()
  if (!season) return { error: 'There is no active season open for registration.' }

  // Identity is NEVER taken from the form. Eligibility (status + complete linked profile +
  // no duplicate + open window) is checked server-side, then we register using the canonical
  // profile re-read here.
  const { checkSelfSignupEligibility } = await import('@/lib/competition/eligibility')
  const elig = await checkSelfSignupEligibility(Number(user.id), season.id)
  if (!elig.ok) return { error: elig.reason ?? 'You cannot register right now.' }
  const profile = await getProfileByUserId(Number(user.id))
  if (!profile) return { error: 'Complete your player profile before registering.' }

  const identity = { displayName: profile.primaryName, cueverseId: profile.cueverseId, discord: profile.discord, timeZone: profile.timeZone, playerId: profile.id }
  const res = await createPublicRegistration(season.id, Number(user.id), user.username, identity)
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

  const season = await getActiveSeason()
  if (!season) return { error: 'There is no active season.' }

  const res = await withdrawPublicRegistration(season.id, Number(user.id), user.username)
  if (!res.ok) return { error: res.error }
  revalidatePath('/account')
  revalidatePath('/register')
  revalidatePath('/')
  revalidatePath('/staff/registrations')
  return { ok: true }
}

/** Resolve a live Cup (a comp_season row of type CUP) by its public cup number. */
async function cupByNumber(cupNumber: number) {
  if (!Number.isFinite(cupNumber)) return null
  const { prisma } = await import('@/lib/prisma')
  return prisma.season.findFirst({ where: { competitionType: 'CUP', cupNumber } })
}

/** Enter the current user into a specific live Cup (the same public-registration path as
 *  seasons — a cup is just a comp_season row). Registration must be OPEN. */
export async function joinCupAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to join this cup.' }
  if (formData.get('rulesAck') !== 'on') return { error: 'Please acknowledge the rules to join.' }

  const cupNumber = Number(formData.get('cupNumber'))
  const cup = await cupByNumber(cupNumber)
  if (!cup) return { error: 'Cup not found.' }

  // Identity is NEVER taken from the form — same shared eligibility + canonical-profile path
  // as Season signup.
  const { checkSelfSignupEligibility } = await import('@/lib/competition/eligibility')
  const elig = await checkSelfSignupEligibility(Number(user.id), cup.id)
  if (!elig.ok) return { error: elig.reason ?? 'You cannot join this cup right now.' }
  const profile = await getProfileByUserId(Number(user.id))
  if (!profile) return { error: 'Complete your player profile before joining.' }

  const identity = { displayName: profile.primaryName, cueverseId: profile.cueverseId, discord: profile.discord, timeZone: profile.timeZone, playerId: profile.id }
  const res = await createPublicRegistration(cup.id, Number(user.id), user.username, identity)
  if (!res.ok) return { error: res.error }
  revalidatePath(`/cups/${cupNumber}`)
  revalidatePath('/cups')
  revalidatePath('/account')
  return { ok: true, already: res.already }
}

/** Self-withdraw the current user from a specific live Cup (only while registration is OPEN). */
export async function withdrawCupAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in.' }

  const cupNumber = Number(formData.get('cupNumber'))
  const cup = await cupByNumber(cupNumber)
  if (!cup) return { error: 'Cup not found.' }

  const res = await withdrawPublicRegistration(cup.id, Number(user.id), user.username)
  if (!res.ok) return { error: res.error }
  revalidatePath(`/cups/${cupNumber}`)
  revalidatePath('/cups')
  revalidatePath('/account')
  return { ok: true }
}
