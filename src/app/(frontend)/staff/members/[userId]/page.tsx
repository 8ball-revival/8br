import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { ArrowLeft, ExternalLink } from 'lucide-react'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { Badge } from '@/components/ui/badge'
import { PublicPlayerIdentity } from '@/components/identity/public-player-identity'
import { StatusBadge } from '@/components/staff/status-badge'
import { MemberModeration } from '@/components/staff/member-moderation'
import { AccountActions } from '@/components/staff/account-actions'
import { listMergedAccounts } from '@/lib/players/merge'
import { planAccountDeletionAction } from '@/lib/players/merge-actions'
import { prisma } from '@/lib/prisma'
import { MemberRoles } from '@/components/staff/member-roles'
import { MemberProfileEditor } from '@/components/staff/member-profile-editor'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getMemberDetail, getActiveRegistrations } from '@/lib/staff/members'

export const metadata: Metadata = { title: 'Member · Admin · 8 Ball Registry', robots: { index: false, follow: false } }

type Props = { params: Promise<{ userId: string }> }

export default async function MemberDetailPage({ params }: Props) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('moderate_members')) return <AdminDenied actor={access.actor} active="members" label="Member Management" />

  const userId = Number((await params).userId)

  const m = await getMemberDetail(userId, { includeEmail: true }) // authorized staff view
  if (!m) notFound()
  const activeRegs = await getActiveRegistrations(userId)

  // Trustworthy server IP for optional ban IP-protection (absent in local/dev).
  const h = await headers()
  const fwd = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || ''
  const ipAvailable = !!fwd && fwd !== '::1' && fwd !== '127.0.0.1'

  const activePenalty = m.penalties.find((p) => p.active) ?? null

  // Account Actions data. The deletion plan is only computed for operators who could act on it.
  const profile = await prisma.player.findUnique({
    where: { linkedUserId: String(userId) },
    select: { id: true },
  })
  const canMerge = access.actor.can('manage_players')
  const canDelete = access.actor.can('delete_account')
  const merged = profile && canMerge ? await listMergedAccounts(profile.id) : []
  const deletionPlan = canDelete ? await planAccountDeletionAction(userId) : null

  return (
    <AdminShell actor={access.actor} active="members">
      <Link href="/staff/members" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Members</Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {m.preferredName ? <PublicPlayerIdentity preferredName={m.preferredName} cueverseId={m.cueverseId} muted /> : (m.cueverseId ?? `#${m.userId}`)}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {m.cueverseId && <span>@{m.cueverseId}</span>}
            <Badge variant={m.role === 'owner' ? 'gold' : m.role === 'admin' ? 'success' : 'muted'}>{m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'}</Badge>
            {m.headAdmin && <Badge variant="default">Head Administrator</Badge>}
            <StatusBadge status={m.status} />
          </p>
        </div>
        {m.slug && <Link href={`/players/${m.slug}`} className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-soft">Public profile <ExternalLink className="size-3.5" /></Link>}
      </div>

      <div className="mt-6 max-w-3xl space-y-8">
        <Section title="Profile">
          <Overview m={m} activePenalty={activePenalty} />
        </Section>

        <Section title="Roles">
          <MemberRoles
            targetUserId={userId}
            targetUsername={m.cueverseId ?? `#${m.userId}`}
            targetRole={m.role}
            targetIsHeadAdmin={m.headAdmin}
            viewerUserId={access.actor.userId}
            viewerIsOwner={access.actor.isOwner}
            viewerCanManageAdmins={access.actor.canManageAdmins()}
          />
        </Section>

        <Section title="Moderation">
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
        </Section>

        <Section title="Integrity Log">
          <Integrity m={m} />
        </Section>

        <AccountActions
          userId={userId}
          playerId={profile?.id ?? null}
          displayName={m.cueverseId ?? m.preferredName ?? `#${m.userId}`}
          merged={merged}
          deletionPlan={deletionPlan}
          canMerge={canMerge}
          canDelete={canDelete}
        />
      </div>
    </AdminShell>
  )
}

/** Compact titled section — replaces the old tab strip so everything reads on one page. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function Overview({ m, activePenalty }: { m: any; activePenalty: any }) {
  // Overview folds in the editable Profile (admin edit — no cooldown). Derived stats
  // (rating, records, achievements) are never editable here.
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Status" value={<StatusBadge status={m.status} />} />
        <Stat label="Registrations" value={String(m.registrationCount)} />
        <Stat label="Warnings" value={String(m.warnings.length)} />
        <Stat label="Penalties (all-time)" value={String(m.penalties.length)} />
        {m.timeoutUntil && <Stat label="Timeout ends" value={new Date(m.timeoutUntil).toLocaleString()} />}
        {activePenalty && <Stat label="Active penalty" value={`${activePenalty.type === 'BAN' ? 'Ban' : 'Timeout'}${activePenalty.endAt ? ` · ends ${new Date(activePenalty.endAt).toLocaleString()}` : ''}`} />}
      </div>
      <div className="border-t border-border pt-6">
        <h2 className="eyebrow mb-3 text-muted-foreground">Profile</h2>
        <MemberProfileEditor
          initial={{
            userId: m.userId,
            preferredName: m.preferredName ?? '',
            cueverseId: m.cueverseId ?? '',
            timeZone: m.timeZone ?? '',
            discord: m.discord ?? '',
            email: m.email ?? '',
          }}
        />
      </div>
    </div>
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
