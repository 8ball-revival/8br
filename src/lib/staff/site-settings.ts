import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit } from '@/lib/competition/audit'
import type { StaffUser } from '@/lib/competition/staff-auth'
import { SITE_NAME } from '@/lib/site'
import { SETTINGS_FIELDS, type SiteSettings } from './site-settings-shared'

/** Head-Admin Site Settings — SAFE structured key/value fields only. No raw HTML/JS/CSS, no template
 *  editing; text is stored verbatim and rendered as plain text. URLs and email are validated. */

export { SETTINGS_FIELDS, type SiteSettings }

const DEFAULTS: SiteSettings = {
  siteName: SITE_NAME, shortName: 'WCC', description: '', defaultLounge: 'Social',
  gameRoomLink: 'https://cueverse.gg/play/', contactEmail: '', supportInfo: '', homepageBanner: '',
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const rows = await prisma.$queryRawUnsafe<{ key: string; value: string }[]>(`SELECT key, value FROM public.site_setting`)
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const out = { ...DEFAULTS }
  for (const f of SETTINGS_FIELDS) if (map.has(f.key)) out[f.key] = map.get(f.key) as string
  return out
}

const HTML_RE = /[<>]|javascript:|<script|on\w+=/i

/** Validate + persist. Rejects any HTML/JS-looking content; validates URL + email fields. Audited. */
export async function updateSiteSettings(actor: StaffUser, patch: Partial<SiteSettings>): Promise<{ ok: boolean; error?: string }> {
  for (const f of SETTINGS_FIELDS) {
    const v = patch[f.key]
    if (v == null) continue
    if (HTML_RE.test(v)) return { ok: false, error: `${f.label}: HTML/script content is not allowed.` }
    if (f.kind === 'url' && v.trim() && !/^https?:\/\/[^\s]+$/i.test(v.trim())) return { ok: false, error: `${f.label}: enter a valid http(s) URL.` }
    if (f.kind === 'email' && v.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())) return { ok: false, error: `${f.label}: enter a valid email.` }
    if (v.length > 2000) return { ok: false, error: `${f.label}: too long.` }
  }
  const before = await getSiteSettings()
  await prisma.$transaction(async (tx) => {
    for (const f of SETTINGS_FIELDS) {
      const v = patch[f.key]
      if (v == null) continue
      await tx.$executeRawUnsafe(
        `INSERT INTO public.site_setting(key, value, "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = CURRENT_TIMESTAMP`,
        f.key, v,
      )
    }
    await recordAudit(actor, { action: 'settings.update', entity: 'SiteSettings', oldValue: before, newValue: { ...before, ...patch } }, tx)
  })
  return { ok: true }
}
