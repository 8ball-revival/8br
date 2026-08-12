'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createSeasonAction, type ActionResult } from '@/lib/competition/actions'

/** Create a new live season (e.g. 8 Ball Revival Season 2). */
export function CreateSeasonForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createSeasonAction, {})
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="space-y-1.5">
        <span className="text-sm font-medium">Season name</span>
        <Input name="name" placeholder="8 Ball Revival Season 2" defaultValue="8 Ball Revival Season 2" required className="w-56" />
      </label>
      <label className="space-y-1.5">
        <span className="text-sm font-medium">Slug</span>
        <Input name="slug" placeholder="season-2" defaultValue="season-2" required className="w-56" />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create season'}
      </Button>
      {state.error && <p className="w-full text-sm text-destructive">{state.error}</p>}
    </form>
  )
}
