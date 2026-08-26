'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, RotateCcw, Shuffle, Trash2, Play, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PlayerName } from '@/components/identity/player-name'
import { identityText } from '@/lib/identity/display'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { GroupSetupView, SetupPlayer } from '@/lib/seasons/views'
import {
  generateSeasonGroupsAction, moveSeasonEntrantAction, addSeasonGroupAction, removeSeasonGroupAction,
  renameSeasonGroupAction, resetSeasonGroupsAction, publishSeasonGroupsAction,
  searchSeasonPlayersAction, addSeasonEntrantAction, removeSeasonEntrantAction,
} from '@/lib/seasons/actions'
import { EntrantQuickAdd } from '@/components/competition/entrant-quick-add'
import { AutoAssignPanel } from '@/components/archive/auto-assign-panel'
import type { AutoAssignAvailability } from '@/lib/archive/auto-assign'

/** Private Group Setup board (admin only): rating snake-seeded generation, then drag/dropdown moves,
 *  add/remove/rename/reset, and the Group Stage Live publish once valid. */
export function SeasonGroupSetup({
  seasonId,
  view,
  autoAssign,
}: {
  seasonId: number
  view: GroupSetupView
  /** Decided on the server; absent for a Season with no archive template. */
  autoAssign?: AutoAssignAvailability
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [numGroups, setNumGroups] = useState(Math.max(2, view.groups.length || 4))
  const hasGroups = view.groups.length > 0

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' }); router.refresh() })

  const groupOptions = view.groups.map((g) => ({ id: g.id, label: g.name || `Group ${g.code}` }))

  return (
    <div className="mt-8 space-y-5">
      {msg && <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>}

      <div className="flex flex-wrap items-end gap-3 rounded-none border border-border bg-card/40 p-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-foreground">Number of Groups</label>
          <input type="number" min={1} max={26} value={numGroups} onChange={(e) => setNumGroups(Math.max(1, Math.min(26, Number(e.target.value) || 1)))} className="w-24 rounded-none border border-input bg-card px-3 py-2 text-sm" />
        </div>
        <Button size="sm" disabled={pending} onClick={() => run(() => generateSeasonGroupsAction(seasonId, numGroups))}>
          <Shuffle className="size-4" /> {hasGroups ? 'Regenerate Groups' : 'Generate Groups'}
        </Button>

        {/*
          Auto Assign sits beside Generate Groups because it is the archive's answer to the same
          question: which entrants go in which group. Generate invents an arrangement; this one
          restores the recorded arrangement, and only for entrants already added by hand.
        */}
        {autoAssign?.show && (
          <AutoAssignPanel seasonId={seasonId} mode="groups" disabledReason={autoAssign.disabledReason} />
        )}
        <div className="ml-auto">
          {/* Registration and group building are one screen: a missing player is added here rather
              than by stepping back into a separate registration phase. */}
          <label className="mb-1 block text-xs font-semibold text-foreground">Add entrant</label>
          <EntrantQuickAdd
            disabled={pending}
            search={(q) => searchSeasonPlayersAction(seasonId, q)}
            add={async (playerId) => { const r = await addSeasonEntrantAction(seasonId, playerId); router.refresh(); return r }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-none border border-border bg-card/40 p-4">
        {hasGroups && (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => addSeasonGroupAction(seasonId))}><Plus className="size-4" /> Add Group</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={async () => { const res = await confirm({ title: 'Reset assignments?', message: 'Every entrant returns to the Unassigned pool. The groups themselves remain.', confirmLabel: 'Reset', tone: 'warning', action: async () => resetSeasonGroupsAction(seasonId) }); if (res.confirmed) router.refresh() }}><RotateCcw className="size-4" /> Reset</Button>
          </>
        )}
      </div>

      {hasGroups && (
        <>
          {view.issues.length > 0 && (
            <ul className="rounded-md border border-[var(--gold)]/45 bg-[var(--attention-surface)] px-3 py-2 text-xs text-[var(--gold)]">
              {view.issues.map((i, k) => <li key={k}>• {i.detail}</li>)}
            </ul>
          )}

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Panel title="Unassigned" tone="muted">
              {view.unassigned.length === 0 ? <Empty>All entrants assigned.</Empty> : view.unassigned.map((p) => (
                <PlayerRow key={p.entrantId} p={p} groups={groupOptions} currentGroup={null} onMove={(gid) => run(() => moveSeasonEntrantAction(seasonId, p.entrantId, gid))} onRemove={() => run(() => removeSeasonEntrantAction(seasonId, p.entrantId))} removeTitle="Remove from the Season" />
              ))}
            </Panel>
            {view.groups.map((g) => (
              <Panel
                key={g.id}
                title={g.name || `Group ${g.code}`}
                count={g.players.length}
                onRename={async () => { const res = await confirm({ title: 'Rename group', confirmLabel: 'Rename', input: { label: 'Group name', defaultValue: g.name || `Group ${g.code}` } }); if (res.confirmed) run(() => renameSeasonGroupAction(seasonId, g.id, res.value)) }}
                onDelete={async () => { const res = await confirm({ title: 'Remove group?', message: 'Its players return to the Unassigned pool. Entrants are never deleted.', confirmLabel: 'Remove Group', tone: 'danger', action: async () => removeSeasonGroupAction(seasonId, g.id) }); if (res.confirmed) router.refresh() }}
              >
                {g.players.length === 0 ? <Empty>Drag or move players here.</Empty> : g.players.map((p) => (
                  <PlayerRow key={p.entrantId} p={p} groups={groupOptions} currentGroup={g.id} onMove={(gid) => run(() => moveSeasonEntrantAction(seasonId, p.entrantId, gid))} onRemove={() => run(() => moveSeasonEntrantAction(seasonId, p.entrantId, null))} />
                ))}
              </Panel>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button
              disabled={pending || !view.valid}
              title={view.valid ? undefined : 'Every entrant must be in exactly one valid group.'}
              onClick={async () => { const res = await confirm({ title: 'Make the Group Stage live?', message: 'This publishes the groups, generates the round-robin schedule, and makes group play visible to members.', confirmLabel: 'Group Stage Live', tone: 'warning', action: async () => publishSeasonGroupsAction(seasonId) }); if (res.confirmed) router.refresh() }}
            >
              <Play className="size-4" /> Group Stage Live
            </Button>
            {!view.valid && <span className="text-xs text-muted-foreground">Resolve the warnings above to publish.</span>}
          </div>
        </>
      )}
    </div>
  )
}

function Panel({ title, count, tone, children, onRename, onDelete }: { title: string; count?: number; tone?: 'muted'; children: React.ReactNode; onRename?: () => void; onDelete?: () => void }) {
  return (
    <div className={cn('cyber-clip border p-3', tone === 'muted' ? 'border-dashed border-border bg-background/40' : 'border-border bg-card/40')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{title} {count != null && <span className="text-xs text-muted-foreground">({count})</span>}</p>
        <div className="flex items-center gap-2">
          {onRename && <button onClick={onRename} className="text-xs text-muted-foreground hover:text-foreground">rename</button>}
          {onDelete && <button onClick={onDelete} aria-label="Remove group" className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>}
        </div>
      </div>
      <ul className="space-y-1">{children}</ul>
    </div>
  )
}

function PlayerRow({ p, groups, currentGroup, onMove, onRemove, removeTitle }: { p: SetupPlayer; groups: { id: number; label: string }[]; currentGroup: number | null; onMove: (gid: number | null) => void; onRemove: (() => void) | null; removeTitle?: string }) {
  return (
    <li className="flex items-center gap-2 rounded-none border border-border/60 bg-background/60 px-2.5 py-1.5 text-sm">
      <PlayerName identity={{ cueverseId: p.cueverseId, preferredName: p.name }} size="sm" className="min-w-0 flex-1" />
      <span className="tabular shrink-0 text-xs font-semibold text-muted-foreground">{p.rating ?? '—'}</span>
      <select
        aria-label={`Move ${identityText({ cueverseId: p.cueverseId, preferredName: p.name })} to group`}
        value={currentGroup ?? ''}
        onChange={(e) => onMove(e.target.value === '' ? null : Number(e.target.value))}
        className="shrink-0 rounded border border-input bg-card px-1.5 py-1 text-xs"
      >
        <option value="">Unassigned</option>
        {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
      </select>
      {onRemove && <button aria-label={removeTitle ? `${removeTitle}: ${identityText({ cueverseId: p.cueverseId, preferredName: p.name })}` : `Remove ${identityText({ cueverseId: p.cueverseId, preferredName: p.name })} from group`} title={removeTitle ?? 'Remove from group'} onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>}
    </li>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="rounded-md border border-dashed border-border/50 px-2.5 py-3 text-center text-xs text-muted-foreground">{children}</li>
}
