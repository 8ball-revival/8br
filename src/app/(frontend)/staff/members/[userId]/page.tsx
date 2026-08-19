import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { Badge } from '@/components/ui/badge'
import { PublicPlayerIdentity } from '@/components/identity/public-player-identity'
import { StatusBadge } from '@/components/staff/status-badge'
import { AccountActions } from '@/components/staff/account-actions'
import { listMergedAccounts } from '@/lib/players/merge'
import { planAccountDeletionAction } from '@/lib/players/merge-actions'
import { prisma } from '@/lib/prisma'
import { MemberRoles } from '@/components/staff/member-roles'
import { MemberProfileEditor } from '@/components/staff/member-profile-editor'
import { AliasManager } from '@/components/staff/alias-manager'
import { listAliases } from '@/lib/players/aliases'
import { MemberTrustedAuthor } from '@/components/staff/member-trusted-author'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getMemberDetail } from '@/lib/staff/members'

export const metadata: Metadata = { title: 'Member · Admin · 8 Ball Registry', robots: { index: false, follow: false } }

type Props = { params: Promise<{ userId: string }> }

export default async function MemberDetailPage({ params }: Props) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('moderate_members')) return <AdminDenied actor={access.actor} active="members" label="Member Management" />

  const userId = Number((await params).userId)

  const m = await getMemberDetail(userId, { includeEmail: true }) // authorized staff view
  if (!m) notFound()



  // Account Actions data. The deletion plan is only computed for operators who could act on it.
  const profile = await prisma.player.findUnique({
    where: { linkedUserId: String(userId) },
    select: { id: true },
  })
  const canMerge = access.actor.can('manage_players')
  const canDelete = access.actor.can('delete_account')
  const merged = profile && canMerge ? await listMergedAccounts(profile.id) : []
  // Aliases are the full list with remove buttons here; the roster only offers quick-add.
  const aliases = profile ? await listAliases(profile.id) : []
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
            {m.trustedAuthor && <Badge variant="gold">Trusted Author</Badge>}
            <StatusBadge status={m.status} />
          </p>
        </div>
        {m.slug && <Link href={`/players/${m.slug}`} className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-soft">Public profile <ExternalLink className="size-3.5" /></Link>}
      </div>

      <div className="mt-6 max-w-3xl space-y-8">
        <Section title="Profile">
          <Overview m={m} />
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

        <Section title="Publishing">
          <MemberTrustedAuthor
            targetUserId={userId}
            targetLabel={m.cueverseId ?? m.preferredName ?? `#${m.userId}`}
            trusted={m.trustedAuthor}
            hasProfile={!!profile}
            canManage={canMerge}
          />
        </Section>

        {profile && (
          <div className="mt-4">
            <AliasManager playerId={profile.id} initial={aliases} />
          </div>
        )}

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

/** Profile section: the editable identity fields. Status/registration/penalty tiles and the
 *  private account block were removed from this page — their data and backend are untouched. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Overview({ m }: { m: any }) {
  return (
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
  )
}
