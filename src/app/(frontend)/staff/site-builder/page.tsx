import type { Metadata } from 'next'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { SiteBuilderControlCentre } from '@/components/site-builder/control-centre'
import { getBuilderOverview } from '@/lib/site-builder/overview'

/**
 * `/staff/site-builder` — the control centre.
 *
 * ── Why this lives under /staff rather than /admin ───────────────────────────────────────────────
 * `/admin/[[...segments]]` is Payload's optional catch-all and owns that entire subtree; a sibling
 * static route would collide with it, and nesting this inside Payload's admin layout would wrap a
 * site-builder screen in the CMS's own chrome. Under /staff it inherits the console's gate, subnav
 * and visual language, which is where an administrator already goes for everything else.
 *
 * It is reachable by URL regardless of what the published navigation says. Publishing a broken
 * header cannot hide it, which is the property that matters: the recovery route must not depend on
 * the thing being recovered.
 */

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Site Builder · Admin',
  robots: { index: false, follow: false },
}

export default async function SiteBuilderPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_site_builder')) {
    return <AdminDenied actor={access.actor} active="site-builder" label="the Site Builder" />
  }

  const overview = await getBuilderOverview()

  return (
    <AdminShell actor={access.actor} active="site-builder">
      <SiteBuilderControlCentre overview={overview} />
    </AdminShell>
  )
}
