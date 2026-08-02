'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'

import { normalizeUsername, validateUsername, validateEmail, validatePassword } from './validation'
import { getCurrentUser } from './auth'
import { getActiveSeason } from '@/lib/competition/queries'
import { createPublicRegistration, withdrawPublicRegistration } from '@/lib/competition/service'
import { getProfileByUserId } from '@/lib/players/service'

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
  const username = normalizeUsername(String(formData.get('username') ?? ''))
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const err = validateUsername(username) || validateEmail(email) || validatePassword(password)
  if (err) return { error: err }

  const p = await payload()
  try {
    await p.create({ collection: 'users', data: { username, email, password, roles: ['member'] }, overrideAccess: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|already|duplicate/i.test(msg)) return { error: 'That User ID or email is already in use.' }
    return { error: 'Could not create the account. Please check your details and try again.' }
  }

  try {
    const res = await p.login({ collection: 'users', data: { username, password } })
    if (res.token) await setSessionCookie(res.token, res.exp)
  } catch {
    // account created but auto-login failed — send them to sign in
    redirect('/login')
  }
  redirect('/account')
}

/** Sign in with User ID or email + password. */
export async function signIn(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const identifier = String(formData.get('identifier') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  if (!identifier || !password) return { error: 'Enter your User ID (or email) and password.' }

  const data = identifier.includes('@')
    ? { email: identifier.toLowerCase(), password }
    : { username: normalizeUsername(identifier), password }

  const p = await payload()
  try {
    const res = await p.login({ collection: 'users', data })
    if (!res.token) return { error: 'Invalid credentials.' }
    await setSessionCookie(res.token, res.exp)
  } catch {
    return { error: 'Invalid User ID/email or password.' }
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

  // If the account is already linked to a canonical profile, register with that
  // profile's identity; otherwise capture the submitted identity fields.
  const profile = await getProfileByUserId(Number(user.id))
  let identity
  if (profile) {
    identity = { displayName: profile.primaryName, cueverseId: profile.cueverseId, discord: profile.discord, timeZone: profile.timeZone, playerId: profile.id }
  } else {
    const displayName = String(formData.get('displayName') ?? '').trim()
    const cueverseId = String(formData.get('cueverseId') ?? '').trim()
    const discord = String(formData.get('discord') ?? '').trim()
    const timeZone = String(formData.get('timeZone') ?? '').trim()
    if (!displayName) return { error: 'Please enter a public display name.' }
    if (!cueverseId) return { error: 'Please enter your CueVerse ID.' }
    identity = { displayName, cueverseId, discord: discord || null, timeZone: timeZone || null, playerId: null }
  }

  const res = await createPublicRegistration(season.id, Number(user.id), user.username, identity)
  if (!res.ok) return { error: res.error }
  revalidatePath('/account')
  revalidatePath('/register')
  revalidatePath('/')
  revalidatePath('/staff/registrations')
  return { ok: true, already: res.already }
}

/** Withdraw the current user from the active season (only while registration is open). */
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
