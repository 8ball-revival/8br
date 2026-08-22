'use client'

import { useState, useTransition } from 'react'
import { KeyRound, Search, Copy, Check, ShieldAlert } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { searchStaffAccountsAction, resetPlayerPasswordAction, type StaffAccount } from '@/lib/staff/password-reset-actions'

const TIER_LABEL: Record<StaffAccount['tier'], string> = { member: 'Member', admin: 'Admin', headAdmin: 'Head Admin' }

export function ResetPasswordPanel() {
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<StaffAccount[]>([])
  const [searching, startSearch] = useTransition()
  const [selected, setSelected] = useState<StaffAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ code: string; name: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = (value: string) => {
    setQ(value)
    startSearch(async () => setCandidates(await searchStaffAccountsAction(value.trim())))
  }
  const pick = (a: StaffAccount) => { setSelected(a); setOpen(false); setQ(''); setError(null); setIssued(null) }

  const doReset = async () => {
    if (!selected) return
    const label = selected.preferredName || selected.cueverseId || `User ${selected.userId}`
    const res = await confirm({
      title: 'Reset this player’s password?',
      tone: 'warning',
      confirmLabel: 'Generate temporary code',
      cancelLabel: 'Cancel',
      message: (
        <div className="space-y-1.5">
          <p>You are about to reset the password for:</p>
          <p className="font-semibold text-foreground">{label} <span className="font-normal text-muted-foreground">· {selected.cueverseId ? `@${selected.cueverseId}` : '—'}{selected.email ? ` · ${selected.email}` : ''}</span></p>
          <p>A one-time 5-digit code will be generated and shown once. The player signs in with their <span className="font-medium text-foreground">CueVerse ID</span> and this code. Their existing sessions are signed out immediately, and they must set a permanent password on their next sign-in.</p>
        </div>
      ),
      input: { label: 'Reason (optional)', placeholder: 'e.g. player requested a reset' },
    })
    if (!res.confirmed) return
    setBusy(true); setError(null)
    const r = await resetPlayerPasswordAction(selected.userId, res.value || undefined)
    setBusy(false)
    if (!r.ok || !r.code) { setError(r.error ?? 'Reset failed.'); return }
    setIssued({ code: r.code, name: label, expiresAt: r.expiresAt ?? '' })
  }

  const copy = async () => {
    if (!issued) return
    try { await navigator.clipboard.writeText(issued.code); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Search + select */}
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <label className="mb-1.5 block text-sm font-semibold text-foreground">Find a player</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => load(e.target.value)}
            onFocus={() => { setOpen(true); if (!candidates.length) load('') }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search by preferred name, CueVerse ID, email, or user ID…"
            className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus-visible:border-brand"
            aria-label="Search players"
          />
          {open && (
            <ul className="absolute z-20 mt-1 max-h-72 w-full space-y-1 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
              {searching && <li className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</li>}
              {!searching && candidates.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">No matching accounts.</li>}
              {candidates.map((a) => (
                <li key={a.userId}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(a)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-foreground">{a.preferredName || a.cueverseId || `User ${a.userId}`}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">{a.cueverseId ? `@${a.cueverseId}` : '—'}{a.email ? ` · ${a.email}` : ''} · #{a.userId}</span>
                    </span>
                    <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold', a.tier === 'headAdmin' ? 'bg-[var(--selected-surface)] text-[var(--gold)]' : a.tier === 'admin' ? 'bg-[var(--selected-surface)] text-brand' : 'bg-muted text-muted-foreground')}>{TIER_LABEL[a.tier]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Selected identity + action */}
      {selected && (
        <div className="rounded-lg border border-border bg-card/40 p-4">
          <p className="eyebrow text-muted-foreground">Selected player</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="font-display text-lg font-bold">{selected.preferredName || selected.cueverseId || `User ${selected.userId}`}</p>
            <span className={cn('rounded-full px-2 py-0.5 text-[0.65rem] font-semibold', selected.tier === 'headAdmin' ? 'bg-[var(--selected-surface)] text-[var(--gold)]' : selected.tier === 'admin' ? 'bg-[var(--selected-surface)] text-brand' : 'bg-muted text-muted-foreground')}>{TIER_LABEL[selected.tier]}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{selected.cueverseId ? `@${selected.cueverseId}` : '—'}{selected.email ? ` · ${selected.email}` : ''} · account #{selected.userId}</p>
          {selected.tier === 'headAdmin' && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-3 py-2 text-xs text-[var(--gold)]"><ShieldAlert className="size-3.5" /> The Head Admin password cannot be reset here.</p>
          )}
          {error && <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {!issued && selected.tier !== 'headAdmin' && (
            <Button className="mt-4" disabled={busy} onClick={doReset}><KeyRound className="size-4" /> {busy ? 'Working…' : 'Reset password'}</Button>
          )}
        </div>
      )}

      {/* One-time code display */}
      {issued && (
        <div className="rounded-lg border border-brand/50 bg-[var(--selected-surface)] p-5" style={{ boxShadow: '0 0 0 1px color-mix(in oklch, var(--gold) 35%, transparent)' }}>
          <p className="eyebrow text-brand">Temporary access code — {issued.name}</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="font-display text-4xl font-bold tracking-[0.3em] tabular-nums text-foreground" aria-label="temporary code">{issued.code}</span>
            <Button variant="outline" size="sm" onClick={copy}>{copied ? <><Check className="size-4" /> Copied</> : <><Copy className="size-4" /> Copy</>}</Button>
          </div>
          <p className="mt-3 text-sm font-semibold text-destructive">This code is shown only once — it will not be displayed again.</p>
          <ul className="mt-1.5 list-disc pl-5 text-xs text-muted-foreground">
            <li>Give it to the player privately. It expires in ~15 minutes.</li>
            <li>Their existing sessions have been signed out.</li>
            <li>They must set a permanent password the next time they sign in.</li>
          </ul>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => { setIssued(null); setSelected(null) }}>Done</Button>
        </div>
      )}
    </div>
  )
}
