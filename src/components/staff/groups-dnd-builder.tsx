'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GripVertical, X, Eye, EyeOff, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  setGroupCountAction,
  addPlayerToGroupAction,
  addPlayersToGroupAction,
  movePlayerAction,
  removePlayerFromGroupAction,
  swapPlayersAction,
  deleteGroupAction,
  renameGroupAction,
  publishGroupsAction,
  unpublishGroupsAction,
} from '@/lib/competition/actions'

export interface BuilderPlayer {
  registrationId: number
  displayName: string
  cueverseId: string | null
}
export interface BuilderGroup {
  id: number
  name: string
  players: BuilderPlayer[]
}

type Drag = { registrationIds: number[]; fromGroupId: number | null }

/**
 * Polished drag-and-drop group builder. Search the Available pool, Ctrl/Shift
 * multi-select to move several at once, double-click a player to auto-place them in
 * the least-full group, drag between groups, drop onto a player to swap, drag back to
 * Available to remove. Live counts + unassigned total. Draft until published. All
 * mutations reuse the existing (duplicate-safe) group services.
 */
export function GroupsDndBuilder({
  seasonId,
  groups,
  unassigned,
  published,
  approvedCount,
}: {
  seasonId: number
  groups: BuilderGroup[]
  unassigned: BuilderPlayer[]
  published: boolean
  approvedCount: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [overZone, setOverZone] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [lastIdx, setLastIdx] = useState<number | null>(null)

  const force: Record<string, string> = published ? { force: 'on' } : {}

  const filteredPool = useMemo(() => {
    const s = query.trim().toLowerCase()
    if (!s) return unassigned
    return unassigned.filter((p) => p.displayName.toLowerCase().includes(s) || (p.cueverseId ?? '').toLowerCase().includes(s))
  }, [query, unassigned])

  type Action = (prev: { error?: string }, fd: FormData) => Promise<{ ok?: boolean; error?: string }>
  function run(action: Action, fields: Record<string, string | number>) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v))
    startTransition(async () => {
      const res = await action({}, fd)
      if (res?.error) setError(res.error)
      else { setError(null); setSelected(new Set()); router.refresh() }
    })
  }

  /** The least-full group (ties → earliest), optionally excluding one. */
  function leastFullGroup(excludeId?: number): BuilderGroup | null {
    const cands = groups.filter((g) => g.id !== excludeId)
    if (cands.length === 0) return null
    return cands.reduce((best, g) => (g.players.length < best.players.length ? g : best), cands[0])
  }

  // Drops -------------------------------------------------------------------
  function onDropToGroup(groupId: number) {
    if (!drag) return
    const ids = drag.registrationIds
    if (drag.fromGroupId === groupId) return
    if (drag.fromGroupId == null) {
      if (ids.length > 1) run(addPlayersToGroupAction, { seasonId, groupId, registrationIds: ids.join(',') })
      else run(addPlayerToGroupAction, { seasonId, groupId, registrationId: ids[0], ...force })
    } else {
      run(movePlayerAction, { seasonId, registrationId: ids[0], toGroupId: groupId, ...force })
    }
  }
  function onDropToPool() {
    if (!drag || drag.fromGroupId == null) return
    run(removePlayerFromGroupAction, { seasonId, groupId: drag.fromGroupId, registrationId: drag.registrationIds[0], ...force })
  }
  function onDropOnPlayer(target: BuilderPlayer, targetGroupId: number) {
    if (!drag || drag.registrationIds.includes(target.registrationId)) return
    if (drag.fromGroupId != null) run(swapPlayersAction, { seasonId, regA: drag.registrationIds[0], regB: target.registrationId })
    else onDropToGroup(targetGroupId)
  }

  // Pool selection ----------------------------------------------------------
  function onPoolClick(e: React.MouseEvent, idx: number, id: number) {
    if (e.shiftKey && lastIdx != null) {
      const [a, b] = [Math.min(lastIdx, idx), Math.max(lastIdx, idx)]
      const next = new Set(selected)
      for (let i = a; i <= b; i++) next.add(filteredPool[i].registrationId)
      setSelected(next)
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      next.has(id) ? next.delete(id) : next.add(id)
      setSelected(next); setLastIdx(idx)
    } else {
      setSelected(new Set([id])); setLastIdx(idx)
    }
  }

  const PoolChip = ({ p, idx }: { p: BuilderPlayer; idx: number }) => {
    const isSel = selected.has(p.registrationId)
    return (
      <div
        draggable
        onDragStart={(e) => {
          const ids = isSel && selected.size > 1 ? [...selected] : [p.registrationId]
          if (!isSel) setSelected(new Set([p.registrationId]))
          setDrag({ registrationIds: ids, fromGroupId: null }); e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => { setDrag(null); setOverZone(null) }}
        onClick={(e) => onPoolClick(e, idx, p.registrationId)}
        onDoubleClick={() => { const g = leastFullGroup(); if (g) run(addPlayerToGroupAction, { seasonId, groupId: g.id, registrationId: p.registrationId, ...force }) }}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing',
          isSel ? 'border-gold bg-gold/10' : 'border-border bg-card hover:border-gold/50',
        )}
        title="Click to select · Ctrl/Shift for multi-select · double-click to auto-place · drag into a group"
      >
        <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{p.displayName}{p.cueverseId && <span className="text-xs text-muted-foreground"> ({p.cueverseId})</span>}</span>
      </div>
    )
  }

  const GroupChip = ({ p, groupId }: { p: BuilderPlayer; groupId: number }) => (
    <div
      draggable
      onDragStart={(e) => { setDrag({ registrationIds: [p.registrationId], fromGroupId: groupId }); e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => { setDrag(null); setOverZone(null) }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropOnPlayer(p, groupId) }}
      onDoubleClick={() => { const g = leastFullGroup(groupId); if (g) run(movePlayerAction, { seasonId, registrationId: p.registrationId, toGroupId: g.id, ...force }) }}
      className={cn('flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing hover:border-gold/50', drag?.registrationIds.includes(p.registrationId) && 'opacity-40')}
      title="Drag to another group, onto a player to swap, or to Available to remove"
    >
      <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{p.displayName}{p.cueverseId && <span className="text-xs text-muted-foreground"> ({p.cueverseId})</span>}</span>
      <button type="button" onClick={() => run(removePlayerFromGroupAction, { seasonId, groupId, registrationId: p.registrationId, ...force })} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove ${p.displayName}`}>
        <X className="size-3.5" />
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Groups</span>
          <select
            defaultValue={String(Math.max(groups.length, 1))}
            disabled={published || pending}
            onChange={(e) => run(setGroupCountAction, { seasonId, count: Number(e.target.value) })}
            className="h-8 rounded-md border border-input bg-background/60 px-2 text-sm"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="text-sm text-muted-foreground">· {approvedCount} entrant(s) · <span className="font-medium text-foreground">{unassigned.length}</span> unassigned</span>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setPreview((v) => !v)}>
            {preview ? <><EyeOff className="size-4" /> Exit preview</> : <><Eye className="size-4" /> Preview</>}
          </Button>
          {published ? (
            <Button type="button" size="sm" variant="outline" disabled={pending}
              onClick={() => { if (window.confirm('Unpublish groups? They will be hidden from the public site (only before results exist).')) run(unpublishGroupsAction, { seasonId }) }}>
              Unpublish
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={pending}
              onClick={() => { if (window.confirm('Publish groups? They become public and round-robin fixtures are generated. Empty groups and double-assigned players are blocked.')) run(publishGroupsAction, { seasonId }) }}>
              Publish
            </Button>
          )}
          {published ? <Badge variant="success">Published</Badge> : <Badge variant="muted">Draft</Badge>}
        </div>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </div>

      {preview ? (
        <PreviewPanel groups={groups} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* Available pool */}
          <div
            onDragOver={(e) => { e.preventDefault(); setOverZone('pool') }}
            onDragLeave={() => setOverZone(null)}
            onDrop={(e) => { e.preventDefault(); setOverZone(null); onDropToPool() }}
            className={cn('rounded-lg border p-3', overZone === 'pool' ? 'border-gold bg-gold/5' : 'border-border bg-card/40')}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Available Players ({filteredPool.length})</h3>
              {selected.size > 0 && <span className="text-xs text-gold">{selected.size} selected</span>}
            </div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-8 pl-7 text-xs" />
            </div>
            <div className="space-y-1.5">
              {filteredPool.length === 0 ? (
                <p className="text-xs text-muted-foreground">{unassigned.length === 0 ? 'All entrants assigned.' : 'No matches.'}</p>
              ) : (
                filteredPool.map((p, i) => <PoolChip key={p.registrationId} p={p} idx={i} />)
              )}
            </div>
          </div>

          {/* Groups */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Choose a number of groups above to begin — Group A is created automatically.</p>
            ) : (
              groups.map((g) => (
                <div
                  key={g.id}
                  onDragOver={(e) => { e.preventDefault(); setOverZone(`g${g.id}`) }}
                  onDragLeave={() => setOverZone(null)}
                  onDrop={(e) => { e.preventDefault(); setOverZone(null); onDropToGroup(g.id) }}
                  className={cn('rounded-lg border p-3', overZone === `g${g.id}` ? 'border-gold bg-gold/5' : 'border-border bg-card/40')}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <RenameInline seasonId={seasonId} groupId={g.id} name={g.name} onDone={() => router.refresh()} />
                    <div className="flex items-center gap-1">
                      <Badge variant="muted">{g.players.length}</Badge>
                      {g.players.length === 0 && (
                        <button type="button" onClick={() => { if (window.confirm(`Delete ${g.name}?`)) run(deleteGroupAction, { seasonId, groupId: g.id }) }}
                          className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${g.name}`}>
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="min-h-16 space-y-1.5">
                    {g.players.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border py-4 text-center text-xs text-muted-foreground">Drop players here</p>
                    ) : (
                      g.players.map((p) => <GroupChip key={p.registrationId} p={p} groupId={g.id} />)
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RenameInline({ seasonId, groupId, name, onDone }: { seasonId: number; groupId: number; name: string; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  if (!editing) return <button type="button" className="font-display text-sm font-semibold hover:text-gold" onClick={() => setEditing(true)}>{name}</button>
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        fd.set('seasonId', String(seasonId)); fd.set('groupId', String(groupId))
        startTransition(async () => { await renameGroupAction({}, fd); setEditing(false); onDone() })
      }}
      className="flex items-center gap-1"
    >
      <Input name="name" defaultValue={name} autoFocus className="h-7 w-28 text-sm" />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>✓</Button>
    </form>
  )
}

function PreviewPanel({ groups }: { groups: BuilderGroup[] }) {
  return (
    <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
      <p className="mb-3 text-sm text-muted-foreground">Preview — how the groups will appear once published.</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g.id} className="rounded-lg border border-border bg-card/60 p-3">
            <h4 className="mb-2 font-display font-semibold">{g.name}</h4>
            <ol className="space-y-1 text-sm">
              {g.players.map((p, i) => (
                <li key={p.registrationId} className="flex gap-2">
                  <span className="tabular text-xs text-muted-foreground">{i + 1}.</span>
                  <span className="truncate">{p.displayName}{p.cueverseId && <span className="text-xs text-muted-foreground"> ({p.cueverseId})</span>}</span>
                </li>
              ))}
              {g.players.length === 0 && <li className="text-xs text-destructive">Empty — add players before publishing.</li>}
            </ol>
          </div>
        ))}
      </div>
    </div>
  )
}
