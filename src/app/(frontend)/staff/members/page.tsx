import type { Metadata } from 'next'
import Link from 'next/link'
import type { MemberStatus } from '@prisma/client'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PublicPlayerIdentity } from '@/components/identity/public-player-identity'
import { StatusBadge } from '@/components/staff/status-badge'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { listMembers } from '@/lib/staff/members'
import { CreateMemberButton } from '@/components/staff/create-member-button'
import { mergedSecondaryPlayerIds, primaryOfMergedPlayer } from '@/lib/players/merge'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = { title: 'Members · Admin · 8 Ball Registry', robots: { index: false, follow: false } }

const STATUSES: (MemberStatus | 'ALL')[] = ['ALL', 'ACTIVE', 'TIMED_OUT', 'BANNED', 'DELETED']

type SP = { searchParams: Promise<{ q?: string; status?: string; merged?: string }> }

export default async function MembersPage({ searchParams }: SP) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('moderate_members')) return <AdminDenied actor={access.actor} active="members" label="Member Management" />

  const { q = '', status = 'ALL', merged = '' } = await searchParams
  const statusFilter = (STATUSES as string[]).includes(status) ? (status as MemberStatus | 'ALL') : 'ALL'
  const showMerged = merged === '1'
  const all = await listMembers({ q, status: statusFilter })

  // Merged secondaries are hidden by default. The filter reveals them, labelled and linked to the
  // primary they belong to, so the relationship is always visible rather than implied.
  const secondaryPlayerIds = new Set(await mergedSecondaryPlayerIds())
  const linked = secondaryPlayerIds.size
    ? await prisma.player.findMany({
        where: { id: { in: [...secondaryPlayerIds] }, linkedUserId: { not: null } },
        select: { id: true, linkedUserId: true },
      })
    : []
  const mergedUserIds = new Map(linked.map((p) => [Number(p.linkedUserId), p.id]))
  const members = showMerged ? all : all.filter((mem) => !mergedUserIds.has(mem.userId))

  // Resolve each visible secondary's primary once, for the "merged into" link.
  const primaryByUserId = new Map<number, { userId: number | null; label: string }>()
  if (showMerged) {
    for (const [uid, pid] of mergedUserIds) {
      if (!members.some((mem) => mem.userId === uid)) continue
      const prim = await primaryOfMergedPlayer(pid)
      if (prim) primaryByUserId.set(uid, { userId: prim.userId, label: prim.cueverseId ?? prim.primaryName })
    }
  }

  return (
    <AdminShell actor={access.actor} active="members">
      <h1 className="font-display text-2xl font-bold tracking-tight">Member Management</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {members.length} member{members.length === 1 ? '' : 's'}. Search by Preferred Name or CueVerse ID. Open a member to
        view their profile, competitions, warnings, moderation, and integrity log. Email is private and shown only inside a
        member&apos;s account section.
      </p>

      {access.actor.can('manage_players') && (
        <div className="mt-5">
          <CreateMemberButton />
        </div>
      )}

      <form method="get" className="mt-5 flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search members…" className="w-64" />
        <select name="status" defaultValue={statusFilter} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : label(s)}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" name="merged" value="1" defaultChecked={showMerged} className="size-4 accent-[var(--gold)]" />
          Show merged accounts
        </label>
        <Button type="submit" size="sm">Filter</Button>
      </form>

      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-card/60 text-left text-xs text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5 font-medium">Member</th>
              <th className="px-4 py-2.5 font-medium">CueVerse ID</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Penalty ends</th>
              <th className="px-4 py-2.5 text-right font-medium">Regs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((m) => (
              <tr key={m.userId} className="hover:bg-muted/30">
                <td className="px-4 py-2.5">
                  <Link href={`/staff/members/${m.userId}`} className="hover:text-brand">
                    {m.preferredName ? <PublicPlayerIdentity preferredName={m.preferredName} cueverseId={m.cueverseId} muted /> : (m.cueverseId ? <span>{m.cueverseId}</span> : <span className="text-muted-foreground italic">No profile</span>)}
                    {mergedUserIds.has(m.userId) && (
                      <span className="ml-2 inline-flex items-center gap-1 align-middle">
                        <Badge variant="muted">Merged</Badge>
                        {primaryByUserId.get(m.userId)?.userId != null && (
                          <Link
                            href={`/staff/members/${primaryByUserId.get(m.userId)!.userId}`}
                            className="text-xs text-brand hover:text-brand-soft"
                          >
                            into {primaryByUserId.get(m.userId)!.label}
                          </Link>
                        )}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{m.cueverseId ? `@${m.cueverseId}` : '—'}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    <Badge variant={m.role === 'owner' ? 'gold' : m.role === 'admin' ? 'success' : 'muted'}>{m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'}</Badge>
                    {m.headAdmin && <Badge variant="default">Head</Badge>}
                  </span>
                </td>
                <td className="px-4 py-2.5"><StatusBadge status={m.status} /></td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{m.activePenalty?.endAt ? new Date(m.activePenalty.endAt).toLocaleString() : m.activePenalty?.type === 'BAN' ? 'Permanent (ban)' : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular text-muted-foreground">{m.registrationCount}</td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No members match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  )
}

function label(s: MemberStatus | 'ALL'): string {
  return s === 'TIMED_OUT' ? 'Timed Out' : s.charAt(0) + s.slice(1).toLowerCase()
}
