'use server'
import { revalidatePath } from 'next/cache'
import { requireStaffActor } from '@/lib/competition/staff-auth'
import { updateSiteSettings, type SiteSettings } from './site-settings'

export interface SettingsResult { ok?: boolean; error?: string }

export async function updateSiteSettingsAction(patch: Partial<SiteSettings>): Promise<SettingsResult> {
  const actor = await requireStaffActor()
  if (!actor.isHeadAdmin && !actor.can('manage_staff')) return { error: 'Head Admin only.' }
  const r = await updateSiteSettings(actor, patch)
  if (!r.ok) return { error: r.error }
  revalidatePath('/staff/settings')
  return { ok: true }
}
