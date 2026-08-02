'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy, Users, GitBranch, ListChecks, Settings2, Plus, X, ChevronUp, ChevronDown, GripVertical, RotateCcw } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bracket } from '@/components/cups/bracket'
import type { CupWorkspaceData, PlayoffRow } from '@/lib/cups/live'
import * as A from '@/lib/competition/cup-actions'

type Tab = 'overview' | 'roster' | 'bracket' | 'results' | 'settings'
type ActionResp = { ok?: boolean; error?: string; message?: string } | void
type Run = (fn: () => Promise<ActionResp>) => void

export function CupWorkspace({
  data,
  canManage,
  canEditResults,
  isOwner,
}: {
  data: CupWorkspaceData
  canManage: boolean
  canEditResults: boolean
  isOwner: boolean
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
    { id: 'bracket', label: 'Bracket', icon: GitBranch },
    { id: 'results', label: 'Results', icon: ListChecks },
    { id: 'settings', label: 'Settings', icon: Settings2 },
  ]

  return (
    <div className="mt-6 rounded-xl border border-gold/30 bg-card/40">
      {/* Admin toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Badge variant="gold">Admin</Badge>
        <span className="text-sm font-medium text-foreground">Competition workspace</span>
        <span className="text-xs text-muted-foreground">
          {data.season.competitionCode} · {data.isTeam ? `${data.season.teamSize ?? 2}-player teams` : 'Individual'} ·{' '}
          {(data.season.tournamentFormat ?? 'SINGLE_ELIM').replace(/_/g, ' ').toLowerCase()}
        </span>
        {data.season.locked && <Badge variant="destructive">Locked</Badge>}
        {pending && <span className="ml-auto text-xs text-muted-foreground">Working…</span>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.id ? 'bg-gold/15 text-gold' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div className={cn('mx-4 mt-3 rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-gold/30 bg-gold/[0.06] text-foreground' : 'border-destructive/40 bg-destructive/[0.06] text-destructive')}>
          {msg.text}
        </div>
      )}

      <div className="p-4">
        {tab === 'overview' && <Overview data={data} />}
        {tab === 'roster' && (data.isTeam ? <TeamsTab data={data} run={run} disabled={!canManage || data.isHistorical} /> : <EntrantsTab data={data} run={run} disabled={!canManage || data.isHistorical} />)}
        {tab === 'bracket' && <BracketTab data={data} run={run} disabled={!canManage || data.isHistorical} />}
        {tab === 'results' && <ResultsTab data={data} run={run} disabled={!canEditResults || data.isHistorical} />}
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

function Overview({ data }: { data: CupWorkspaceData }) {
  const rosterCount = data.isTeam ? data.teams.filter((t) => !t.withdrawn).length : data.entrants.filter((e) => !e.withdrawn).length
  const played = data.matches.filter((m) => m.winnerRegistrationId != null).length
  const playable = data.matches.filter((m) => m.homeUsername && m.awayUsername).length
  const bracketState = data.hasPublishedBracket ? 'Published' : data.hasBracket ? 'Draft' : 'Not built'
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard label="Status" value={data.season.seasonStatus.toLowerCase()} hint={data.season.cupStatus ?? undefined} />
      <StatCard label={data.isTeam ? 'Teams' : 'Entrants'} value={String(rosterCount)} />
      <StatCard label="Bracket" value={bracketState} hint={data.hasBracket ? `${data.matches.length} matches` : undefined} />
      <StatCard label="Results" value={`${played}/${playable}`} hint="matches decided" />
      <StatCard label="Game" value={data.season.gameType ?? '—'} />
      <StatCard label="Registration" value={data.season.registrationStatus.replace('_', ' ').toLowerCase()} />
    </div>
  )
}

// --------------------------------------------------------------------------- Entrants (individual)

function EntrantsTab({ data, run, disabled }: { data: CupWorkspaceData; run: Run; disabled: boolean }) {
  const [q, setQ] = useState('')
  const [candidates, setCandidates] = useState<A.EntrantCandidate[]>([])
  const [manual, setManual] = useState('')
  const [searching, startSearch] = useTransition()
  const seasonId = data.season.id

  const search = (value: string) => {
    setQ(value)
    if (value.trim().length < 2) return setCandidates([])
    startSearch(async () => setCandidates(await A.searchCupPlayersAction(seasonId, value.trim())))
  }

  return (
    <div className="space-y-5">
      {!disabled && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="eyebrow text-muted-foreground">Add existing player</label>
            <input
              value={q}
              onChange={(e) => search(e.target.value)}
              placeholder="Search player profiles…"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            {searching && <p className="mt-1 text-xs text-muted-foreground">Searching…</p>}
            {candidates.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-1">
                {candidates.map((c) => (
                  <li key={c.playerId}>
                    <button
                      disabled={c.alreadyEntered}
                      onClick={() => run(async () => { const r = await A.addCupEntrantsAction(seasonId, [c.playerId]); setQ(''); setCandidates([]); return r })}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40"
                    >
                      <span>{c.primaryName}{c.cueverseId && <span className="ml-1 text-xs text-muted-foreground">{c.cueverseId}</span>}</span>
                      {c.alreadyEntered && <span className="text-xs text-muted-foreground">added</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="eyebrow text-muted-foreground">Add temporary entrant</label>
            <div className="mt-1 flex gap-2">
              <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Display name" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
              <Button onClick={() => run(async () => { const r = await A.addManualEntrantAction(seasonId, manual); setManual(''); return r })} disabled={!manual.trim()}>
                <Plus className="size-4" /> Add
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Unlinked name for testing/placeholder — replace with a real profile anytime.</p>
          </div>
        </div>
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
                  <button onClick={() => run(() => A.restoreCupEntrantAction(data.season.id, e.registrationId))} className="text-xs text-muted-foreground hover:text-gold">restore</button>
                ) : (
                  <button onClick={() => run(() => A.removeCupEntrantAction(data.season.id, e.registrationId))} className="text-muted-foreground hover:text-destructive"><X className="size-4" /></button>
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

function TeamsTab({ data, run, disabled }: { data: CupWorkspaceData; run: Run; disabled: boolean }) {
  const [newTeam, setNewTeam] = useState('')
  return (
    <div className="space-y-5">
      {!disabled && (
        <div className="flex gap-2">
          <input value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="New team name" className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <Button onClick={() => run(async () => { const r = await A.createTeamAction(data.season.id, newTeam); setNewTeam(''); return r })} disabled={!newTeam.trim()}>
            <Plus className="size-4" /> Create team
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {data.teams.map((t) => (
          <TeamCard key={t.id} team={t} teamSize={data.season.teamSize ?? 2} run={run} disabled={disabled} />
        ))}
        {data.teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
      </div>
    </div>
  )
}

function TeamCard({ team, teamSize, run, disabled }: { team: CupWorkspaceData['teams'][number]; teamSize: number; run: Run; disabled: boolean }) {
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
        <button onClick={() => run(() => A.renameTeamAction(team.id, name))} className="mt-1 text-xs text-gold hover:underline">Save name</button>
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

function BracketTab({ data, run, disabled }: { data: CupWorkspaceData; run: Run; disabled: boolean }) {
  // Seedable pool: teams (team cups) or entrants (individual), non-withdrawn.
  const pool = data.isTeam
    ? data.teams.filter((t) => !t.withdrawn).map((t) => ({ id: t.registrationId, name: t.name }))
    : data.entrants.filter((e) => !e.withdrawn).map((e) => ({ id: e.registrationId, name: e.name }))
  const poolKey = pool.map((p) => p.id).join(',') // reset the seed builder when the pool changes

  return (
    <div className="space-y-6">
      {!disabled && <SeedBuilder key={poolKey} data={data} pool={pool} run={run} />}
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
function SeedBuilder({ data, pool, run }: { data: CupWorkspaceData; pool: { id: number; name: string }[]; run: Run }) {
  const [order, setOrder] = useState<number[]>(() => pool.map((p) => p.id))
  const nameById = useMemo(() => new Map(pool.map((p) => [p.id, p.name])), [pool])
  const dragIndex = useRef<number | null>(null)
  const published = data.hasPublishedBracket

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return
    setOrder((o) => { const n = [...o]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="eyebrow text-muted-foreground">Seed order ({order.length})</p>
        {published ? <Badge variant="gold">Published</Badge> : data.hasBracket ? <Badge variant="muted">Draft</Badge> : null}
      </div>
      <ol className="mt-2 max-w-md space-y-1">
        {order.map((id, i) => (
          <li
            key={id}
            draggable={!published}
            onDragStart={() => (dragIndex.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragIndex.current != null) move(dragIndex.current, i); dragIndex.current = null }}
            className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1.5 text-sm"
          >
            <GripVertical className="size-4 shrink-0 text-muted-foreground" />
            <span className="tabular w-5 text-right text-xs text-muted-foreground">{i + 1}</span>
            <span className="flex-1 truncate">{nameById.get(id)}</span>
            {!published && (
              <span className="flex gap-0.5">
                <button onClick={() => move(i, i - 1)} className="text-muted-foreground hover:text-gold"><ChevronUp className="size-4" /></button>
                <button onClick={() => move(i, i + 1)} className="text-muted-foreground hover:text-gold"><ChevronDown className="size-4" /></button>
              </span>
            )}
          </li>
        ))}
        {order.length === 0 && <li className="text-sm text-muted-foreground">Add {data.isTeam ? 'teams' : 'entrants'} first.</li>}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        {!published && (
          <Button onClick={() => run(() => A.buildCupBracketAction(data.season.id, order))} disabled={order.length < 2}>
            {data.hasBracket ? 'Rebuild draft bracket' : 'Build draft bracket'}
          </Button>
        )}
        {data.hasBracket && !published && <Button onClick={() => run(() => A.publishCupBracketAction(data.season.id))}>Publish bracket</Button>}
        {published && <Button variant="secondary" onClick={() => run(() => A.returnCupBracketToDraftAction(data.season.id))}><RotateCcw className="size-4" /> Return to draft</Button>}
        {data.hasBracket && !published && <Button variant="ghost" onClick={() => run(() => A.deleteCupBracketAction(data.season.id))}>Delete bracket</Button>}
      </div>
      {order.length > 2 && <p className="mt-2 text-xs text-muted-foreground">Bracket auto-sizes to the next power of two; empty slots become byes.</p>}
    </div>
  )
}

// --------------------------------------------------------------------------- Results

function ResultsTab({ data, run, disabled }: { data: CupWorkspaceData; run: Run; disabled: boolean }) {
  const playable = data.matches.filter((m) => m.homeUsername && m.awayUsername)
  return (
    <div className="space-y-3">
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
        <span className={cn('flex-1', homeWon && 'font-semibold text-gold')}>{m.homeUsername}</span>
        <input value={home} onChange={(e) => setHome(e.target.value)} disabled={disabled} inputMode="numeric" className="w-12 rounded border border-border bg-background px-2 py-1 text-center text-sm" />
        <span className="text-muted-foreground">–</span>
        <input value={away} onChange={(e) => setAway(e.target.value)} disabled={disabled} inputMode="numeric" className="w-12 rounded border border-border bg-background px-2 py-1 text-center text-sm" />
        <span className={cn('flex-1 text-right', decided && !homeWon && 'font-semibold text-gold')}>{m.awayUsername}</span>
      </div>
      {!disabled && (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={() => run(() => A.recordCupScoreAction(m.id, Number(home), Number(away)))} disabled={home === '' || away === ''}>
            {decided ? 'Update result' : 'Save result'}
          </Button>
          {decided && <Button size="sm" variant="ghost" onClick={() => run(() => A.undoCupResultAction(m.id))}>Undo</Button>}
          {decided && <Badge variant={m.verification === 'VERIFIED' ? 'gold' : 'muted'}>{m.verification === 'VERIFIED' ? 'advanced' : 'recorded'}</Badge>}
        </div>
      )}
      {m.note && <p className="mt-1 text-xs text-muted-foreground">{m.note}</p>}
    </div>
  )
}

// --------------------------------------------------------------------------- Settings

function SettingsTab({ data, run, canManage, isOwner }: { data: CupWorkspaceData; run: Run; canManage: boolean; isOwner: boolean }) {
  const [code, setCode] = useState('')
  const [reason, setReason] = useState('')
  return (
    <div className="space-y-6">
      {canManage && !data.isHistorical && (
        <section>
          <p className="eyebrow mb-2 text-muted-foreground">Lifecycle</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => run(() => A.completeCupAction(data.season.id))}>Mark complete</Button>
            {data.season.archivedAt ? (
              <Button variant="secondary" onClick={() => run(() => A.unarchiveCupAction(data.season.id))}>Unarchive</Button>
            ) : (
              <Button variant="ghost" onClick={() => run(() => A.archiveCupAction(data.season.id))}>Archive</Button>
            )}
          </div>
        </section>
      )}

      {data.isHistorical && (
        <section className="rounded-lg border border-destructive/30 bg-destructive/[0.05] p-4">
          <p className="text-sm font-semibold text-foreground">Historical competition — locked</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Imported historical cups are read-only to protect the record. {isOwner ? 'As Owner you may unlock it for correction.' : 'Only the Owner can unlock it.'}
          </p>
          {isOwner && data.season.locked && (
            <div className="mt-3 space-y-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={`Type ${data.season.competitionCode} to confirm`} className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm" />
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
              <Button variant="destructive" onClick={() => run(() => A.unlockHistoricalCupAction(data.season.id, code, reason))} disabled={!code.trim() || !reason.trim()}>Unlock historical cup</Button>
            </div>
          )}
          {isOwner && !data.season.locked && data.season.importedFromFixture && (
            <Button className="mt-3" variant="secondary" onClick={() => run(() => A.relockHistoricalCupAction(data.season.id))}>Re-lock competition</Button>
          )}
        </section>
      )}

      <section>
        <p className="eyebrow mb-2 text-muted-foreground">Identity</p>
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2"><dt className="w-32 text-muted-foreground">Code</dt><dd>{data.season.competitionCode}</dd></div>
          <div className="flex gap-2"><dt className="w-32 text-muted-foreground">Cup number</dt><dd>{data.season.cupNumber}</dd></div>
          <div className="flex gap-2"><dt className="w-32 text-muted-foreground">Format</dt><dd>{data.season.formatBadge} · {(data.season.tournamentFormat ?? '').replace(/_/g, ' ').toLowerCase()}</dd></div>
        </dl>
      </section>
    </div>
  )
}
