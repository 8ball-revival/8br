'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Crown, ShieldCheck, ArrowDown, ArrowUp, KeyRound, Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { promoteToAdminAction, demoteAdminAction, searchPromotableMembersAction } from '@/lib/staff/roles-actions'
import type { StaffMember, StaffRoster } from '@/lib/staff/staff-roster'

const nameOf = (m: StaffMember) => m.preferredName || m.cueverseId || `User ${m.userId}`
const idOf = (m: StaffMember) => (m.cueverseId ? `@${m.cueverseId}` : '—')

export function StaffManagementPanel({ roster, canManage }: { roster: StaffRoster; canManage: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, okText: string) =>
    start(async () => { const r = await fn(); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: okText }); if (!r.error) router.refresh() })

  const demote = async (m: StaffMember) => {
    const res = await confirm({ title: 'Demote to Member?', tone: 'warning', confirmLabel: 'Demote', message: <p>Remove Admin access from <b>{nameOf(m)}</b>? They keep their account and history but lose all staff capabilities.</p>, input: { label: 'Reason (optional)' } })
    if (res.confirmed) run(() => demoteAdminAction(m.userId, res.value || undefined), `${nameOf(m)} demoted to Member.`)
  }

  return (
    <div className="max-w-3xl space-y-6">
      {msg && <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>}

      {/* Head Admin */}
      <section className="rounded-lg border border-[var(--gold)]/40 bg-[var(--selected-surface)] p-4">
        <p className="eyebrow text-[var(--gold)]">Head Admin</p>
        {roster.headAdmin ? (
          <p className="mt-1 flex items-center gap-2 font-display text-lg font-bold"><Crown className="size-4 text-[var(--gold)]" /> {nameOf(roster.headAdmin)}</p>
        ) : <p className="mt-1 text-sm text-muted-foreground">No Head Admin is designated.</p>}
        <p className="mt-1 text-xs text-muted-foreground">Exactly one Head Admin exists. The Head Admin password can only be recovered through secure self-service — never reset here.</p>
      </section>

      {/* Admins */}
      <section className="rounded-none border border-border bg-card/40 p-4">
        <p className="eyebrow text-brand">Administrators ({roster.admins.length})</p>
        {roster.admins.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No Admins yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {roster.admins.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-2 py-2.5">
                <ShieldCheck className="size-4 text-brand" />
                <span className="min-w-0 flex-1"><span className="font-medium text-foreground">{nameOf(m)}</span> <span className="text-xs text-muted-foreground">{idOf(m)} · #{m.userId}</span></span>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <Button asChild size="sm" variant="outline"><Link href="/staff/reset-password"><KeyRound className="size-3.5" /> Reset password</Link></Button>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => demote(m)} className="border-destructive/40 text-destructive hover:bg-destructive/10"><ArrowDown className="size-3.5" /> Demote</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Promote */}
      {canManage && <PromoteMember run={run} confirm={confirm} pending={pending} />}
    </div>
  )
}

function PromoteMember({ run, confirm, pending }: { run: (fn: () => Promise<{ ok?: boolean; error?: string }>, okText: string) => void; confirm: ReturnType<typeof useConfirm>; pending: boolean }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<StaffMember[]>([])
  const [searching, startSearch] = useTransition()
  const load = (v: string) => { setQ(v); startSearch(async () => setCandidates(await searchPromotableMembersAction(v.trim()))) }

  const promote = async (m: StaffMember) => {
    setOpen(false); setQ('')
    const res = await confirm({ title: 'Promote to Admin?', tone: 'warning', confirmLabel: 'Promote to Admin', message: <p>Grant Admin access to <b>{nameOf(m)}</b>? Admins can manage competitions, registrations, results, and moderate Members.</p>, input: { label: 'Reason (optional)' } })
    if (res.confirmed) run(() => promoteToAdminAction(m.userId, res.value || undefined), `${nameOf(m)} promoted to Admin.`)
  }

  return (
    <section className="rounded-none border border-border bg-card/40 p-4">
      <p className="eyebrow text-brand">Promote a Member</p>
      <div className="relative mt-2 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <input value={q} onChange={(e) => load(e.target.value)} onFocus={() => { setOpen(true); if (!candidates.length) load('') }} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Search members by name or email…" className="w-full rounded-none border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-brand" aria-label="Search members" />
        {open && (
          <ul className="absolute z-20 mt-1 max-h-64 w-full space-y-1 overflow-y-auto rounded-none border border-border bg-popover p-1 shadow-lg">
            {searching && <li className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</li>}
            {!searching && candidates.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">No eligible members.</li>}
            {candidates.map((m) => (
              <li key={m.userId}>
                <button type="button" disabled={pending} onMouseDown={(e) => e.preventDefault()} onClick={() => promote(m)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                  <span className="min-w-0 truncate"><span className="font-medium text-foreground">{nameOf(m)}</span> <span className="text-xs text-muted-foreground">{idOf(m)} · #{m.userId}</span></span>
                  <ArrowUp className="size-3.5 text-brand" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
