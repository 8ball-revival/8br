'use client'

import { useMemo, useState } from 'react'
import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { addPlayerToGroupAction, renameGroupAction, type ActionResult } from '@/lib/competition/actions'

export interface EntrantOption {
  registrationId: number
  displayName: string
  cueverseId: string | null
}

/**
 * Searchable "add entrant" control for a group. The passed list already excludes
 * players assigned to any other group, so a player can never be double-assigned
 * from here. Filters by display name OR CueVerse ID as the staffer types.
 */
export function AddPlayerControl({
  seasonId,
  groupId,
  entrants,
  published,
}: {
  seasonId: number
  groupId: number
  entrants: EntrantOption[]
  published: boolean
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(addPlayerToGroupAction, {})
  const [q, setQ] = useState('')
  const [sel, setSel] = useState('')

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return entrants
    return entrants.filter(
      (e) => e.displayName.toLowerCase().includes(s) || (e.cueverseId ?? '').toLowerCase().includes(s),
    )
  }, [q, entrants])

  if (entrants.length === 0) {
    return <p className="text-xs text-muted-foreground">All entrants are assigned — nothing left to add.</p>
  }

  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={published ? (e) => { if (!window.confirm('Groups are published. Add this player and update the public site?')) e.preventDefault() } : undefined}
    >
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="groupId" value={groupId} />
      {published && <input type="hidden" name="force" value="on" />}
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name or CueVerse ID…"
        className="h-8 w-44 text-xs"
        aria-label="Search entrants"
      />
      <select
        name="registrationId"
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        className="h-8 max-w-[12rem] rounded-md border border-input bg-background/60 px-2 text-xs"
        aria-label="Select entrant"
      >
        <option value="">Select entrant…</option>
        {filtered.map((e) => (
          <option key={e.registrationId} value={e.registrationId}>
            {e.displayName}
            {e.cueverseId ? ` (${e.cueverseId})` : ''}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending || !sel}>
        {pending ? '…' : 'Add'}
      </Button>
      {state.error && <span className="w-full text-xs text-destructive">{state.error}</span>}
    </form>
  )
}

/** Inline rename for a group (toggles a text field). */
export function RenameGroupForm({ seasonId, groupId, name }: { seasonId: number; groupId: number; name: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(renameGroupAction, {})
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
        Rename
      </Button>
    )
  }
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="groupId" value={groupId} />
      <Input name="name" defaultValue={name} className="h-8 w-36 text-sm" aria-label="Group name" autoFocus />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? '…' : 'Save'}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  )
}
