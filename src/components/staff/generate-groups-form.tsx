'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { generateGroupsAction, type ActionResult } from '@/lib/competition/actions'

/**
 * Draw groups. Generation is deterministic and seeded — the same seed reproduces
 * the same draw. Generated groups are an unpublished DRAFT (a preview) until the
 * separate Publish action commits them. Regenerating requires `force` once published.
 */
export function GenerateGroupsForm({
  seasonId,
  approvedCount,
  alreadyPublished,
}: {
  seasonId: number
  approvedCount: number
  alreadyPublished: boolean
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(generateGroupsAction, {})
  const maxGroups = Math.max(1, Math.floor(approvedCount / 2))

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="seasonId" value={seasonId} />
      <label className="space-y-1.5">
        <span className="text-sm font-medium">Number of groups</span>
        <Input type="number" name="numGroups" min={1} max={Math.max(1, maxGroups)} defaultValue={Math.min(2, maxGroups)} className="w-32" required />
      </label>
      <label className="space-y-1.5">
        <span className="text-sm font-medium">Seed (optional — recorded)</span>
        <Input type="text" name="seed" placeholder="auto-generated if blank" className="w-56" />
      </label>
      {alreadyPublished && (
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="force" className="size-4 accent-gold" />
          Force regenerate (groups are published)
        </label>
      )}
      <Button type="submit" disabled={pending || approvedCount < 2}>
        {pending ? 'Drawing…' : 'Draw groups'}
      </Button>
      {approvedCount < 2 && <p className="w-full text-sm text-muted-foreground">Approve at least 2 registrations first.</p>}
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
      {state.message && <p className="w-full text-sm text-success">{state.message}</p>}
    </form>
  )
}
