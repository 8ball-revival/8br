'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateSeasonAction, type ActionResult } from '@/lib/competition/actions'

interface SeasonData {
  id: number
  seasonStatus: string
  registrationClosesAt: string | null
  groupsStatus: string
  playoffsStatus: string
  raceLength: number
  qualifiersPerGroup: number
}

const SEASON_STATES = ['UPCOMING', 'ACTIVE', 'COMPLETED']
const STAGE_STATES = ['PENDING', 'PUBLISHED', 'COMPLETED']

function Select({ name, label, value, options }: { name: string; label: string; value: string; options: string[] }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Season control panel — changes take effect on the public site immediately. */
export function SeasonForm({ season }: { season: SeasonData }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateSeasonAction, {})
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="seasonId" value={season.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select name="seasonStatus" label="Season status" value={season.seasonStatus} options={SEASON_STATES} />
        <Select name="groupsStatus" label="Group stage" value={season.groupsStatus} options={STAGE_STATES} />
        <Select name="playoffsStatus" label="Playoffs" value={season.playoffsStatus} options={STAGE_STATES} />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Registration deadline (informational only)</span>
          <Input type="date" name="registrationClosesAt" defaultValue={season.registrationClosesAt ?? ''} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Race length (games to win)</span>
          <Input type="number" name="raceLength" min={1} max={99} defaultValue={season.raceLength} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Qualifiers per group</span>
          <Input type="number" name="qualifiersPerGroup" min={1} max={16} defaultValue={season.qualifiersPerGroup} />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Reason (optional, recorded in the audit log)</span>
        <Input type="text" name="reason" placeholder="e.g. Opening registration for Season 2" />
      </label>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.message && <p className="text-sm text-success">{state.message}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save & update public site'}
      </Button>
    </form>
  )
}
