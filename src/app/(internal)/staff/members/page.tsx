import type { Metadata } from 'next'
import Link from 'next/link'
import type { MemberStatus } from '@prisma/client'

import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PublicPlayerIdentity } from '@/components/identity/public-player-identity'
import { StatusBadge } from '@/components/staff/status-badge'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { listMembers } from '@/lib/staff/members'

export const metadata: Metadata = { title: 'Members · Admin · World Cue Championships', robots: { index: false, follow: false } }

const STATUSES: (MemberStatus | 'ALL')[] = ['ALL', 'ACTIVE', 'TIMED_OUT', 'BANNED', 'DELETED']

type SP = { searchParams: Promise<{ q?: string; status?: string }> }

export default async function MembersPage({ searchParams }: SP) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('moderate_members')) return <StaffDenied active="members" username={access.actor.username} label="Member Management" />

  const { q = '', status = 'ALL' } = await searchParams
  const statusFilter = (STATUSES as string[]).includes(status) ? (status as MemberStatus | 'ALL') : 'ALL'
  const members = await listMembers({ q, status: statusFilter })

  return (
    <StaffShell active="members" username={access.actor.username}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Member Management</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {members.length} member{members.length === 1 ? '' : 's'}. Search by name, CueVerse ID, or username. Open a member to
        view their profile, competitions, warnings, moderation, and integrity log. Email is private and shown only inside a
        member&apos;s account section.
      </p>

      <form method="get" className="mt-5 flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search members…" className="w-64" />
        <select name="status" defaultValue={statusFilter} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : label(s)}</option>)}
        </select>
        <Button type="submit" size="sm">Filter</Button>
      </form>

      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-card/60 text-left text-xs text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-2.5 font-medium">Member</th>
              <th className="px-4 py-2.5 font-medium">Username</th>
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
                    {m.preferredName ? <PublicPlayerIdentity preferredName={m.preferredName} cueverseId={m.cueverseId} muted /> : <span className="text-muted-foreground italic">No profile</span>}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{m.username}</td>
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
    </StaffShell>
  )
}

function label(s: MemberStatus | 'ALL'): string {
  return s === 'TIMED_OUT' ? 'Timed Out' : s.charAt(0) + s.slice(1).toLowerCase()
}
