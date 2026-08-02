'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GripVertical, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { rebuildManualPlayoffAction, publishPlayoffAction, returnPlayoffToDraftAction, deletePlayoffAction } from '@/lib/competition/actions'

export interface SeedItem { registrationId: number; seed: number; displayName: string; cueverseId: string | null }
export interface PoolItem { registrationId: number; displayName: string; cueverseId: string | null }

type Drag = { registrationId: number; from: 'pool' | 'seed' }

function nextSize(n: number) {
  let p = 2
  while (p < n) p *= 2
  return Math.max(p, 2)
}

/**
 * Manual single-elimination bracket builder. Drag entrants from Available Entrants
 * into the seed list, reorder seeds, drop onto a seed to swap, or drag back to remove.
 * Every change rebuilds the DRAFT bracket via planBracket (auto-sizes to 4/8/16/32/64
 * with byes) and persists it; the public bracket rendering is reused unchanged.
 */
export function PlayoffDndBuilder({
  seasonId,
  seeds,
  pool,
  published,
}: {
  seasonId: number
  seeds: SeedItem[]
  pool: PoolItem[]
  published: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const order = seeds.map((s) => s.registrationId)

  function rebuild(newOrder: number[]) {
    const fd = new FormData()
    fd.set('seasonId', String(seasonId))
    fd.set('registrationIds', newOrder.join(','))
    startTransition(async () => {
      const res = await rebuildManualPlayoffAction({}, fd)
      if (res?.error) setError(res.error)
      else { setError(null); router.refresh() }
    })
  }
  function act(action: (p: { error?: string }, fd: FormData) => Promise<{ ok?: boolean; error?: string }>) {
    const fd = new FormData(); fd.set('seasonId', String(seasonId))
    startTransition(async () => {
      const res = await action({}, fd)
      if (res?.error) setError(res.error)
      else { setError(null); router.refresh() }
    })
  }

  // Drop resolution ---------------------------------------------------------
  function dropOnSeed(targetId: number) {
    if (!drag) return
    if (drag.registrationId === targetId) return
    if (drag.from === 'pool') {
      // Insert at the target's position.
      const idx = order.indexOf(targetId)
      const next = order.filter((id) => id !== drag.registrationId)
      next.splice(idx, 0, drag.registrationId)
      rebuild(next)
    } else {
      // Swap two seeds.
      const next = [...order]
      const a = next.indexOf(drag.registrationId), b = next.indexOf(targetId)
      ;[next[a], next[b]] = [next[b], next[a]]
      rebuild(next)
    }
  }
  function dropToSeedList() {
    if (!drag || drag.from !== 'pool') return
    rebuild([...order, drag.registrationId]) // append
  }
  function dropToPool() {
    if (!drag || drag.from !== 'seed') return
    rebuild(order.filter((id) => id !== drag.registrationId))
  }

  const size = seeds.length >= 2 ? nextSize(seeds.length) : 0

  const PoolChip = ({ p }: { p: PoolItem }) => (
    <div
      draggable
      onDragStart={(e) => { setDrag({ registrationId: p.registrationId, from: 'pool' }); e.dataTransfer.effectAllowed = 'move' }}
      onDragEnd={() => { setDrag(null); setOver(null) }}
      className="flex cursor-grab items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-sm hover:border-gold/50 active:cursor-grabbing"
    >
      <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{p.displayName}{p.cueverseId && <span className="text-xs text-muted-foreground"> ({p.cueverseId})</span>}</span>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 p-3">
        <span className="text-sm text-muted-foreground">{seeds.length} seeded{size ? ` · bracket of ${size} (byes fill empty slots)` : ' · add at least 2 to form a bracket'}</span>
        <div className="ml-auto flex items-center gap-2">
          {published ? <Badge variant="success">Published</Badge> : <Badge variant="muted">Draft</Badge>}
          {published ? (
            <Button type="button" size="sm" variant="outline" disabled={pending}
              onClick={() => { if (window.confirm('Return the bracket to draft to edit it? (Only allowed before results are recorded.)')) act(returnPlayoffToDraftAction) }}>
              Return to Draft
            </Button>
          ) : (
            <>
              <Button type="button" size="sm" disabled={pending || seeds.length < 2}
                onClick={() => { if (window.confirm('Publish this bracket to the public playoffs page?')) act(publishPlayoffAction) }}>
                Publish
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={pending || seeds.length === 0}
                onClick={() => { if (window.confirm('Delete the entire bracket? Seeds return to the entrant pool. This cannot be undone.')) act(deletePlayoffAction) }}>
                Delete bracket
              </Button>
            </>
          )}
        </div>
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </div>

      {published ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Bracket is published. Return it to draft to change the seeding.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* Available entrants */}
          <div
            onDragOver={(e) => { e.preventDefault(); setOver('pool') }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); dropToPool() }}
            className={cn('rounded-lg border p-3', over === 'pool' ? 'border-gold bg-gold/5' : 'border-border bg-card/40')}
          >
            <h3 className="mb-2 font-display text-sm font-semibold">Available Entrants ({pool.length})</h3>
            <div className="space-y-1.5">
              {pool.length === 0 ? <p className="text-xs text-muted-foreground">All active entrants are seeded. Drag a seed here to remove it.</p> : pool.map((p) => <PoolChip key={p.registrationId} p={p} />)}
            </div>
          </div>

          {/* Seed list */}
          <div
            onDragOver={(e) => { e.preventDefault(); setOver('seeds') }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); dropToSeedList() }}
            className={cn('rounded-lg border p-3', over === 'seeds' ? 'border-gold bg-gold/5' : 'border-border bg-card/40')}
          >
            <h3 className="mb-2 font-display text-sm font-semibold">Seeds</h3>
            {seeds.length === 0 ? (
              <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">Drag entrants here to seed the bracket (seed 1 = top).</p>
            ) : (
              <ol className="space-y-1.5">
                {seeds.map((s) => (
                  <li
                    key={s.registrationId}
                    draggable
                    onDragStart={(e) => { setDrag({ registrationId: s.registrationId, from: 'seed' }); e.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { setDrag(null); setOver(null) }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOnSeed(s.registrationId) }}
                    className={cn('flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-sm', 'cursor-grab active:cursor-grabbing hover:border-gold/50', drag?.registrationId === s.registrationId && 'opacity-40')}
                  >
                    <span className="tabular w-6 shrink-0 text-center text-xs font-semibold text-gold">{s.seed}</span>
                    <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{s.displayName}{s.cueverseId && <span className="text-xs text-muted-foreground"> ({s.cueverseId})</span>}</span>
                    <button type="button" onClick={() => rebuild(order.filter((id) => id !== s.registrationId))} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove ${s.displayName}`}>
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
