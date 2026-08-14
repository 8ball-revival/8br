'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy, Users, GitBranch, ListChecks, Settings2, History, Plus, X, ChevronUp, ChevronDown, GripVertical, RotateCcw, ShieldAlert } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bracket } from '@/components/tournaments/bracket'
import { TournamentLifecycleControls } from '@/components/tournaments/tournament-lifecycle-controls'
import { TournamentHistory } from '@/components/tournaments/tournament-history'
import { FlairEditor, FlairPreview, type FlairValue } from '@/components/tournaments/flair-editor'
import { AdminTeamsManager } from '@/components/tournaments/admin-teams'
import type { TournamentWorkspaceData, PlayoffRow } from '@/lib/tournaments/live'
import type { TournamentHistoryEvent } from '@/lib/competition/tournament-lifecycle'
import * as A from '@/lib/competition/tournament-actions'

type Tab = 'overview' | 'roster' | 'groups' | 'swiss' | 'bracket' | 'results' | 'history' | 'settings'
type ActionResp = { ok?: boolean; error?: string; message?: string } | void
type Run = (fn: () => Promise<ActionResp>) => void

export function TournamentWorkspace({
  data,
  canManage,
  canEditResults,
  isOwner,
  history = [],
}: {
  data: TournamentWorkspaceData
  canManage: boolean
  canEditResults: boolean
  isOwner: boolean
  /** Admin (fuller) cup history — actor + reason included. Loaded server-side. */
  history?: TournamentHistoryEvent[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string } | void>) =>
    start(async () => {
      try {
        const r = await fn()
        if (r && 'error' in r && r.error) setMsg({ ok: false, text: r.error })
        else setMsg({ ok: true, text: (r && 'message' in r && r.message) || 'Saved.' })
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : 'Action failed.' })
      }
      router.refresh()
    })

  const rosterLabel = data.isTeam ? 'Teams' : 'Entrants'
  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'overview', label: 'Overview', icon: Trophy },
    { id: 'roster', label: rosterLabel, icon: Users },
    ...(data.isGroupStage ? ([{ id: 'groups', label: 'Groups', icon: ListChecks }] as const) : []),
    ...(data.isSwiss ? ([{ id: 'swiss', label: 'Swiss', icon: ListChecks }] as const) : []),
    ...(data.isSwiss ? [] : ([{ id: 'bracket', label: 'Bracket', icon: GitBranch }] as const)),
    ...(data.isSwiss ? [] : ([{ id: 'results', label: 'Results', icon: ListChecks }] as const)),
    { id: 'history', label: 'History', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ]

  return (
    <div className="mt-6 rounded-xl border border-brand/30 bg-card/40">
      {/* Admin toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Badge variant="default">Admin</Badge>
        <span className="text-sm font-medium text-foreground">Competition workspace</span>
        <span className="text-xs text-muted-foreground">
          {data.tournament.code} · {data.isTeam ? `${data.tournament.teamSize ?? 2}-player teams` : 'Individual'} ·{' '}
          {(data.tournament.tournamentFormat ?? 'SINGLE_ELIM').replace(/_/g, ' ').toLowerCase()}
        </span>
        {pending && <span className="ml-auto text-xs text-muted-foreground">Working…</span>}
      </div>

      {/* Lifecycle controls (state machine — server-enforced + audited). */}
      {canManage && !data.isHistorical && (
        <div className="px-4 pt-4">
          <TournamentLifecycleControls
            tournamentId={data.tournament.id}
            state={data.tournament.lifecycleState as 'DRAFT' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'GROUPS_IN_PROGRESS' | 'BRACKET_GENERATED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'}
            isOwner={isOwner}
            bracketStale={data.bracketStale}
            isGroupStage={data.isGroupStage}
            isSwiss={data.isSwiss}
            groupsComplete={data.groupsComplete}
            onNavigate={(t) => setTab(t === 'results' && data.isSwiss ? 'swiss' : t)}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id ? 'bg-brand/15 text-brand' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div className={cn('mx-4 mt-3 rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-brand/30 bg-brand/[0.06] text-foreground' : 'border-destructive/40 bg-destructive/[0.06] text-destructive')}>
          {msg.text}
        </div>
      )}

      <div className="p-4">
        {tab === 'overview' && <Overview data={data} />}
        {tab === 'roster' && (
          data.isTeam
            ? (data.tournament.teamFormation === 'PICK' && canManage && !data.isHistorical
                ? <AdminTeamsManager tournamentId={data.tournament.id} teamSize={data.tournament.teamSize ?? 2} teams={data.teams} registrationOpen={data.tournament.lifecycleState === 'REGISTRATION_OPEN'} />
                : <TeamsTab data={data} run={run} disabled={!canManage || data.isHistorical} />)
            : <EntrantsTab data={data} run={run} disabled={!canManage || data.isHistorical} />
        )}
        {tab === 'groups' && <GroupsTab data={data} run={run} canEditResults={canEditResults} />}
        {tab === 'swiss' && <SwissTab data={data} run={run} canEditResults={canEditResults} canManage={canManage} />}
        {tab === 'bracket' && <BracketTab data={data} run={run} disabled={!canManage || data.isHistorical} />}
        {tab === 'results' && <ResultsTab data={data} run={run} disabled={!canEditResults || data.isHistorical} />}
        {tab === 'history' && (
          <div>
            <p className="eyebrow mb-3 text-muted-foreground">Full audit history (admin) — actor and reason included.</p>
            <TournamentHistory events={history} admin />
          </div>
        )}
        {tab === 'settings' && <SettingsTab data={data} run={run} canManage={canManage} isOwner={isOwner} />}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- Overview

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Overview({ data }: { data: TournamentWorkspaceData }) {
  const rosterCount = data.isTeam ? data.teams.filter((t) => !t.withdrawn).length : data.entrants.filter((e) => !e.withdrawn).length
  const played = data.matches.filter((m) => m.winnerRegistrationId != null).length
  const playable = data.matches.filter((m) => m.homeUsername && m.awayUsername).length
  const bracketState = data.hasPublishedBracket ? 'Published' : data.hasBracket ? 'Draft' : 'Not built'
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard label="Status" value={data.tournament.lifecycleState.replace(/_/g, ' ').toLowerCase()} />
      <StatCard label={data.isTeam ? 'Teams' : 'Entrants'} value={String(rosterCount)} />
      <StatCard label="Bracket" value={bracketState} hint={data.hasBracket ? `${data.matches.length} matches` : undefined} />
      <StatCard label="Results" value={`${played}/${playable}`} hint="matches decided" />
      <StatCard label="Game" value={data.tournament.gameType ?? '—'} />
      <StatCard label="Registration" value={data.tournament.registrationStatus.replace('_', ' ').toLowerCase()} />
    </div>
  )
}

// --------------------------------------------------------------------------- Entrants (individual)

/**
 * "Add Player" — searchable dropdown of eligible REGISTERED players (by Preferred Name / CueVerse ID
 * / User ID / alias). Selecting one adds it to the tournament by its permanent player id. There is no
 * free-text option: an entrant can only be a real registered account. Already-entered, inactive,
 * deleted and banned profiles are excluded server-side. An empty query lists eligible players so the
 * control is browsable.
 */
function AddPlayer({ tournamentId, run }: { tournamentId: number; run: Run }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<A.EntrantCandidate[]>([])
  const [searching, startSearch] = useTransition()

  const load = (value: string) => {
    setQ(value)
    startSearch(async () => setCandidates(await A.searchTournamentPlayersAction(tournamentId, value.trim())))
  }

  // Open the dropdown and (re)load the list when there's nothing to show. Bound to BOTH focus and
  // click: after selecting a player the input keeps focus (the option suppresses blur), so a plain
  // focus handler wouldn't fire on the next click — click re-opens it without needing to click away.
  const openList = () => { setOpen(true); if (candidates.length === 0) load('') }

  return (
    <div className="max-w-md">
      <label className="eyebrow text-muted-foreground">Add Player</label>
      <div className="relative mt-1">
        <input
          value={q}
          onChange={(e) => load(e.target.value)}
          onFocus={openList}
          onClick={openList}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search registered players by name, CueVerse ID, or User ID…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          aria-label="Search registered players"
        />
        {open && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full space-y-1 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg">
            {searching && <li className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</li>}
            {!searching && candidates.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">No eligible players found. Create the account first, then add them here.</li>}
            {candidates.map((c) => (
              <li key={c.playerId}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(async () => { const r = await A.addTournamentEntrantsAction(tournamentId, [c.playerId]); setQ(''); setCandidates([]); setOpen(false); return r })}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span>{c.primaryName}{c.cueverseId && c.cueverseId.toLowerCase() !== c.primaryName.toLowerCase() && <span className="ml-1 text-xs text-muted-foreground">({c.cueverseId})</span>}</span>
                  <Plus className="size-3.5 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Only registered accounts can be added. No account? Create it first, then it appears here.</p>
    </div>
  )
}

function EntrantsTab({ data, run, disabled }: { data: TournamentWorkspaceData; run: Run; disabled: boolean }) {
  const tournamentId = data.tournament.id
  // Entrants can only be added while registration is open or closed (never once the bracket exists).
  const canAdd = data.tournament.lifecycleState === 'REGISTRATION_OPEN' || data.tournament.lifecycleState === 'REGISTRATION_CLOSED'

  return (
    <div className="space-y-5">
      {!disabled && canAdd && <AddPlayer tournamentId={tournamentId} run={run} />}
      {!disabled && !canAdd && (
        <p className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          {data.tournament.lifecycleState === 'DRAFT'
            ? 'Open registration to add players.'
            : 'Entrants are locked once the bracket is generated. Re-open registration to change the field.'}
        </p>
      )}

      <div>
        <p className="eyebrow mb-2 text-muted-foreground">{data.entrants.length} entrants</p>
        <ul className="divide-y divide-border rounded-md border border-border">
          {data.entrants.map((e) => (
            <li key={e.registrationId} className={cn('flex items-center gap-3 px-3 py-2 text-sm', e.withdrawn && 'opacity-50')}>
              <span className="tabular w-6 text-right text-xs text-muted-foreground">{e.seed ?? '—'}</span>
              <span className="flex-1">{e.name}{e.handle && <span className="ml-2 text-xs text-muted-foreground">{e.handle}</span>}{e.withdrawn && <span className="ml-2 text-xs text-destructive">withdrawn</span>}</span>
              {!disabled && (
                e.withdrawn ? (
                  <button onClick={() => run(() => A.restoreTournamentEntrantAction(data.tournament.id, e.registrationId))} className="text-xs text-muted-foreground hover:text-brand">restore</button>
                ) : (
                  <button onClick={() => run(() => A.removeTournamentEntrantAction(data.tournament.id, e.registrationId))} className="text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
                )
              )}
            </li>
          ))}
          {data.entrants.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No entrants yet.</li>}
        </ul>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- Teams (2v2)

function TeamsTab({ data, run, disabled }: { data: TournamentWorkspaceData; run: Run; disabled: boolean }) {
  const [newTeam, setNewTeam] = useState('')
  return (
    <div className="space-y-5">
      {!disabled && (
        <div className="flex gap-2">
          <input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="New team name" className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <Button onClick={() => run(async () => { const r = await A.createTeamAction(data.tournament.id, newTeam); setNewTeam(''); return r })} disabled={!newTeam.trim()}>
            <Plus className="size-4" /> Create team
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data.teams.map((t) => (
          <TeamCard key={t.id} team={t} teamSize={data.tournament.teamSize ?? 2} run={run} disabled={disabled} />
        ))}
        {data.teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
      </div>
    </div>
  )
}

function TeamCard({ team, teamSize, run, disabled }: { team: TournamentWorkspaceData['teams'][number]; teamSize: number; run: Run; disabled: boolean }) {
  const [name, setName] = useState(team.name)
  const [roster, setRoster] = useState(team.members.map((m) => (m.handle ? `${m.name} | ${m.handle}` : m.name)).join('\n'))
  const parse = () =>
    roster.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
      const [nm, handle] = l.split('|').map((s) => s.trim())
      return { name: nm, handle: handle || null, captain: i === 0 }
    })
  return (
    <div className={cn('rounded-lg border border-border bg-background/40 p-3', team.withdrawn && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm font-semibold" />
        {team.seed != null && <Badge variant="muted">Seed {team.seed}</Badge>}
      </div>
      {!disabled && name.trim() && name !== team.name && (
        <button onClick={() => run(() => A.renameTeamAction(team.id, name))} className="mt-1 text-xs text-brand hover:underline">Save name</button>
      )}
      <textarea
        value={roster}
        onChange={(e) => setRoster(e.target.value)}
        disabled={disabled}
        rows={teamSize}
        placeholder={`One member per line (max ${teamSize})\nName | handle`}
        className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
      />
      {!disabled && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => run(() => A.setTeamMembersAction(team.id, parse()))}>Save roster</Button>
          {team.withdrawn ? (
            <Button size="sm" variant="secondary" onClick={() => run(() => A.restoreTeamAction(team.id))}>Restore</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => run(() => A.withdrawTeamAction(team.id))}>Withdraw</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => run(() => A.deleteTeamAction(team.id))}>Delete</Button>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------- Bracket

function BracketTab({ data, run, disabled }: { data: TournamentWorkspaceData; run: Run; disabled: boolean }) {
  // Seedable pool: teams (team cups) or entrants (individual), non-withdrawn.
  const pool = data.isTeam
    ? data.teams.filter((t) => !t.withdrawn).map((t) => ({ id: t.registrationId, name: t.name }))
    : data.entrants.filter((e) => !e.withdrawn).map((e) => ({ id: e.registrationId, name: e.name }))
  const poolKey = pool.map((p) => p.id).join(',') // reset the seed builder when the pool changes
  // Bracket generation/regeneration is only possible after registration closes and before the
  // tournament begins (server-enforced too). Once In Progress/Completed the bracket is fixed.
  const canBuild = data.tournament.lifecycleState === 'REGISTRATION_CLOSED' || data.tournament.lifecycleState === 'BRACKET_GENERATED'

  return (
    <div className="space-y-6">
      {!disabled && canBuild && <SeedBuilder key={poolKey} data={data} pool={pool} run={run} />}
      {!disabled && !canBuild && (
        <p className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          {data.tournament.lifecycleState === 'IN_PROGRESS'
            ? 'The tournament is in progress — the bracket is fixed. Enter results in the Results tab.'
            : data.tournament.lifecycleState === 'COMPLETED'
              ? 'This cup is completed — the bracket is read-only.'
              : 'Close registration to generate the bracket.'}
        </p>
      )}
      <div>
        <p className="eyebrow mb-3 text-foreground">Bracket preview</p>
        {data.bracketRounds.length > 0 ? (
          <Bracket rounds={data.bracketRounds} />
        ) : (
          <p className="text-sm text-muted-foreground">No bracket yet — build one from the seed order above.</p>
        )}
      </div>
    </div>
  )
}

/** Seed-order builder. Keyed on the pool so it re-initialises when entrants/teams change
 *  (no effect needed). Drag to reorder, or use the up/down controls. */
function SeedBuilder({ data, pool, run }: { data: TournamentWorkspaceData; pool: { id: number; name: string }[]; run: Run }) {
  const [order, setOrder] = useState<number[]>(() => pool.map((p) => p.id))
  // How many of the top seeds advance to the playoff bracket (the rest are cut). Defaults to the full
  // field, so behavior is unchanged until an admin trims it.
  const [fieldSize, setFieldSize] = useState<number>(() => pool.length)
  const nameById = useMemo(() => new Map(pool.map((p) => [p.id, p.name])), [pool])
  const dragIndex = useRef<number | null>(null)
  const published = data.hasPublishedBracket

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return
    setOrder((o) => { const n = [...o]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n })
  }

  const cut = Math.max(2, Math.min(fieldSize, order.length)) // players actually included in the bracket
  const included = order.slice(0, cut)
  const bracketSlots = (() => { let s = 2; while (s < cut) s *= 2; return s })() // next power of two
  const byes = bracketSlots - cut

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="eyebrow text-muted-foreground">Seed order ({order.length})</p>
        {published ? <Badge variant="default">Published</Badge> : data.hasBracket ? <Badge variant="muted">Unpublished draft</Badge> : null}
        {!published && order.length > 2 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            Players in playoffs
            <input
              type="number"
              min={2}
              max={order.length}
              value={fieldSize}
              onChange={(e) => setFieldSize(Math.max(2, Math.min(order.length, Number(e.target.value) || order.length)))}
              className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-muted-foreground/70">of {order.length}</span>
          </label>
        )}
      </div>
      {data.hasBracket && !published && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/[0.06] px-3 py-2 text-xs text-warning">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This is a private, unpublished draft — members and the public cannot see the playoff bracket yet. Publish it to make the seeds and matchups public.
        </p>
      )}
      <ol className="mt-2 max-w-md space-y-1">
        {order.map((id, i) => {
          const inField = i < cut
          return (
            <div key={id}>
              {i === cut && cut < order.length && (
                <li aria-hidden className="my-1.5 flex items-center gap-2 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground/70">
                  <span className="h-px flex-1 bg-border" /> Not in playoffs <span className="h-px flex-1 bg-border" />
                </li>
              )}
              <li
                draggable={!published}
                onDragStart={() => (dragIndex.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragIndex.current != null) move(dragIndex.current, i); dragIndex.current = null }}
                className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm', inField ? 'border-border bg-background/50' : 'border-border/40 bg-background/20 opacity-50')}
              >
                <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                <span className="tabular w-5 text-right text-xs text-muted-foreground">{inField ? i + 1 : '–'}</span>
                <span className="flex-1 truncate">{nameById.get(id)}</span>
                {!published && (
                  <span className="flex gap-0.5">
                    <button onClick={() => move(i, i - 1)} className="text-muted-foreground hover:text-brand"><ChevronUp className="size-4" /></button>
                    <button onClick={() => move(i, i + 1)} className="text-muted-foreground hover:text-brand"><ChevronDown className="size-4" /></button>
                  </span>
                )}
              </li>
            </div>
          )
        })}
        {order.length === 0 && <li className="text-sm text-muted-foreground">Add {data.isTeam ? 'teams' : 'entrants'} first.</li>}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        {!published && (
          <Button onClick={() => run(() => A.buildTournamentBracketAction(data.tournament.id, included))} disabled={cut < 2}>
            {data.hasBracket ? 'Rebuild draft bracket' : 'Build draft bracket'}
          </Button>
        )}
        {data.hasBracket && !published && (
          <Button onClick={() => { if (window.confirm('Publish the playoff bracket?\n\nThis makes the playoff seeds and matchups visible to EVERYONE — all members and logged-out visitors. Groups stay visible too. You can return it to draft afterward.')) run(() => A.publishTournamentBracketAction(data.tournament.id)) }}>
            Publish bracket
          </Button>
        )}
        {published && <Button variant="secondary" onClick={() => run(() => A.returnTournamentBracketToDraftAction(data.tournament.id))}><RotateCcw className="size-4" /> Return to draft</Button>}
        {data.hasBracket && !published && <Button variant="ghost" onClick={() => run(() => A.deleteTournamentBracketAction(data.tournament.id))}>Delete bracket</Button>}
      </div>
      {order.length > 2 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Top <span className="font-medium text-foreground">{cut}</span> of {order.length} advance → {bracketSlots}-player bracket{byes > 0 ? ` (${byes} bye${byes === 1 ? '' : 's'})` : ''}. Bracket auto-sizes to the next power of two.
        </p>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------- Results

function ResultsTab({ data, run, disabled }: { data: TournamentWorkspaceData; run: Run; disabled: boolean }) {
  const playable = data.matches.filter((m) => m.homeUsername && m.awayUsername)
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Race to <span className="font-semibold text-foreground">{data.tournament.raceLength}</span> — the winner must reach {data.tournament.raceLength} games.
      </p>
      {playable.length === 0 && <p className="text-sm text-muted-foreground">No playable matches yet. Build and publish the bracket first.</p>}
      {playable.map((m) => (
        <ResultRow key={m.id} m={m} run={run} disabled={disabled} />
      ))}
    </div>
  )
}

function ResultRow({ m, run, disabled }: { m: PlayoffRow; run: Run; disabled: boolean }) {
  const [home, setHome] = useState(m.homeGames?.toString() ?? '')
  const [away, setAway] = useState(m.awayGames?.toString() ?? '')
  const decided = m.winnerRegistrationId != null
  const homeWon = decided && m.winnerRegistrationId === m.homeRegistrationId
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="w-16 text-xs text-muted-foreground">{m.label ?? `R${m.round}·${m.slot + 1}`}</span>
        <span className={cn('flex-1', homeWon && 'font-semibold text-brand')}>{m.homeUsername}</span>
        <input value={home} onChange={(e) => setHome(e.target.value)} disabled={disabled} inputMode="numeric" className="w-12 rounded border border-border bg-background px-2 py-1 text-center text-sm" />
        <span className="text-muted-foreground">–</span>
        <input value={away} onChange={(e) => setAway(e.target.value)} disabled={disabled} inputMode="numeric" className="w-12 rounded border border-border bg-background px-2 py-1 text-center text-sm" />
        <span className={cn('flex-1 text-right', decided && !homeWon && 'font-semibold text-brand')}>{m.awayUsername}</span>
      </div>
      {!disabled && (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={() => run(() => A.recordTournamentScoreAction(m.id, Number(home), Number(away)))} disabled={home === '' || away === ''}>
            {decided ? 'Update result' : 'Save result'}
          </Button>
          {decided && <Button size="sm" variant="ghost" onClick={() => run(() => A.undoTournamentResultAction(m.id))}>Undo</Button>}
          {decided && <Badge variant={m.verification === 'VERIFIED' ? 'gold' : 'muted'}>{m.verification === 'VERIFIED' ? 'advanced' : 'recorded'}</Badge>}
        </div>
      )}
      {m.note && <p className="mt-1 text-xs text-muted-foreground">{m.note}</p>}
    </div>
  )
}

// --------------------------------------------------------------------------- Settings

function FlairSettings({ data, run }: { data: TournamentWorkspaceData; run: Run }) {
  const t = data.tournament
  const [flair, setFlair] = useState<FlairValue>({ description: t.description, badge: t.badge })
  return (
    <section>
      <p className="eyebrow mb-3 text-muted-foreground">Flair</p>
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <FlairEditor value={flair} onChange={setFlair} />
        <div className="space-y-3">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>
          <FlairPreview value={flair} name={t.name} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run(() => A.updateTournamentFlairAction(t.id, flair))}>Save flair</Button>
            <Button size="sm" variant="ghost" onClick={() => run(() => A.saveFlairDefaultAction(flair))}>Save as my default</Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function SettingsTab({ data, run, canManage }: { data: TournamentWorkspaceData; run: Run; canManage: boolean; isOwner: boolean }) {
  const router = useRouter()
  const [race, setRace] = useState(data.tournament.raceLength)
  const [delCode, setDelCode] = useState('')
  const [deleting, startDelete] = useTransition()
  const [delError, setDelError] = useState<string | null>(null)

  const deleteTournament = () => {
    setDelError(null)
    startDelete(async () => {
      const r = await A.deleteTournamentAction(data.tournament.id, delCode)
      if (r.error) return setDelError(r.error)
      router.push("/tournaments") // the tournament no longer exists — leave the workspace
      router.refresh()
    })
  }
  return (
    <div className="space-y-6">
      {canManage && !data.isHistorical && (
        <section>
          <p className="eyebrow mb-2 text-muted-foreground">Match format</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted-foreground">Race to</label>
            <input
              type="number"
              min={1}
              value={race}
              onChange={(e) => setRace(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <Button size="sm" variant="secondary" onClick={() => run(() => A.setTournamentRaceLengthAction(data.tournament.id, race))} disabled={race === data.tournament.raceLength}>
              Save race length
            </Button>
            <span className="text-xs text-muted-foreground">Games to win a match — used by score validation everywhere.</span>
          </div>
        </section>
      )}

      {canManage && !data.isHistorical && <FlairSettings data={data} run={run} />}

      {canManage && !data.isHistorical && (
        <section>
          <p className="eyebrow mb-2 text-muted-foreground">Lifecycle</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => run(() => A.completeTournamentAction(data.tournament.id))}>Mark complete</Button>
            {data.tournament.archivedAt ? (
              <Button variant="secondary" onClick={() => run(() => A.unarchiveTournamentAction(data.tournament.id))}>Unarchive</Button>
            ) : (
              <Button variant="ghost" onClick={() => run(() => A.archiveTournamentAction(data.tournament.id))}>Archive</Button>
            )}
          </div>
        </section>
      )}

      <section>
        <p className="eyebrow mb-2 text-muted-foreground">Identity</p>
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2"><dt className="w-32 text-muted-foreground">Code</dt><dd>{data.tournament.code}</dd></div>
          <div className="flex gap-2"><dt className="w-32 text-muted-foreground">Tournament number</dt><dd>{data.tournament.number}</dd></div>
          <div className="flex gap-2"><dt className="w-32 text-muted-foreground">Format</dt><dd>{data.tournament.formatBadge} · {(data.tournament.tournamentFormat ?? '').replace(/_/g, ' ').toLowerCase()}</dd></div>
        </dl>
      </section>

      {canManage && !data.isHistorical && data.tournament.lifecycleState !== 'COMPLETED' && data.tournament.lifecycleState !== 'CANCELLED' && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-4">
          <p className="text-sm font-semibold text-foreground">Cancel tournament</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cancel this tournament. It becomes read-only and cannot be resumed except by an Owner recovery. History is preserved (use Delete below to remove it entirely).
          </p>
          <Button
            className="mt-3"
            variant="destructive"
            onClick={() => { if (window.confirm('Cancel this tournament? This is terminal (Owner recovery only).')) run(() => A.setTournamentStateAction(data.tournament.id, 'CANCELLED', 'Cancelled from Settings')) }}
          >
            Cancel tournament
          </Button>
        </section>
      )}

      {canManage && !data.isHistorical && (
        <section className="rounded-lg border border-destructive/30 bg-destructive/[0.05] p-4">
          <p className="text-sm font-semibold text-destructive">Danger zone</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Permanently delete this tournament and everything under it (entrants, teams, bracket, results). This cannot be undone. To archive
            instead (keeps the record), use the Lifecycle controls above.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={delCode}
              onChange={(e) => setDelCode(e.target.value)}
              placeholder={`Type ${data.tournament.code} to confirm`}
              className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <Button variant="destructive" onClick={deleteTournament} disabled={deleting || delCode.trim() !== (data.tournament.code ?? '')}>
              {deleting ? 'Deleting…' : 'Delete cup permanently'}
            </Button>
          </div>
          {delError && <p className="mt-2 text-sm text-destructive">{delError}</p>}
        </section>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------- Group Stage

function GroupsTab({ data, run, canEditResults }: { data: TournamentWorkspaceData; run: Run; canEditResults: boolean }) {
  if (data.groups.length === 0) {
    return <p className="text-sm text-muted-foreground">Groups haven&apos;t been generated yet. Close registration, then Start Group Stage.</p>
  }
  return (
    <div className="space-y-8">
      <p className="text-xs text-muted-foreground">
        Round-robin groups. Enter every match result; standings update automatically. The
        <span className="mx-1 rounded bg-brand/15 px-1.5 py-0.5 text-brand">highlighted</span>
        rows are the current qualifying positions. Once every match is decided, confirm qualifiers from the Overview.
      </p>
      {data.groups.map((g) => (
        <div key={g.id} className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-card/40 px-4 py-2 text-sm font-semibold">{g.name}</div>

          {/* Standings */}
          <div className="overflow-x-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 py-1">#</th>
                  <th className="py-1">Player</th>
                  <th className="w-10 py-1 text-center">P</th>
                  <th className="w-10 py-1 text-center">W</th>
                  <th className="w-10 py-1 text-center">L</th>
                  <th className="w-14 py-1 text-center" title="Game differential">+/−</th>
                  <th className="w-12 py-1 text-center">Pts</th>
                </tr>
              </thead>
              <tbody>
                {g.standings.length === 0 ? (
                  <tr><td colSpan={7} className="py-2 text-muted-foreground">No results yet.</td></tr>
                ) : (
                  g.standings.map((s) => (
                    <tr key={s.registrationId} className={cn('border-t border-border/60', s.qualified && 'bg-brand/10')}>
                      <td className="py-1.5 tabular">{s.rank}</td>
                      <td className={cn('py-1.5', s.qualified && 'font-medium text-brand')}>{s.username}</td>
                      <td className="py-1.5 text-center tabular">{s.played}</td>
                      <td className="py-1.5 text-center tabular">{s.wins}</td>
                      <td className="py-1.5 text-center tabular">{s.losses}</td>
                      <td className="py-1.5 text-center tabular">{s.gameDiff > 0 ? `+${s.gameDiff}` : s.gameDiff}</td>
                      <td className="py-1.5 text-center tabular font-medium">{s.points}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Round-robin schedule + result entry */}
          <div className="border-t border-border p-4">
            <p className="eyebrow mb-2 text-muted-foreground">Round-robin schedule</p>
            <div className="space-y-1.5">
              {g.matches.map((m) => (
                <GroupMatchRow key={m.id} m={m} raceLength={data.tournament.raceLength} run={run} disabled={!canEditResults} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function GroupMatchRow({
  m,
  raceLength,
  run,
  disabled,
}: {
  m: import('@/lib/tournaments/live').WorkspaceGroupMatch
  raceLength: number
  run: Run
  disabled: boolean
}) {
  const decided = m.winnerRegistrationId != null
  const [home, setHome] = useState<string>(m.homeGames != null ? String(m.homeGames) : '')
  const [away, setAway] = useState<string>(m.awayGames != null ? String(m.awayGames) : '')
  const [editing, setEditing] = useState(false)

  const save = () => {
    const h = Number(home)
    const a = Number(away)
    if (!Number.isFinite(h) || !Number.isFinite(a)) return
    run(() => import('@/lib/competition/tournament-actions').then((A) => A.recordGroupResultAction(m.id, h, a)))
    setEditing(false)
  }

  const homeWon = m.winnerRegistrationId === m.homeRegistrationId
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-1.5 text-sm">
      <span className={cn('min-w-0 flex-1 truncate text-right', decided && homeWon && 'font-semibold text-brand')}>{m.homeUsername}</span>
      {decided && !editing ? (
        <span className="tabular px-2 font-medium">{m.homeGames}–{m.awayGames}</span>
      ) : (
        <span className="flex items-center gap-1">
          <input value={home} onChange={(e) => setHome(e.target.value)} inputMode="numeric" className="w-12 rounded border border-border bg-background px-2 py-1 text-center tabular" placeholder="0" disabled={disabled} />
          <span className="text-muted-foreground">–</span>
          <input value={away} onChange={(e) => setAway(e.target.value)} inputMode="numeric" className="w-12 rounded border border-border bg-background px-2 py-1 text-center tabular" placeholder="0" disabled={disabled} />
        </span>
      )}
      <span className={cn('min-w-0 flex-1 truncate', decided && !homeWon && 'font-semibold text-brand')}>{m.awayUsername}</span>
      {!disabled && (
        decided && !editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={save} disabled={home === '' || away === ''}>Save</Button>
        )
      )}
      <span className="w-16 text-right text-[0.65rem] text-muted-foreground">race to {raceLength}</span>
    </div>
  )
}

// --------------------------------------------------------------------------- Swiss

function SwissTab({ data, run, canEditResults, canManage }: { data: TournamentWorkspaceData; run: Run; canEditResults: boolean; canManage: boolean }) {
  const s = data.swiss
  if (!s || s.currentRound === 0) {
    return <p className="text-sm text-muted-foreground">The Swiss rounds haven&apos;t started yet. Close registration, then Start Swiss.</p>
  }
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          Round <b className="text-foreground">{s.currentRound}</b> of <b className="text-foreground">{s.totalRounds}</b>. Enter every result; standings and the next round&apos;s pairings update automatically.
        </p>
        <div className="ml-auto flex gap-2">
          {canManage && s.canPairNext && (
            <Button size="sm" onClick={() => run(() => A.pairSwissRoundAction(data.tournament.id))}>Pair round {s.currentRound + 1}</Button>
          )}
          {canManage && s.canComplete && (
            <Button size="sm" onClick={() => run(() => A.completeSwissAction(data.tournament.id))}>Complete Swiss</Button>
          )}
        </div>
      </div>

      {/* Standings */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border bg-card/40 px-4 py-2 text-sm font-semibold">Standings</div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-8 py-1">#</th>
                <th className="py-1">Player</th>
                <th className="w-12 py-1 text-center" title="Match points">Pts</th>
                <th className="w-10 py-1 text-center" title="Matches played">P</th>
                <th className="w-14 py-1 text-center" title="Game differential">+/−</th>
                <th className="w-14 py-1 text-center" title="Buchholz tiebreak">Buch</th>
                <th className="w-10 py-1 text-center" title="Byes">Bye</th>
              </tr>
            </thead>
            <tbody>
              {s.standings.map((r) => (
                <tr key={r.registrationId} className={cn('border-t border-border/60', r.rank === 1 && 'bg-brand/10')}>
                  <td className="py-1.5 tabular">{r.rank}</td>
                  <td className={cn('py-1.5', r.rank === 1 && 'font-medium text-brand')}>{r.name}</td>
                  <td className="py-1.5 text-center tabular font-medium">{r.points}</td>
                  <td className="py-1.5 text-center tabular">{r.played}</td>
                  <td className="py-1.5 text-center tabular">{r.gameW - r.gameL > 0 ? `+${r.gameW - r.gameL}` : r.gameW - r.gameL}</td>
                  <td className="py-1.5 text-center tabular">{r.buchholz}</td>
                  <td className="py-1.5 text-center tabular">{r.byes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rounds */}
      {[...s.rounds].reverse().map((rd) => (
        <div key={rd.round} className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-card/40 px-4 py-2 text-sm font-semibold">Round {rd.round}</div>
          <div className="space-y-1.5 p-4">
            {rd.matches.map((m) => (
              <SwissMatchRow key={m.id} m={m} raceLength={data.tournament.raceLength} run={run} disabled={!canEditResults} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SwissMatchRow({ m, raceLength, run, disabled }: { m: NonNullable<TournamentWorkspaceData['swiss']>['rounds'][number]['matches'][number]; raceLength: number; run: Run; disabled: boolean }) {
  const decided = m.winnerRegistrationId != null
  const [home, setHome] = useState<string>(m.homeGames != null ? String(m.homeGames) : '')
  const [away, setAway] = useState<string>(m.awayGames != null ? String(m.awayGames) : '')
  const [editing, setEditing] = useState(false)

  if (m.isBye) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium text-brand">{m.homeName}</span>
        <span className="rounded bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">Bye</span>
        <span className="min-w-0 flex-1" />
      </div>
    )
  }

  const save = () => {
    const h = Number(home), a = Number(away)
    if (!Number.isFinite(h) || !Number.isFinite(a)) return
    run(() => A.recordSwissResultAction(m.id, h, a))
    setEditing(false)
  }
  const homeWon = m.winnerRegistrationId === m.homeRegistrationId
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-1.5 text-sm">
      <span className={cn('min-w-0 flex-1 truncate text-right', decided && homeWon && 'font-semibold text-brand')}>{m.homeName}</span>
      {decided && !editing ? (
        <span className="tabular px-2 font-medium">{m.homeGames}–{m.awayGames}</span>
      ) : (
        <span className="flex items-center gap-1">
          <input value={home} onChange={(e) => setHome(e.target.value)} inputMode="numeric" className="w-12 rounded border border-border bg-background px-2 py-1 text-center tabular" placeholder="0" disabled={disabled} />
          <span className="text-muted-foreground">–</span>
          <input value={away} onChange={(e) => setAway(e.target.value)} inputMode="numeric" className="w-12 rounded border border-border bg-background px-2 py-1 text-center tabular" placeholder="0" disabled={disabled} />
        </span>
      )}
      <span className={cn('min-w-0 flex-1 truncate', decided && !homeWon && 'font-semibold text-brand')}>{m.awayName}</span>
      {!disabled && (decided && !editing ? (
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
      ) : (
        <Button size="sm" variant="outline" onClick={save} disabled={home === '' || away === ''}>Save</Button>
      ))}
      <span className="w-16 text-right text-[0.65rem] text-muted-foreground">race to {raceLength}</span>
    </div>
  )
}
