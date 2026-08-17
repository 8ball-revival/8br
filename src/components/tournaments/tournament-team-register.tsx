'use client'

import { useMemo, useState } from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Users, Lock, LockOpen, CheckCircle2, Crown, Shield, X, Search, UserRound } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ProfileCompletionNotice } from '@/components/identity/profile-completion-notice'
import { PlayerName } from '@/components/identity/player-name'
import { fromNameHandle, identityText } from '@/lib/identity/display'
import { startTeamAction, joinTeamAction, withdrawFromTeamAction, removeTeamMemberAction, setTeamJoinCodeAction, registerFreeAgentAction, withdrawFreeAgentAction, type FormResult } from '@/lib/account/actions'
import type { SignupIdentity } from '@/components/account/register-form'

export interface MyTeamView {
  teamId: number
  name: string
  capacity: number
  spaces: number
  isCaptain: boolean
  protected: boolean
  complete: boolean
  members: { userId: number | null; name: string; handle: string | null; captain: boolean }[]
}
export interface JoinableTeamView {
  teamId: number
  name: string
  size: number
  capacity: number
  full: boolean
  protected: boolean
}

const initial: FormResult = {}
const input = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

export function TournamentTeamRegister({
  number,
  isLoggedIn,
  registrationOpen,
  identity,
  missing,
  membership,
  freeAgent,
  joinableTeams,
  currentUserId,
  requiresPassword = false,
}: {
  number: number
  isLoggedIn: boolean
  registrationOpen: boolean
  identity: SignupIdentity | null
  missing: string[]
  membership: MyTeamView | null
  freeAgent: boolean
  joinableTeams: JoinableTeamView[]
  currentUserId: number | null
  requiresPassword?: boolean
}) {
  return (
    <section className="mt-8 rounded-lg border border-border bg-card/40 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand">
        <Users className="size-4" aria-hidden /> Team registration
      </h2>
      {!isLoggedIn ? (
        <SignInPrompt number={number} />
      ) : membership ? (
        <MyTeamCard number={number} team={membership} currentUserId={currentUserId} registrationOpen={registrationOpen} />
      ) : !identity || missing.length > 0 ? (
        <ProfileCompletionNotice missing={missing} />
      ) : freeAgent ? (
        <FreeAgentCard number={number} identity={identity} joinableTeams={joinableTeams} registrationOpen={registrationOpen} requiresPassword={requiresPassword} />
      ) : registrationOpen ? (
        <StartOrJoin number={number} identity={identity} joinableTeams={joinableTeams} allowFree requiresPassword={requiresPassword} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="size-4" /> Registration is closed — rosters are locked.</p>
      )}
    </section>
  )
}

function FreeAgentCard({ number, identity, joinableTeams, registrationOpen, requiresPassword }: { number: number; identity: SignupIdentity; joinableTeams: JoinableTeamView[]; registrationOpen: boolean; requiresPassword: boolean }) {
  const [state, action, pending] = useActionState(withdrawFreeAgentAction, initial)
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border border-brand/30 bg-brand/[0.06] px-4 py-3 text-sm">
        <UserRound className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <div>
          <p className="font-semibold text-foreground">You&apos;re registered as a Free Agent.</p>
          <p className="mt-0.5 text-muted-foreground">When registration closes, an admin places you on a team that needs players — or groups you with other free agents into a new team.</p>
        </div>
      </div>
      {registrationOpen && !state.ok && (
        <form action={action}>
          <input type="hidden" name="number" value={number} />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>{pending ? 'Withdrawing…' : 'Withdraw as free agent'}</Button>
          <ErrorLine error={state.error} />
        </form>
      )}
      {state.ok && <p className="text-sm text-muted-foreground">You have withdrawn from free agency.</p>}
      {registrationOpen && !state.ok && (
        <div className="rounded-md border border-border bg-background/40 p-4">
          <p className="mb-3 text-xs text-muted-foreground">Changed your mind? Start or join a team instead — it replaces your free-agent registration.</p>
          <StartOrJoin number={number} identity={identity} joinableTeams={joinableTeams} allowFree={false} requiresPassword={requiresPassword} />
        </div>
      )}
    </div>
  )
}

function SignInPrompt({ number }: { number: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Lock className="size-4 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">Sign in to start or join a team.</p>
      <Button asChild size="sm"><Link href={`/login?returnTo=${encodeURIComponent(`/tournaments/${number}`)}`}>Sign in</Link></Button>
    </div>
  )
}

function JoinPasswordField({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <Field label="Tournament password">
      <input name="joinPassword" type="password" required maxLength={200} placeholder="This is a private tournament" className={cn(input, 'max-w-[280px]')} autoComplete="off" />
      <p className="mt-1.5 text-xs text-muted-foreground">This tournament is private — ask the organizer for the password. (Separate from any team join code.)</p>
    </Field>
  )
}

function RulesAck() {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name="rulesAck" required className="mt-0.5 size-4 rounded border-input accent-brand" />
      <span className="text-muted-foreground">I have read and agree to the tournament rules and format.</span>
    </label>
  )
}

function StartOrJoin({ number, identity, joinableTeams, allowFree, requiresPassword }: { number: number; identity: SignupIdentity; joinableTeams: JoinableTeamView[]; allowFree: boolean; requiresPassword: boolean }) {
  const [mode, setMode] = useState<'start' | 'join' | 'free'>('start')
  const captainLabel = identityText({ cueverseId: identity.cueverseId, preferredName: identity.preferredName })
  const tabs: { id: 'start' | 'join' | 'free'; label: string }[] = [
    { id: 'start', label: 'Start a new team' },
    { id: 'join', label: 'Join an existing team' },
    ...(allowFree ? ([{ id: 'free', label: 'Register as a free agent' }] as const) : []),
  ]
  return (
    <div>
      <div className="mb-4 inline-flex flex-wrap rounded-md border border-input bg-card p-1">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setMode(t.id)} className={cn('rounded px-4 py-1.5 text-sm font-semibold transition-colors', mode === t.id ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground')}>{t.label}</button>
        ))}
      </div>
      <div className="mb-4 rounded-md border border-border bg-background/50 px-3 py-2 text-sm">
        <span className="text-muted-foreground">You&apos;ll register as </span>
        <span className="font-semibold text-foreground">{captainLabel}</span>
        <span className="text-muted-foreground"> — from your account (read-only).</span>
      </div>
      {mode === 'start' ? <StartTeamForm number={number} requiresPassword={requiresPassword} /> : mode === 'join' ? <JoinTeamForm number={number} joinableTeams={joinableTeams} requiresPassword={requiresPassword} /> : <FreeAgentForm number={number} requiresPassword={requiresPassword} />}
    </div>
  )
}

function FreeAgentForm({ number, requiresPassword }: { number: number; requiresPassword: boolean }) {
  const [state, action, pending] = useActionState(registerFreeAgentAction, initial)
  if (state.ok) return <Success text="You're registered as a Free Agent. An admin will place you on a team when registration closes." />
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="number" value={number} />
      <p className="text-sm text-muted-foreground">Don&apos;t have a team? Register as a Free Agent and you&apos;ll be placed on a team that needs players — or grouped with other free agents into a new team — when registration closes.</p>
      <JoinPasswordField show={requiresPassword} />
      <RulesAck />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={pending}><UserRound className="size-4" /> {pending ? 'Registering…' : 'Register as a Free Agent'}</Button>
    </form>
  )
}

function StartTeamForm({ number, requiresPassword }: { number: number; requiresPassword: boolean }) {
  const [state, action, pending] = useActionState(startTeamAction, initial)
  const [useCode, setUseCode] = useState(false)
  if (state.ok) return <Success text="Your team is created — you're the captain. Share your team name (and code, if you set one) so players can join." />
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="number" value={number} />
      <Field label="Team name">
        <input name="teamName" required maxLength={60} placeholder="e.g. Cue Crew" className={input} autoComplete="off" />
      </Field>
      <JoinPasswordField show={requiresPassword} />
      <div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={useCode} onChange={(e) => setUseCode(e.target.checked)} className="size-4 rounded border-input accent-brand" />
          Protect this team with a join code <span className="text-muted-foreground/60">(optional)</span>
        </label>
        {useCode && (
          <input name="joinCode" minLength={3} maxLength={40} placeholder="Team join code" className={cn(input, 'mt-2 max-w-[280px]')} autoComplete="off" />
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">No code = any registered player can join while there&apos;s room. This is separate from any tournament password.</p>
      </div>
      <RulesAck />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create team'}</Button>
    </form>
  )
}

function JoinTeamForm({ number, joinableTeams, requiresPassword }: { number: number; joinableTeams: JoinableTeamView[]; requiresPassword: boolean }) {
  const [state, action, pending] = useActionState(joinTeamAction, initial)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<JoinableTeamView | null>(null)
  const filtered = useMemo(() => joinableTeams.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase())), [joinableTeams, query])

  if (state.ok) return <Success text="You've joined the team. It now shows on your tournament page." />
  if (joinableTeams.length === 0) return <p className="text-sm text-muted-foreground">No teams yet — start one instead.</p>

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="teamId" value={selected?.teamId ?? ''} />
      <Field label="Find a team">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <input value={selected ? selected.name : query} onChange={(e) => { setSelected(null); setQuery(e.target.value) }} placeholder="Search teams…" className={cn(input, 'pl-9')} autoComplete="off" />
        </div>
        {!selected && (
          <ul className="mt-1.5 max-h-52 overflow-y-auto rounded-md border border-border bg-card">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">No matching teams.</li>
            ) : filtered.map((t) => (
              <li key={t.teamId}>
                <button type="button" disabled={t.full} onClick={() => { setSelected(t); setQuery('') }}
                  className={cn('flex w-full items-center justify-between px-3 py-2 text-left text-sm', t.full ? 'cursor-not-allowed text-muted-foreground/50' : 'hover:bg-brand/10')}>
                  <span className="flex items-center gap-2 font-medium">
                    {t.protected && <Shield className="size-3.5 text-muted-foreground" aria-hidden />}
                    {t.name}
                  </span>
                  <span className="tabular-nums text-xs text-muted-foreground">{t.full ? 'Full' : `${t.size} of ${t.capacity} players`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>
      {selected?.protected && (
        <Field label="Team join code">
          <input name="joinCode" required maxLength={40} placeholder="Enter the team's join code" className={cn(input, 'max-w-[280px]')} autoComplete="off" />
        </Field>
      )}
      <JoinPasswordField show={requiresPassword} />
      <RulesAck />
      <ErrorLine error={state.error} />
      <Button type="submit" disabled={pending || !selected}>{pending ? 'Joining…' : selected ? `Join ${selected.name}` : 'Select a team'}</Button>
    </form>
  )
}

function MyTeamCard({ number, team, currentUserId, registrationOpen }: { number: number; team: MyTeamView; currentUserId: number | null; registrationOpen: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="size-5 text-success" aria-hidden />
        <span className="text-base font-bold text-foreground">{team.name}</span>
        {team.protected ? <Badge icon={<Shield className="size-3" />} text="Protected" /> : <Badge icon={<LockOpen className="size-3" />} text="Open" />}
        <span className="text-xs text-muted-foreground tabular-nums">{team.members.length} of {team.capacity} players</span>
        {team.complete ? <Badge tone="ok" text="Complete" /> : <Badge tone="warn" text={`Needs ${team.spaces} more`} />}
      </div>

      <ul className="divide-y divide-border/50 rounded-md border border-border">
        {team.members.map((m, i) => (
          <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              {m.captain && <Crown className="size-3.5 text-brand" aria-label="Captain" />}
              <PlayerName identity={fromNameHandle(m)} size="sm" className="text-foreground" />
              {m.captain && <span className="text-[0.65rem] uppercase tracking-wide text-brand">Captain</span>}
              {m.userId === currentUserId && <span className="text-[0.65rem] text-muted-foreground">(you)</span>}
            </span>
            {team.isCaptain && registrationOpen && m.userId != null && m.userId !== currentUserId && (
              <RemoveMemberButton number={number} memberUserId={m.userId} name={identityText(fromNameHandle(m))} />
            )}
          </li>
        ))}
      </ul>

      {!team.complete && registrationOpen && (
        <p className="text-xs text-amber-500">Incomplete teams can&apos;t enter — fill your roster before registration closes.</p>
      )}

      {team.isCaptain && registrationOpen && <CaptainCodeControl number={number} isProtected={team.protected} />}

      {registrationOpen ? (
        <WithdrawButton number={number} isCaptain={team.isCaptain} hasOthers={team.members.length > 1} />
      ) : (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Lock className="size-3.5" /> Rosters are locked — registration is closed.</p>
      )}
    </div>
  )
}

function RemoveMemberButton({ number, memberUserId, name }: { number: number; memberUserId: number; name: string }) {
  const [state, action, pending] = useActionState(removeTeamMemberAction, initial)
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Remove ${name} from the team?`)) e.preventDefault() }}>
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="memberUserId" value={memberUserId} />
      <button type="submit" disabled={pending} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label={`Remove ${name}`} title={state.error || 'Remove'}>
        <X className="size-4" />
      </button>
    </form>
  )
}

function CaptainCodeControl({ number, isProtected }: { number: number; isProtected: boolean }) {
  const [state, action, pending] = useActionState(setTeamJoinCodeAction, initial)
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Join code:</span>
        <span className="font-medium">{isProtected ? '•••••• (set)' : 'None — open team'}</span>
        <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-brand-hover hover:underline">{isProtected ? 'Change / remove' : 'Add a code'}</button>
      </div>
    )
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="number" value={number} />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">New code <span className="text-muted-foreground/60">(blank = remove)</span></label>
        <input name="joinCode" maxLength={40} placeholder="Team join code" className={cn(input, 'w-56')} autoComplete="off" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save code'}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      <ErrorLine error={state.error} />
    </form>
  )
}

function WithdrawButton({ number, isCaptain, hasOthers }: { number: number; isCaptain: boolean; hasOthers: boolean }) {
  const [state, action, pending] = useActionState(withdrawFromTeamAction, initial)
  const warn = isCaptain ? (hasOthers ? 'Withdraw and pass captaincy to the next member?' : 'Withdraw and disband this team?') : 'Withdraw from this team?'
  if (state.ok) return <p className="text-sm text-muted-foreground">You have withdrawn from the team.</p>
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(warn)) e.preventDefault() }}>
      <input type="hidden" name="number" value={number} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>{pending ? 'Withdrawing…' : 'Withdraw from team'}</Button>
      <ErrorLine error={state.error} />
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-[0.8rem] font-semibold text-foreground">{label}</label>{children}</div>
}
function ErrorLine({ error }: { error?: string }) {
  if (!error) return null
  return <p role="alert" className="mt-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
}
function Success({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
      <p className="font-medium text-foreground">{text}</p>
    </div>
  )
}
function Badge({ text, icon, tone }: { text: string; icon?: React.ReactNode; tone?: 'ok' | 'warn' }) {
  const cls = tone === 'ok' ? 'border-success/30 bg-success/10 text-success' : tone === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-500' : 'border-border bg-card text-muted-foreground'
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold', cls)}>{icon}{text}</span>
}
