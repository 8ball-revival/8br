import type { Metadata } from 'next'
import Link from 'next/link'
import type { MemberStatus } from '@prisma/client'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/staff/status-badge'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { listMembers } from '@/lib/staff/members'
import { CreateMemberButton } from '@/components/staff/create-member-button'
import { mergedSecondaryPlayerIds, primaryOfMergedPlayer } from '@/lib/players/merge'
import { MemberRowEditor } from '@/components/staff/member-row-editor'
import { prisma } from '@/lib/prisma'

export const metadata: Metadata = { title: 'Members · Admin · 8 Ball Registry', robots: { index: false, follow: false } }

const STATUSES: (MemberStatus | 'ALL')[] = ['ALL', 'ACTIVE', 'TIMED_OUT', 'BANNED', 'DELETED']

type SortKey = 'cueverseId' | 'preferredName'
type SortDir = 'asc' | 'desc'
type SP = { searchParams: Promise<{ q?: string; status?: string; merged?: string; trusted?: string; sort?: string; dir?: string }> }

export default async function MembersPage({ searchParams }: SP) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('moderate_members')) return <AdminDenied actor={access.actor} active="members" label="Member Management" />

  const { q = '', status = 'ALL', merged = '', trusted = '', sort = '', dir = '' } = await searchParams
  const statusFilter = (STATUSES as string[]).includes(status) ? (status as MemberStatus | 'ALL') : 'ALL'
  const showMerged = merged === '1'
  const trustedOnly = trusted === '1'
  // Editing a profile is the same capability the member page gates on.
  const canEditProfiles = access.actor.can('moderate_members')
  const sortKey: SortKey | null = sort === 'cueverseId' || sort === 'preferredName' ? sort : null
  const sortDir: SortDir = dir === 'desc' ? 'desc' : 'asc'
  const all = await listMembers({ q, status: statusFilter, trustedOnly })

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
  const filtered = showMerged ? all : all.filter((mem) => !mergedUserIds.has(mem.userId))

  // Sorting is applied here rather than in the query so it works the same across every filter, and
  // stays off entirely until a header is clicked. Blank values sort last in both directions, so an
  // empty Preferred Name never leads the table.
  const members = sortKey
    ? [...filtered].sort((a, b) => {
        const av = (sortKey === 'cueverseId' ? a.cueverseId : a.preferredName) ?? ''
        const bv = (sortKey === 'cueverseId' ? b.cueverseId : b.preferredName) ?? ''
        if (!av && !bv) return 0
        if (!av) return 1
        if (!bv) return -1
        const cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' })
        return sortDir === 'asc' ? cmp : -cmp
      })
    : filtered

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
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" name="trusted" value="1" defaultChecked={trustedOnly} className="size-4 accent-[var(--gold)]" />
          Trusted Authors only
        </label>
        {/* Carry the chosen sort through a filter submit, so searching does not silently reset it. */}
        {sortKey && <input type="hidden" name="sort" value={sortKey} />}
        {sortKey && <input type="hidden" name="dir" value={sortDir} />}
        <Button type="submit" size="sm">Filter</Button>
      </form>

      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-card/60 text-left text-xs text-muted-foreground uppercase">
            <tr>
              <SortHeader label="CueVerse ID" col="cueverseId" sortKey={sortKey} sortDir={sortDir} q={q} status={status} merged={merged} trusted={trusted} />
              <SortHeader label="Preferred name" col="preferredName" sortKey={sortKey} sortDir={sortDir} q={q} status={status} merged={merged} trusted={trusted} />
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((m) => (
              <tr key={m.userId} className="hover:bg-muted/20">
                <MemberRowEditor
                  userId={m.userId}
                  cueverseId={m.cueverseId}
                  preferredName={m.preferredName}
                  canEdit={canEditProfiles}
                />
                <td className="px-4 py-2.5 align-top">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={m.status} />
                    {m.trustedAuthor && <Badge variant="gold">Trusted Author</Badge>}
                    {mergedUserIds.has(m.userId) && (
                      <>
                        <Badge variant="muted">Merged</Badge>
                        {primaryByUserId.get(m.userId)?.userId != null && (
                          <Link
                            href={`/staff/members/${primaryByUserId.get(m.userId)!.userId}`}
                            className="text-xs text-brand hover:text-brand-soft"
                          >
                            into {primaryByUserId.get(m.userId)!.label}
                          </Link>
                        )}
                      </>
                    )}
                    <Link
                      href={`/staff/members/${m.userId}`}
                      className="ml-1 text-xs text-muted-foreground hover:text-brand"
                    >
                      Open
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">No members match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  )
}

/**
 * A sortable column heading.
 *
 * Clicking an unsorted column sorts it A–Z; clicking the one already sorted flips it to Z–A and
 * back again. The other filters are carried through in the link so sorting never resets a search.
 */
function SortHeader({
  label, col, sortKey, sortDir, q, status, merged, trusted,
}: {
  label: string
  col: SortKey
  sortKey: SortKey | null
  sortDir: SortDir
  q: string
  status: string
  merged: string
  trusted: string
}) {
  const active = sortKey === col
  const nextDir: SortDir = active && sortDir === 'asc' ? 'desc' : 'asc'
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (status && status !== 'ALL') params.set('status', status)
  if (merged) params.set('merged', merged)
  if (trusted) params.set('trusted', trusted)
  params.set('sort', col)
  params.set('dir', nextDir)

  return (
    <th className="px-4 py-2.5 font-medium" aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link
        href={`/staff/members?${params.toString()}`}
        className={`inline-flex items-center gap-1 hover:text-brand ${active ? 'text-brand' : ''}`}
        title={active ? `Sorted ${sortDir === 'asc' ? 'A–Z' : 'Z–A'} — click to reverse` : `Sort by ${label}`}
      >
        {label}
        <span aria-hidden className={active ? '' : 'opacity-30'}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '▴'}
        </span>
      </Link>
    </th>
  )
}

function label(s: MemberStatus | 'ALL'): string {
  return s === 'TIMED_OUT' ? 'Timed Out' : s.charAt(0) + s.slice(1).toLowerCase()
}
