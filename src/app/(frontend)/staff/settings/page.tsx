import type { Metadata } from 'next'
import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { SiteSettingsForm } from '@/components/staff/site-settings-form'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getSiteSettings } from '@/lib/staff/site-settings'
import { getRegistrationConfig } from '@/lib/account/registration-settings'
import { RegistrationModeForm } from '@/components/staff/registration-mode-form'
import { SiteVisibilityForm } from '@/components/staff/site-visibility-form'
import { getSiteVisibility } from '@/lib/auth/site-visibility'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Site Settings · Admin', robots: { index: false, follow: false } }

export default async function SiteSettingsPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.isHeadAdmin && !access.actor.can('manage_staff')) return <AdminDenied actor={access.actor} active="settings" label="Site Settings" />
  const settings = await getSiteSettings()
  // Read only after the permission check above; the code never reaches a page a member can open.
  const registration = await getRegistrationConfig()
  const visibility = await getSiteVisibility()
  return (
    <AdminShell actor={access.actor} active="settings">
      <h1 className="font-display text-2xl font-bold tracking-tight">Site Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Safe, structured site configuration. Preview updates live; changes are audited.</p>
      {/* First, because it is the widest-reaching switch on the page. */}
      <div className="mt-6"><SiteVisibilityForm initial={visibility} /></div>
      <div className="mt-6"><RegistrationModeForm initial={registration} /></div>
      <div className="mt-6"><SiteSettingsForm initial={settings} /></div>
    </AdminShell>
  )
}
