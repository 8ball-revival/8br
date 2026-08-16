import React from 'react'
import { Container } from '@/components/ui/container'
import { AdminSubnav, type AdminNavItem } from './admin-subnav'
import type { StaffUser } from '@/lib/competition/staff-auth'
import type { Capability } from '@/lib/auth/roles'

export type AdminSection =
  | 'dashboard' | 'reset' | 'audit' | 'members' | 'penalties'
  | 'staff' | 'competition' | 'settings' | 'security' | 'health'

const SECTIONS: { key: AdminSection; label: string; href: string; cap?: Capability; headAdminOnly?: boolean }[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/staff' },
  { key: 'reset', label: 'Reset Player Password', href: '/staff/reset-password', cap: 'moderate_members' },
  { key: 'audit', label: 'Activity Log', href: '/staff/audit', cap: 'view_audit' },
  { key: 'members', label: 'Player Management', href: '/staff/members', cap: 'moderate_members' },
  { key: 'penalties', label: 'Penalties', href: '/staff/penalties', cap: 'moderate_members' },
  { key: 'staff', label: 'Staff Management', href: '/staff/staff', headAdminOnly: true },
  { key: 'competition', label: 'Competition Oversight', href: '/staff/competition', cap: 'manage_competitions' },
  { key: 'settings', label: 'Site Settings', href: '/staff/settings', headAdminOnly: true },
  { key: 'security', label: 'Security', href: '/staff/security', cap: 'view_audit' },
  { key: 'health', label: 'Data & System Health', href: '/staff/health', headAdminOnly: true },
]

/** The Admin Portal chrome — rendered INSIDE the normal 8BR site shell (header/footer/background are
 *  provided by the frontend layout). A compact horizontal subnav replaces the old detached sidebar. */
export function AdminShell({ actor, active, children }: { actor: StaffUser; active: AdminSection; children: React.ReactNode }) {
  const items: AdminNavItem[] = SECTIONS
    .filter((s) => (s.headAdminOnly ? actor.isHeadAdmin || actor.can('manage_staff') : s.cap ? actor.can(s.cap) : true))
    .map((s) => ({ key: s.key, label: s.label, href: s.href }))

  return (
    <Container className="py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow text-brand">Admin Portal</p>
        <p className="text-xs text-muted-foreground">Signed in as <span className="font-semibold text-foreground">{actor.username}</span> · {actor.isHeadAdmin ? <span className="text-[var(--gold)]">Head Admin</span> : 'Admin'}</p>
      </div>
      <AdminSubnav items={items} active={active} />
      <div className="mt-6">{children}</div>
    </Container>
  )
}

/** Rendered when a signed-in staff member lacks the capability for a specific Admin section. */
export function AdminDenied({ actor, active, label }: { actor: StaffUser; active: AdminSection; label: string }) {
  return (
    <AdminShell actor={actor} active={active}>
      <div className="rounded-lg border border-destructive/40 bg-destructive/[0.06] p-6">
        <p className="font-mono text-sm text-destructive">403 · Forbidden</p>
        <h1 className="mt-1 font-display text-xl font-bold">{label}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your role does not have permission to open this section. Head-Admin-only areas require the Head Admin designation.</p>
      </div>
    </AdminShell>
  )
}
