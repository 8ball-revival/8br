import type { Metadata } from 'next'
import Link from 'next/link'
import { KeyRound, ScrollText, UserCog, ShieldCheck, Trophy, Plus, ClipboardList } from 'lucide-react'

import { AdminShell } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getAdminOverview } from '@/lib/staff/admin-dashboard'
import { getRecentHumanActions } from '@/lib/staff/activity-log'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Admin · World Cue Championships', robots: { index: false, follow: false } }

function StatCard({ label, value, href, tone }: { label: string; value: number; href?: string; tone?: 'attention' }) {
  const body = (
    <div className={`rounded-lg border bg-card/40 p-4 transition-colors ${href ? 'hover:border-brand/50' : ''} ${tone === 'attention' && value > 0 ? 'border-brand/50' : 'border-border'}`}>
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold tracking-tight ${tone === 'attention' && value > 0 ? 'text-brand' : ''}`}>{value}</p>
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: typeof KeyRound; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-sm font-medium hover:border-brand/50 hover:text-brand">
      <Icon className="size-4" /> {label}
    </Link>
  )
}

function SectionCard({ href, icon: Icon, title, desc, gold }: { href: string; icon: typeof KeyRound; title: string; desc: string; gold?: boolean }) {
  return (
    <Link href={href} className="block rounded-lg border border-border bg-card/40 p-4 transition-colors hover:border-brand/50">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${gold ? 'text-[#d6ae42]' : 'text-brand'}`} />
        <p className="font-semibold text-foreground">{title}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </Link>
  )
}

export default async function StaffDashboardPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  const { actor } = access

  const [o, audit] = await Promise.all([getAdminOverview(), getRecentHumanActions(10)])

  return (
    <AdminShell actor={access.actor} active="dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Admin Portal</h1>
          <p className="text-sm text-muted-foreground">Signed in as {actor.username}{actor.isHeadAdmin ? ' · Head Admin' : ' · Admin'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <QuickAction href="/seasons/new" icon={Plus} label="Create Season" />
          <QuickAction href="/tournaments/new" icon={Plus} label="Create Tournament" />
        </div>
      </div>

      {/* Operational snapshot */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Active Seasons" value={o.activeSeasons} href="/seasons" />
        <StatCard label="Upcoming Seasons" value={o.upcomingSeasons} href="/seasons" />
        <StatCard label="Active Tournaments" value={o.activeTournaments} href="/tournaments" />
        <StatCard label="Open Registrations" value={o.openRegistrations} tone="attention" />
        <StatCard label="Unresolved Group Matches" value={o.unresolvedGroupMatches} tone="attention" />
        <StatCard label="Unresolved Playoff Matches" value={o.unresolvedPlayoffMatches} tone="attention" />
        <StatCard label="Waiting Free Agents" value={o.waitingFreeAgents} tone="attention" />
        <StatCard label="Incomplete Teams" value={o.incompleteTeams} tone="attention" />
        <StatCard label="Force Password Change" value={o.forcePasswordChange} tone="attention" />
        <StatCard label="Suspended Accounts" value={o.suspendedAccounts} tone="attention" />
      </div>

      {/* Quick actions */}
      <h2 className="mt-8 font-display text-lg font-bold">Quick actions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <QuickAction href="/staff/reset-password" icon={KeyRound} label="Reset Player Password" />
        <QuickAction href="/staff/audit" icon={ScrollText} label="Activity Log" />
        <QuickAction href="/staff/members" icon={UserCog} label="Player Management" />
        <QuickAction href="/tournaments" icon={ClipboardList} label="Manage Registrations" />
      </div>

      {/* Sections */}
      <h2 className="mt-8 font-display text-lg font-bold">Sections</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard href="/staff/reset-password" icon={KeyRound} title="Reset Player Password" desc="Issue a one-time temporary code and force a permanent password change." />
        <SectionCard href="/staff/audit" icon={ScrollText} title="Activity Log" desc="Immutable record of every staff and security action." />
        <SectionCard href="/staff/members" icon={UserCog} title="Player Management" desc="Search accounts, review profiles, suspend, ban, and moderate." />
        {actor.can('manage_staff') && <SectionCard href="/staff/staff" icon={ShieldCheck} title="Staff Management" desc="Promote and demote Admins, reset Admin passwords." gold />}
        <SectionCard href="/tournaments" icon={Trophy} title="Competition Oversight" desc="Active Seasons and Tournaments — jump to any workspace." />
      </div>

      {/* Recent activity */}
      <h2 className="mt-8 font-display text-lg font-bold">Recent admin actions</h2>
      <div className="mt-3 rounded-lg border border-border bg-card/40 p-4">
        {audit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3">
                <span><span className="font-medium">{a.actorUsername}</span> <span className="text-muted-foreground">{a.action}</span></span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/staff/audit" className="mt-3 inline-block text-sm text-brand hover:underline">View full Activity Log →</Link>
      </div>
    </AdminShell>
  )
}
