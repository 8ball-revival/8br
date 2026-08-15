'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from './auth'
import { validatePassword } from './validation'
import { completeForcedPasswordChange, needsPermanentPassword } from '@/lib/staff/password-reset'

export interface ForcePwResult { ok?: boolean; error?: string }

/** Self-service: a signed-in player who was reset by an admin sets their permanent password. */
export async function setForcedPasswordAction(_prev: ForcePwResult, formData: FormData): Promise<ForcePwResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You must be signed in.' }
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  const err = validatePassword(password)
  if (err) return { error: err }
  if (password !== confirm) return { error: 'Passwords do not match.' }
  if (!(await needsPermanentPassword(Number(user.id)))) return { error: 'No password change is required.' }
  const r = await completeForcedPasswordChange(Number(user.id), password)
  if (!r.ok) return { error: r.error }
  revalidatePath('/', 'layout')
  return { ok: true }
}
