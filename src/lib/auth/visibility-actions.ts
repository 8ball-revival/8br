'use server'

import { revalidatePath } from 'next/cache'

import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import {
  getSiteVisibility, setSiteVisibility, type SiteVisibility,
} from './site-visibility'

/**
 * Opening and closing the site from the admin portal.
 *
 * ── Gated here, not only on the page ─────────────────────────────────────────────────────────────
 * A Server Action is a public endpoint that happens to be called from a page. Checking permission in
 * the page protects the screen and not the operation, so the same check the Site Settings page makes
 * is repeated here — which is the pattern `registration-actions` already follows, and the reason
 * this is a separate file rather than a function on the settings module.
 *
 * ── Why it is audited ────────────────────────────────────────────────────────────────────────────
 * This is the single largest switch in the application: one click takes the whole site from public
 * to invisible, or back. Who did that and when is worth more than most of what the audit log holds.
 */

/** Head Admin, or an administrator holding the staff-management permission — as for registration. */
async function requireAdmin(): Promise<
  { ok: true; actor: Actor } | { ok: false; error: string }
> {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return { ok: false, error: 'You do not have access to this setting.' }
  if (!access.actor.isHeadAdmin && !access.actor.can('manage_staff')) {
    return { ok: false, error: 'You do not have access to this setting.' }
  }
  return { ok: true, actor: { userId: access.actor.userId, username: access.actor.username } }
}

export interface VisibilityResult {
  ok: boolean
  error?: string
  visibility?: SiteVisibility
}

export async function saveSiteVisibility(
  _prev: VisibilityResult | null,
  formData: FormData,
): Promise<VisibilityResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }

  const next: SiteVisibility = String(formData.get('siteVisibility')) === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'
  const current = await getSiteVisibility()
  if (next === current) return { ok: true, visibility: current }

  await setSiteVisibility(next)

  /* Never let a failed audit write undo the change the owner asked for. */
  try {
    await recordAudit(gate.actor, {
      action: 'site.visibility',
      entity: 'Site',
      entityId: 'siteVisibility',
      oldValue: current,
      newValue: next,
    })
  } catch { /* recorded if it can be, never a reason to fail the switch */ }

  /*
    The surfaces that change shape, not merely content.

    `/` and `/rankings` stand in for ordinary pages; robots.txt and sitemap.xml are gated on the same
    setting and would otherwise keep serving the previous answer to crawlers for as long as their
    cache entries live. The proxy's own ten-second cache is cleared in-process by `setSiteVisibility`,
    and any other running instance picks the change up within that window.
  */
  revalidatePath('/', 'layout')
  revalidatePath('/robots.txt')
  revalidatePath('/sitemap.xml')
  revalidatePath('/staff/settings')

  return { ok: true, visibility: next }
}
