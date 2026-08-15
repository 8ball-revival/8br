import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { ArrowLeft, ExternalLink } from 'lucide-react'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { Badge } from '@/components/ui/badge'
import { PublicPlayerIdentity } from '@/components/identity/public-player-identity'
import { DiscordContactButton } from '@/components/identity/discord-contact-button'
import { TimeZoneLabel } from '@/components/identity/time-zone'
import { StatusBadge } from '@/components/staff/status-badge'
import { MemberModeration } from '@/components/staff/member-moderation'
import { MemberRoles } from '@/components/staff/member-roles'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getMemberDetail, getActiveRegistrations } from '@/lib/staff/members'

export const metadata: Metadata = { title: 'Member · Admin · World Cue Championships', robots: { index: false, follow: false } }

const TABS = ['overview', 'profile', 'competitions', 'warnings', 'moderation', 'roles', 'integrity'] as const
type Tab = (typeof TABS)[number]

type Props = { params: Promise<{ userId: string }>; searchParams: Promise<{ tab?: string }> }

export default async function MemberDetailPage({ params, searchParams }: Props) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('moderate_members')) return <AdminDenied actor={access.actor} active="members" label="Member Management" />

  const userId = Number((await params).userId)
  const tab = ((await searchParams).tab ?? 'overview') as Tab
  const active: Tab = TABS.includes(tab) ? tab : 'overview'

  const m = await getMemberDetail(userId, { includeEmail: true }) // authorized staff view
  if (!m) notFound()
  const activeRegs = await getActiveRegistrations(userId)

  // Trustworthy server IP for optional ban IP-protection (absent in local/dev).
  const h = await headers()
  const fwd = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || ''
  const ipAvailable = !!fwd && fwd !== '::1' && fwd !== '127.0.0.1'

  const activePenalty = m.penalties.find((p) => p.active) ?? null

  return (
    <AdminShell actor={access.actor} active="members">
      <Link href="/staff/members" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Members</Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {m.preferredName ? <PublicPlayerIdentity preferredName={m.preferredName} cueverseId={m.cueverseId} muted /> : m.username}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>@{m.username}</span>
            <Badge variant={m.role === 'owner' ? 'gold' : m.role === 'admin' ? 'success' : 'muted'}>{m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'}</Badge>
            {m.headAdmin && <Badge variant="default">Head Administrator</Badge>}
            <StatusBadge status={m.status} />
          </p>
        </div>
        {m.slug && <Link href={`/players/${m.slug}`} className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-soft">Public profile <ExternalLink className="size-3.5" /></Link>}
      </div>

      <nav className="mt-5 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link key={t} href={`/staff/members/${userId}?tab=${t}`} aria-current={t === active ? 'page' : undefined}
            className={`rounded-t-md px-3 py-2 text-sm font-medium ${t === active ? 'border-b-2 border-brand text-brand' : 'text-muted-foreground hover:text-foreground'}`}>
            {tabLabel(t)}
          </Link>
        ))}
      </nav>

      <div className="mt-6 max-w-3xl">
        {active === 'overview' && <Overview m={m} activePenalty={activePenalty} />}
        {active === 'profile' && <Profile m={m} />}
        {active === 'competitions' && <Competitions m={m} />}
        {active === 'warnings' && <Warnings m={m} />}
        {active === 'moderation' && (
          <MemberModeration
            userId={userId}
            status={m.status}
            activePenaltyId={activePenalty?.id ?? null}
            activePenaltyType={activePenalty?.type ?? null}
            activeRegistrations={activeRegs}
            canDelete={access.actor.can('delete_account')}
            canPurge={access.actor.can('purge_account')}
            ipAvailable={ipAvailable}
          />
        )}
        {active === 'roles' && (
          <MemberRoles
            targetUserId={userId}
            targetUsername={m.username}
            targetRole={m.role}
            targetIsHeadAdmin={m.headAdmin}
            viewerUserId={access.actor.userId}
            viewerIsOwner={access.actor.isOwner}
            viewerCanManageAdmins={access.actor.canManageAdmins()}
          />
        )}
        {active === 'integrity' && <Integrity m={m} />}
      </div>
    </AdminShell>
  )
}

function tabLabel(t: Tab): string {
  return t === 'integrity' ? 'Integrity Log' : t.charAt(0).toUpperCase() + t.slice(1)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function Overview({ m, activePenalty }: { m: any; activePenalty: any }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Stat label="Status" value={<StatusBadge status={m.status} />} />
      <Stat label="Registrations" value={String(m.registrationCount)} />
      <Stat label="Warnings" value={String(m.warnings.length)} />
      <Stat label="Penalties (all-time)" value={String(m.penalties.length)} />
      {m.timeoutUntil && <Stat label="Timeout ends" value={new Date(m.timeoutUntil).toLocaleString()} />}
      {activePenalty && <Stat label="Active penalty" value={`${activePenalty.type === 'BAN' ? 'Ban' : 'Timeout'}${activePenalty.endAt ? ` · ends ${new Date(activePenalty.endAt).toLocaleString()}` : ''}`} />}
    </div>
  )
}

function Profile({ m }: { m: any }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Preferred Name" value={m.preferredName ?? '—'} />
        <Stat label="CueVerse ID" value={m.cueverseId ?? '—'} />
        <Stat label="Time Zone" value={m.timeZone ? <TimeZoneLabel zone={m.timeZone} /> : '—'} />
        <Stat label="Discord" value={m.discord ? <DiscordContactButton discord={m.discord} name={m.preferredName ?? m.username} /> : '—'} />
      </div>
      {/* PRIVATE account section — authorized staff only. Email never leaves this box. */}
      <div className="rounded-lg border border-destructive/25 bg-destructive/[0.04] p-4">
        <h3 className="eyebrow text-destructive">Private account details</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Stat label="Username" value={m.username} />
          <Stat label="Email (private)" value={m.email ?? '—'} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Email is private — visible only to authorized staff here and never on public pages.</p>
      </div>
    </div>
  )
}

function Competitions({ m }: { m: any }) {
  if (m.competitions.length === 0) return <Empty>No competition entries.</Empty>
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {m.competitions.map((c: any) => (
        <li key={c.registrationId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="font-medium">{c.tournament}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={c.status === 'WITHDRAWN' || c.status === 'REJECTED' ? 'muted' : 'success'}>{c.status}</Badge>
            {c.withdrawnAt && <span>withdrawn {new Date(c.withdrawnAt).toLocaleDateString()}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Warnings({ m }: { m: any }) {
  if (m.warnings.length === 0) return <Empty>No warnings.</Empty>
  return (
    <ul className="space-y-2">
      {m.warnings.map((w: any) => (
        <li key={w.id} className="rounded-lg border border-border bg-card/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">{w.reason}</span><span className="text-xs text-muted-foreground">{new Date(w.createdAt).toLocaleString()}</span></div>
          {w.internalNotes && <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium">Internal:</span> {w.internalNotes}</p>}
          <p className="mt-1 text-xs text-muted-foreground">by {w.staffUsername}</p>
        </li>
      ))}
    </ul>
  )
}

function Integrity({ m }: { m: any }) {
  if (m.integrity.length === 0) return <Empty>No integrity events yet.</Empty>
  return (
    <ol className="space-y-1.5">
      {m.integrity.map((e: any, i: number) => (
        <li key={i} className="flex items-start gap-3 rounded-md border border-border bg-card/30 px-3 py-2 text-sm">
          <Badge variant="muted" className="shrink-0">{e.kind}</Badge>
          <div className="min-w-0 flex-1">
            <p className="text-foreground">{e.summary}{e.reason ? <span className="text-muted-foreground"> — {e.reason}</span> : null}</p>
            <p className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}{e.actor ? ` · ${e.actor}` : ''}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border bg-card/30 px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}
