'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Crown, Plus, X, UserRound, Lock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PlayerName } from '@/components/identity/player-name'
import { fromNameHandle, identityText } from '@/lib/identity/display'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { TeamView } from '@/lib/competition/teams'
import type { EligibleAccount, FreeAgentRow, ClosingPlan } from '@/lib/competition/free-agents'
import {
  listEligibleAccountsAction, listFreeAgentsAction,
  adminCreateTeamWithPlayersAction, adminAddTeamMemberAction, adminRemoveTeamMemberAction, adminReplaceTeamMemberAction,
  renameTeamAction, deleteTeamAction,
  previewCloseAllocationAction, confirmCloseAllocationAction,
} from '@/lib/competition/tournament-actions'

const sel = 'rounded-none border border-input bg-card px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-brand'

export function AdminTeamsManager({ tournamentId, teamSize, teams, registrationOpen }: { tournamentId: number; teamSize: number; teams: TeamView[]; registrationOpen: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [eligible, setEligible] = useState<EligibleAccount[]>([])
  const [freeAgents, setFreeAgents] = useState<FreeAgentRow[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const reload = useCallback(async () => {
    const [e, f] = await Promise.all([listEligibleAccountsAction(tournamentId), listFreeAgentsAction(tournamentId)])
    setEligible(e); setFreeAgents(f)
  }, [tournamentId])
  // Load the eligible-account + free-agent pools on mount and whenever the roster data changes.
  useEffect(() => {
    let live = true
    void (async () => {
      const [e, f] = await Promise.all([listEligibleAccountsAction(tournamentId), listFreeAgentsAction(tournamentId)])
      if (live) { setEligible(e); setFreeAgents(f) }
    })()
    return () => { live = false }
  }, [tournamentId, teams])

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn()
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' })
      await reload()
      router.refresh()
    })

  const active = teams.filter((t) => !t.withdrawn)

  if (!registrationOpen) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="size-4" /> Registration is closed — rosters are locked. Team management is available while registration is open.</p>
    )
  }

  return (
    <div className="space-y-6">
      {msg && <p className={cn('text-sm', msg.ok ? 'text-success' : 'text-destructive')}>{msg.text}</p>}

      {/* Existing teams — one dropdown slot per position */}
      <div className="space-y-4">
        {active.length === 0 && <p className="text-sm text-muted-foreground">No teams yet. Create one below, or players can start their own.</p>}
        {active.map((team) => {
          const filled = team.members.length
          const emptySlots = Math.max(0, teamSize - filled)
          return (
            <div key={team.id} className="overflow-hidden rounded-none border border-border">
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/40 px-4 py-2">
                <span className="text-sm font-semibold text-foreground">{team.name}</span>
                <span className={cn('cyber-clip-sm px-2 py-0.5 text-[0.65rem] font-semibold', filled >= teamSize ? 'bg-success/10 text-success' : 'bg-[var(--attention-surface)] text-[var(--gold)]')}>{filled} of {teamSize}</span>
                <div className="ml-auto flex gap-1">
                  <button type="button" disabled={pending} onClick={async () => { const res = await confirm({ title: 'Rename team', confirmLabel: 'Rename', input: { label: 'Team name', defaultValue: team.name, required: true } }); if (res.confirmed && res.value.trim()) run(() => renameTeamAction(team.id, res.value.trim())) }} className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground">Rename</button>
                  <button type="button" disabled={pending} onClick={async () => { const res = await confirm({ title: 'Delete this team?', message: `"${team.name}" is deleted and its players return to the eligible pool.`, confirmLabel: 'Delete team', tone: 'danger' }); if (res.confirmed) run(() => deleteTeamAction(team.id)) }} className="rounded px-2 py-1 text-xs text-destructive hover:underline">Delete</button>
                </div>
              </div>
              <div className="space-y-1.5 p-3">
                {team.members.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-none border border-border/60 bg-background/40 px-3 py-1.5 text-sm">
                    {m.captain && <Crown className="size-3.5 text-brand" aria-label="Captain" />}
                    <PlayerName identity={fromNameHandle(m)} size="sm" className="text-foreground" />
                    {m.captain && <span className="text-[0.66rem] uppercase tracking-wide text-brand">Captain</span>}
                    <div className="ml-auto flex items-center gap-1.5">
                      {m.userId != null && (
                        <select className={cn(sel, 'py-1 text-xs')} defaultValue="" disabled={pending} onChange={(e) => { const nv = Number(e.target.value); if (nv) run(() => adminReplaceTeamMemberAction(tournamentId, team.id, m.userId!, nv)) }}>
                          <option value="">Replace with…</option>
                          {eligible.map((a) => <option key={a.userId} value={a.userId}>{identityText(fromNameHandle(a))}</option>)}
                        </select>
                      )}
                      {m.userId != null && (
                        <button type="button" disabled={pending} onClick={async () => { const res = await confirm({ title: 'Remove player?', message: `Remove ${identityText(fromNameHandle(m))} from ${team.name}?`, confirmLabel: 'Remove', tone: 'danger' }); if (res.confirmed) run(() => adminRemoveTeamMemberAction(tournamentId, team.id, m.userId!)) }} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Remove"><X className="size-4" /></button>
                      )}
                    </div>
                  </div>
                ))}
                {Array.from({ length: emptySlots }, (_, i) => (
                  <div key={`empty-${i}`} className="flex items-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-1.5">
                    <span className="text-xs text-muted-foreground">Open slot</span>
                    <select className={cn(sel, 'ml-auto py-1 text-xs')} defaultValue="" disabled={pending} onChange={(e) => { const uid = Number(e.target.value); if (uid) run(() => adminAddTeamMemberAction(tournamentId, team.id, uid)) }}>
                      <option value="">Add a player…</option>
                      {eligible.map((a) => <option key={a.userId} value={a.userId}>{identityText(fromNameHandle(a))}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <CreateTeam tournamentId={tournamentId} teamSize={teamSize} eligible={eligible} pending={pending} run={run} />

      {/* Free agents */}
      <div className="rounded-none border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-card/40 px-4 py-2">
          <UserRound className="size-4 text-brand" />
          <span className="text-sm font-semibold">Free Agents</span>
          <span className="text-xs text-muted-foreground">{freeAgents.length} waiting</span>
        </div>
        <div className="p-3">
          {freeAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No free agents waiting.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {freeAgents.map((f) => <li key={f.id} className="rounded-none border border-border bg-card px-2.5 py-1 text-xs">{identityText(fromNameHandle(f))}</li>)}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Free agents are placed automatically when you close registration (preview below).</p>
        </div>
      </div>

      <CloseRegistration tournamentId={tournamentId} onDone={() => { reload(); router.refresh() }} />
    </div>
  )
}

function CreateTeam({ tournamentId, teamSize, eligible, pending, run }: { tournamentId: number; teamSize: number; eligible: EligibleAccount[]; pending: boolean; run: (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) => void }) {
  const [name, setName] = useState('')
  const [picks, setPicks] = useState<number[]>([])
  const set = (i: number, v: number) => setPicks((p) => { const c = [...p]; c[i] = v; return c })
  const chosen = picks.filter(Boolean)
  return (
    <div className="rounded-none border border-border p-4">
      <p className="mb-3 text-[0.7rem] font-bold uppercase tracking-wider text-brand">Create a team</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Team name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={cn(sel, 'w-48')} placeholder="Team name" />
        </div>
        {Array.from({ length: teamSize }, (_, i) => (
          <div key={i}>
            <label className="mb-1 block text-xs text-muted-foreground">{i === 0 ? 'Captain' : `Player ${i + 1}`}</label>
            <select className={cn(sel, 'w-40')} value={picks[i] ?? ''} onChange={(e) => set(i, Number(e.target.value))}>
              <option value="">—</option>
              {eligible.filter((a) => !chosen.includes(a.userId) || a.userId === picks[i]).map((a) => <option key={a.userId} value={a.userId}>{identityText(fromNameHandle(a))}</option>)}
            </select>
          </div>
        ))}
        <Button size="sm" disabled={pending || !name.trim() || chosen.length === 0} onClick={() => run(async () => { const r = await adminCreateTeamWithPlayersAction(tournamentId, name.trim(), chosen); if (!r.error) { setName(''); setPicks([]) } return r })}>
          <Plus className="size-4" /> Create
        </Button>
      </div>
    </div>
  )
}

function CloseRegistration({ tournamentId, onDone }: { tournamentId: number; onDone: () => void }) {
  const [plan, setPlan] = useState<ClosingPlan | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const preview = () => start(async () => {
    setErr(null)
    const r = await previewCloseAllocationAction(tournamentId)
    if (r.error || !r.plan) { setErr(r.error ?? 'Could not build the preview.'); return }
    setPlan(r.plan); setOpen(true)
  })
  const confirm = () => start(async () => {
    const r = await confirmCloseAllocationAction(tournamentId)
    if (r.error) { setErr(r.error); return }
    setOpen(false); onDone()
  })

  return (
    <div className="cyber-clip border border-brand/30 bg-[var(--selected-surface)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Close registration</p>
          <p className="text-xs text-muted-foreground">Preview how free agents will be allocated before anything changes.</p>
        </div>
        <Button size="sm" disabled={pending} onClick={preview}>{pending && !open ? 'Building…' : 'Preview & close'}</Button>
      </div>
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}

      {open && plan && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-none border border-border bg-surface shadow-2xl">
            <div className="border-b border-border px-5 py-3">
              <h3 className="text-base font-bold">Close registration — preview</h3>
              <p className="text-xs text-muted-foreground">Nothing changes until you confirm.</p>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm">
              <div className="flex gap-4 rounded-none border border-border bg-card/40 p-3">
                <Stat label="Teams entering" value={plan.finalTeams} />
                <Stat label="Players entering" value={plan.finalPlayers} />
                <Stat label="Not placed" value={plan.unplaced.length} tone={plan.unplaced.length ? 'warn' : undefined} />
              </div>
              {plan.fills.length > 0 && (
                <Section title="Free agents filling incomplete teams">
                  {plan.fills.map((f) => <li key={f.teamId}><b>{f.teamName}</b> ← {f.assigned.map((a) => identityText(fromNameHandle(a))).join(', ')}</li>)}
                </Section>
              )}
              {plan.newTeams.length > 0 && (
                <Section title="New teams from free agents">
                  {plan.newTeams.map((t, i) => <li key={i}><b>{t.name}</b>: {t.members.map((m) => identityText(fromNameHandle(m))).join(', ')} <span className="text-muted-foreground">(captain: {identityText(fromNameHandle(t.members[0]))})</span></li>)}
                </Section>
              )}
              {plan.stillIncomplete.length > 0 && (
                <Section title="Teams that can't reach the roster size (won't enter)" tone="warn">
                  {plan.stillIncomplete.map((s) => <li key={s.teamId}><b>{s.teamName}</b> — {s.size} of {s.needed} players</li>)}
                </Section>
              )}
              {plan.unplaced.length > 0 && (
                <Section title="Players who cannot be placed" tone="warn">
                  {plan.unplaced.map((u) => <li key={u.userId}>{identityText(fromNameHandle(u))}</li>)}
                  <li className="list-none pt-1 text-xs text-muted-foreground">Not enough remaining players to form another team of {plan.teamSize}. They won&apos;t be placed unless more players register — retained as “Not Placed”.</li>
                </Section>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={pending} onClick={confirm}>{pending ? 'Closing…' : 'Confirm & close registration'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return <div><div className={cn('text-xl font-bold tabular-nums', tone === 'warn' ? 'text-[var(--gold)]' : 'text-foreground')}>{value}</div><div className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</div></div>
}
function Section({ title, tone, children }: { title: string; tone?: 'warn'; children: React.ReactNode }) {
  return (
    <div>
      <p className={cn('mb-1 text-xs font-semibold', tone === 'warn' ? 'text-[var(--gold)]' : 'text-foreground')}>{title}</p>
      <ul className="space-y-1 rounded-none border border-border/60 bg-background/40 p-2.5 text-[0.8rem]">{children}</ul>
    </div>
  )
}
