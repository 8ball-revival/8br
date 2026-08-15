'use client'

import { useState, useMemo, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Plus, Wand2, Scale, Trophy, GripVertical, AlertTriangle, CheckCircle2, X, Loader2, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import * as A from '@/lib/competition/tournament-actions'

// Local, client-safe shapes (structurally compatible with live.ts — not imported to keep the
// server-only module out of this client bundle).
interface Entrant { registrationId: number; name: string; cueverseId: string | null }
interface GroupSetup {
  isTeam: boolean
  entrants: Entrant[]
  unassignedIds: number[]
  totalEntrants: number
  numGroups: number
  targetPerGroup: number
  minGroupSize: number
  assignedCount: number
  unassignedCount: number
  totalMatches: number
  perGroup: { id: number; name: string; count: number; overTarget: boolean; underMin: boolean }[]
  issues: { code: string; message: string }[]
  canPublish: boolean
}
interface BoardGroup { id: number; name: string; playerIds: number[] }

type ActionResult = { ok?: boolean; error?: string; message?: string }
const UNASSIGNED = 'unassigned'
type ColKey = number | typeof UNASSIGNED

/**
 * Group Setup board — the private, pre-publish draft workspace for a Group Stage + Playoffs tournament.
 * Every entrant (individual, or a whole team) is one movable card; the Admin organizes Unassigned +
 * group columns via drag-and-drop OR an accessible "Move to" menu, then publishes to generate the
 * round-robin + standings and start the Group Stage. Every move persists immediately (the DB is the
 * draft store), so there are no unsaved changes to lose.
 */
export function GroupSetupBoard({ tournamentId, setup, groups }: { tournamentId: number; setup: GroupSetup; groups: BoardGroup[] }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [status, setStatus] = useState<{ ok?: boolean; text: string } | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overCol, setOverCol] = useState<ColKey | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [renaming, setRenaming] = useState<number | null>(null)

  const entrantById = useMemo(() => new Map(setup.entrants.map((e) => [e.registrationId, e])), [setup.entrants])

  const act = (fn: () => Promise<ActionResult>) => {
    setStatus(null)
    start(async () => {
      const r = await fn()
      if (r.error) setStatus({ text: r.error })
      else { setStatus({ ok: true, text: r.message ?? 'Saved.' }); router.refresh() }
    })
  }
  const moveTo = (regId: number, col: ColKey) => act(() => A.moveGroupEntrantAction(tournamentId, regId, col === UNASSIGNED ? null : col))
  const publish = () => { setConfirming(false); act(() => A.publishGroupsAndStartAction(tournamentId)) }

  const onDrop = (col: ColKey) => { if (dragId != null) moveTo(dragId, col); setDragId(null); setOverCol(null) }

  // Entrant card — draggable + an accessible Move-to menu for keyboard/touch users. A render function
  // (not a nested component) so it isn't re-created as a component every render.
  const cardEl = (regId: number, currentCol: ColKey) => {
    const e = entrantById.get(regId)
    if (!e) return null
    return (
      <li
        key={regId}
        draggable={!pending}
        onDragStart={() => setDragId(regId)}
        onDragEnd={() => { setDragId(null); setOverCol(null) }}
        className={cn(
          'group flex items-center gap-2 rounded-md border border-border bg-background/70 px-2 py-1.5 text-sm',
          dragId === regId && 'opacity-50',
          !pending && 'cursor-grab active:cursor-grabbing',
        )}
      >
        <GripVertical className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{e.name}</span>
          {e.cueverseId && e.cueverseId !== e.name && <span className="block truncate text-[0.7rem] text-muted-foreground">{e.cueverseId}</span>}
        </span>
        <label className="sr-only" htmlFor={`move-${regId}`}>Move {e.name} to…</label>
        <select
          id={`move-${regId}`}
          value={currentCol === UNASSIGNED ? UNASSIGNED : String(currentCol)}
          disabled={pending}
          onChange={(ev) => moveTo(regId, ev.target.value === UNASSIGNED ? UNASSIGNED : Number(ev.target.value))}
          className="max-w-[7rem] shrink-0 rounded border border-input bg-card px-1.5 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Move ${e.name} to a group`}
        >
          <option value={UNASSIGNED}>Unassigned</option>
          {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
        </select>
      </li>
    )
  }

  const columnEl = (col: ColKey, title: ReactNode, ids: number[]) => (
    <div
      key={col === UNASSIGNED ? 'unassigned' : `g${col}`}
      onDragOver={(ev) => { ev.preventDefault(); if (overCol !== col) setOverCol(col) }}
      onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
      onDrop={() => onDrop(col)}
      className={cn(
        'flex w-64 shrink-0 flex-col rounded-lg border bg-card/40 transition-colors',
        overCol === col && dragId != null ? 'border-brand ring-2 ring-brand/40' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">{title}</div>
      <ul className="flex min-h-[3rem] flex-1 flex-col gap-1.5 p-2">
        {ids.length === 0 && <li className="rounded-md border border-dashed border-border/60 px-2 py-3 text-center text-xs text-muted-foreground">Drop entrants here</li>}
        {ids.map((id) => cardEl(id, col))}
      </ul>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Distribution summary */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card/40 p-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Entrants" value={setup.totalEntrants} />
        <Stat label="Groups" value={setup.numGroups} />
        <Stat label="Target / group" value={`~${setup.targetPerGroup}`} />
        <Stat label="Assigned" value={setup.assignedCount} />
        <Stat label="Unassigned" value={setup.unassignedCount} tone={setup.unassignedCount > 0 ? 'warn' : undefined} />
        <Stat label="Over/under" value={setup.perGroup.filter((g) => g.overTarget || g.underMin).length} tone={setup.perGroup.some((g) => g.overTarget || g.underMin) ? 'warn' : undefined} />
        <Stat label="Matches" value={setup.totalMatches} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => A.autoAssignGroupsAction(tournamentId))}><Wand2 className="size-4" /> Auto-assign</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => A.autoBalanceGroupsAction(tournamentId))}><Scale className="size-4" /> Auto-balance</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => A.addDraftGroupAction(tournamentId))}><Plus className="size-4" /> Add group</Button>
        <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          Target / group
          <input
            type="number"
            min={setup.minGroupSize}
            defaultValue={setup.targetPerGroup}
            disabled={pending}
            onBlur={(ev) => { const v = Number(ev.target.value); if (Number.isInteger(v) && v >= setup.minGroupSize && v !== setup.targetPerGroup) act(() => A.setGroupTargetAction(tournamentId, v)) }}
            className="w-16 rounded-md border border-input bg-card px-2 py-1 text-sm text-foreground tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="ml-auto flex items-center gap-2">
          {pending && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Saving…</span>}
          {!pending && status?.ok && <span className="inline-flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3.5" /> Saved</span>}
          <Button size="sm" disabled={pending || !setup.canPublish} onClick={() => setConfirming(true)} title={setup.canPublish ? undefined : 'Resolve the issues below first'}>
            <Trophy className="size-4" /> Publish Groups &amp; Start
          </Button>
        </div>
      </div>

      {status && !status.ok && <p role="alert" className="text-sm text-destructive">{status.text}</p>}

      {/* Validation issues */}
      {setup.issues.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warning/30 bg-warning/[0.06] p-3 text-sm text-warning">
          {setup.issues.map((i, n) => (
            <li key={n} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {i.message}</li>
          ))}
        </ul>
      )}

      {/* Board: Unassigned + one column per group. Horizontal scroll on desktop; wraps/stacks on mobile. */}
      <div className="flex snap-x gap-3 overflow-x-auto pb-2 scrollbar-brand">
        {columnEl(
          UNASSIGNED,
          <><Users className="size-4 text-muted-foreground" aria-hidden /><span className="font-semibold">Unassigned</span><Badge variant="muted" className="ml-auto">{setup.unassignedCount}</Badge></>,
          setup.unassignedIds,
        )}
        {groups.map((g) => {
          const meta = setup.perGroup.find((p) => p.id === g.id)
          const count = meta?.count ?? g.playerIds.length
          return columnEl(
            g.id,
            (
              <>
                  {renaming === g.id ? (
                    <input
                      autoFocus
                      defaultValue={g.name}
                      disabled={pending}
                      onBlur={(ev) => { const v = ev.target.value.trim(); setRenaming(null); if (v && v !== g.name) act(() => A.renameDraftGroupAction(tournamentId, g.id, v)) }}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') setRenaming(null) }}
                      className="w-28 rounded border border-input bg-background px-1.5 py-0.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  ) : (
                    <button type="button" className="font-semibold text-foreground hover:text-brand" onClick={() => setRenaming(g.id)} title="Rename group">{g.name}</button>
                  )}
                  <Badge variant={meta?.underMin ? 'destructive' : meta?.overTarget ? 'muted' : 'default'} className="ml-auto tabular">{count}/{setup.targetPerGroup}</Badge>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Remove ${g.name}`}
                    onClick={async () => {
                      const names = g.playerIds.map((id) => entrantById.get(id)?.name).filter(Boolean)
                      const msg = names.length ? `Remove ${g.name}? These entrants return to Unassigned:\n\n${names.join(', ')}` : `Remove ${g.name}?`
                      const res = await confirm({ title: `Remove ${g.name}?`, message: msg, confirmLabel: 'Remove group', tone: 'danger' }); if (res.confirmed) act(() => A.removeDraftGroupAction(tournamentId, g.id))
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-4" />
                  </button>
                </>
            ),
            g.playerIds,
          )
        })}
      </div>

      {/* Publish confirmation */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="publish-title" onClick={() => setConfirming(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 scrollbar-brand" onClick={(ev) => ev.stopPropagation()}>
            <h2 id="publish-title" className="font-display text-lg font-bold">Publish groups &amp; start the Group Stage?</h2>
            <p className="mt-1 text-sm text-muted-foreground">The assignments below become <span className="font-medium text-foreground">public</span>, {setup.totalMatches} round-robin match{setup.totalMatches === 1 ? '' : 'es'} are generated, and the Group Stage begins. This can only be undone before any result is recorded.</p>
            <ul className="mt-3 space-y-2">
              {groups.map((g) => (
                <li key={g.id} className="rounded-md border border-border bg-background/50 p-2 text-sm">
                  <p className="font-semibold">{g.name} <span className="font-normal text-muted-foreground">· {g.playerIds.length} entrant{g.playerIds.length === 1 ? '' : 's'}</span></p>
                  <p className="text-xs text-muted-foreground">{g.playerIds.map((id) => entrantById.get(id)?.name).filter(Boolean).join(', ') || '—'}</p>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button size="sm" disabled={pending || !setup.canPublish} onClick={publish}><Trophy className="size-4" /> Publish &amp; Start</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' }) {
  return (
    <div>
      <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('tabular text-lg font-semibold', tone === 'warn' ? 'text-warning' : 'text-foreground')}>{value}</p>
    </div>
  )
}
