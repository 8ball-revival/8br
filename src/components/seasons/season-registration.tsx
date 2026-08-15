'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Lock, Plus, Search, UserPlus, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  searchSeasonPlayersAction,
  addSeasonEntrantAction,
  removeSeasonEntrantAction,
  closeSeasonRegistrationAction,
  registerForSeasonAction,
  type SeasonActionResult,
} from '@/lib/seasons/actions'

export interface RegEntrant { entrantId: number; name: string; cueverseId: string | null; slug: string | null; rating: number | null }

/**
 * Season registration phase — a focused, single-purpose page: entrant list (# · Preferred Name +
 * CueVerse ID · Ladder rating), admin Add Player search + remove + Close Registration, and member
 * self-registration. No Groups / Standings / Playoffs here.
 */
export function SeasonRegistration({
  seasonId,
  seasonNumber,
  entrants,
  canManage,
  isOpen,
  isLoggedIn,
  alreadyRegistered,
  requiresPassword,
}: {
  seasonId: number
  seasonNumber: number
  entrants: RegEntrant[]
  canManage: boolean
  isOpen: boolean
  isLoggedIn: boolean
  alreadyRegistered: boolean
  requiresPassword: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  // Auto-dismiss temporary success toasts so they never dominate the layout.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (t: { ok: boolean; text: string }) => {
    setToast(t)
    if (timer.current) clearTimeout(timer.current)
    if (t.ok) timer.current = setTimeout(() => setToast(null), 2500)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const run = (fn: () => Promise<SeasonActionResult>) =>
    start(async () => {
      const r = await fn()
      if (r.error) flash({ ok: false, text: r.error })
      else { flash({ ok: true, text: r.message ?? 'Done.' }); router.refresh() }
    })

  return (
    <div className="mt-8 space-y-5">
      {toast && (
        <div className={cn('rounded-md border px-3 py-2 text-sm', toast.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')} role="status">
          {toast.text}
        </div>
      )}

      {/* Member self-registration / admin controls */}
      <div className="flex flex-wrap items-center gap-3">
        {isOpen && !canManage && isLoggedIn && !alreadyRegistered && (
          <SelfRegister seasonNumber={seasonNumber} requiresPassword={requiresPassword} onDone={(r) => (r.error ? flash({ ok: false, text: r.error }) : (flash({ ok: true, text: r.message ?? 'Registered.' }), router.refresh()))} />
        )}
        {isOpen && !canManage && !isLoggedIn && (
          <Button asChild size="sm"><Link href={`/login?returnTo=${encodeURIComponent(`/seasons/${seasonNumber}`)}`}>Sign in to register</Link></Button>
        )}
        {alreadyRegistered && !canManage && (
          <p className="inline-flex items-center gap-2 rounded-md border border-success/30 bg-success/[0.06] px-3 py-2 text-sm text-foreground"><UserPlus className="size-4 text-success" /> You&apos;re registered for this Season.</p>
        )}

        {canManage && isOpen && <AddPlayer seasonId={seasonId} run={run} />}
        {canManage && isOpen && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={pending}
            onClick={() => { if (window.confirm('Close registration?\n\nThe entrant field locks and each player’s current Ladder rating is captured as the Season seeding snapshot.')) run(() => closeSeasonRegistrationAction(seasonId)) }}
          >
            <Lock className="size-4" /> Close Registration
          </Button>
        )}
      </div>

      {/* Numbered entrant list: # · Preferred Name + CueVerse ID · Rating */}
      <div className="overflow-hidden rounded-md border border-border">
        <div className="flex items-center gap-3 border-b border-border bg-card/50 px-3 py-1.5 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          <span className="w-8 shrink-0 text-right">#</span>
          <span className="min-w-0 flex-1">Entrant</span>
          <span className="w-16 shrink-0 text-right">Rating</span>
          {canManage && isOpen && <span className="w-6 shrink-0" />}
        </div>
        <ul className="divide-y divide-border">
          {entrants.map((e, i) => (
            <li key={e.entrantId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="tabular w-8 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {e.slug ? <Link href={`/players/${encodeURIComponent(e.slug)}`} className="font-medium text-foreground hover:text-brand">{e.name}</Link> : <span className="font-medium text-foreground">{e.name}</span>}
                {e.cueverseId && e.cueverseId !== e.name && <span className="ml-1.5 text-xs text-muted-foreground">{e.cueverseId}</span>}
              </span>
              <span className="tabular w-16 shrink-0 text-right font-semibold text-foreground">{e.rating != null ? e.rating : <span className="font-normal text-muted-foreground">—</span>}</span>
              {canManage && isOpen && (
                <button aria-label={`Remove ${e.name}`} onClick={() => run(() => removeSeasonEntrantAction(seasonId, e.entrantId))} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
              )}
            </li>
          ))}
          {entrants.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">No entrants yet{isOpen ? ' — be the first to register.' : '.'}</li>}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">{entrants.length} entrant{entrants.length === 1 ? '' : 's'}</p>
    </div>
  )
}

function SelfRegister({ seasonNumber, requiresPassword, onDone }: { seasonNumber: number; requiresPassword: boolean; onDone: (r: SeasonActionResult) => void }) {
  const [pending, start] = useTransition()
  const [pw, setPw] = useState('')
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); start(async () => onDone(await registerForSeasonAction(seasonNumber, pw))) }}
    >
      {requiresPassword && (
        <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" required placeholder="Season password" className="rounded-md border border-input bg-card px-3 py-2 text-sm" autoComplete="off" />
      )}
      <Button size="sm" type="submit" disabled={pending}><UserPlus className="size-4" /> {pending ? 'Registering…' : 'Register for this Season'}</Button>
    </form>
  )
}

function AddPlayer({ seasonId, run }: { seasonId: number; run: (fn: () => Promise<SeasonActionResult>) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<{ playerId: string; primaryName: string; cueverseId: string | null }[]>([])
  const [searching, startSearch] = useTransition()

  const load = (value: string) => { setQ(value); startSearch(async () => setCandidates(await searchSeasonPlayersAction(seasonId, value.trim()))) }
  const openList = () => { setOpen(true); if (candidates.length === 0) load('') }

  return (
    <div className="relative max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <input value={q} onChange={(e) => load(e.target.value)} onFocus={openList} onClick={openList} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Add player by name or CueVerse ID…" className="w-72 rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm" aria-label="Add player" />
      </div>
      {open && (
        <ul className="absolute z-10 mt-1 max-h-64 w-72 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg">
          {searching && <li className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</li>}
          {!searching && candidates.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">No eligible players. Create the account first.</li>}
          {candidates.map((c) => (
            <li key={c.playerId}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => run(async () => { const r = await addSeasonEntrantAction(seasonId, c.playerId); setQ(''); setCandidates([]); setOpen(false); return r })} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                <span>{c.primaryName}{c.cueverseId && c.cueverseId.toLowerCase() !== c.primaryName.toLowerCase() && <span className="ml-1 text-xs text-muted-foreground">({c.cueverseId})</span>}</span>
                <Plus className="size-3.5 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
