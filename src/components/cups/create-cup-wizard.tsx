'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createCupAction } from '@/lib/competition/cup-actions'
import type { CreateCupConfig } from '@/lib/competition/cup-create'

const FIELD = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
const LABEL = 'eyebrow text-muted-foreground'

export function CreateCupWizard() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [gameType, setGameType] = useState('8-Ball')
  const [participantFormat, setParticipantFormat] = useState<'INDIVIDUAL' | 'TEAM'>('INDIVIDUAL')
  const [teamSize, setTeamSize] = useState(2)
  const [raceLength, setRaceLength] = useState(7)
  const [cam, setCam] = useState<'REQUIRED' | 'OPTIONAL' | 'NO_CAM'>('OPTIONAL')
  const [initialState, setInitialState] = useState<'DRAFT' | 'UPCOMING'>('UPCOMING')

  const submit = () => {
    setError(null)
    const cfg: CreateCupConfig = {
      name: name.trim(),
      gameType,
      participantFormat,
      teamSize: participantFormat === 'TEAM' ? teamSize : null,
      tournamentFormat: 'SINGLE_ELIM',
      raceLength,
      camRequirement: cam,
      initialState,
    }
    start(async () => {
      const r = await createCupAction(cfg)
      if (r.error || !r.cupNumber) return setError(r.error ?? 'Could not create the cup.')
      router.push(`/cups/${r.cupNumber}`)
    })
  }

  if (!open) {
    return (
      <div className="mb-6">
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Create cup
        </Button>
      </div>
    )
  }

  return (
    <div className="mb-8 rounded-xl border border-gold/30 bg-card/40 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="gold">Admin</Badge>
          <h2 className="font-display text-lg font-semibold">Create a cup</h2>
        </div>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={LABEL}>Cup name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 9 Ball Cup" className={`${FIELD} mt-1`} />
        </div>

        <div>
          <label className={LABEL}>Game</label>
          <select value={gameType} onChange={(e) => setGameType(e.target.value)} className={`${FIELD} mt-1`}>
            <option value="8-Ball">8 Ball</option>
            <option value="9-Ball">9 Ball</option>
          </select>
        </div>

        <div>
          <label className={LABEL}>Participant format</label>
          <select value={participantFormat} onChange={(e) => setParticipantFormat(e.target.value as 'INDIVIDUAL' | 'TEAM')} className={`${FIELD} mt-1`}>
            <option value="INDIVIDUAL">1v1 (individual)</option>
            <option value="TEAM">Team (2v2+)</option>
          </select>
        </div>

        {participantFormat === 'TEAM' && (
          <div>
            <label className={LABEL}>Team size</label>
            <input type="number" min={2} max={5} value={teamSize} onChange={(e) => setTeamSize(Math.max(2, Number(e.target.value) || 2))} className={`${FIELD} mt-1`} />
          </div>
        )}

        <div>
          <label className={LABEL}>Structure</label>
          <select value="SINGLE_ELIM" disabled className={`${FIELD} mt-1`}>
            <option value="SINGLE_ELIM">Single elimination</option>
          </select>
          <p className="mt-1 text-[0.65rem] text-muted-foreground">Groups, round-robin & double-elim for cups are coming soon.</p>
        </div>

        <div>
          <label className={LABEL}>Race length (race to)</label>
          <input
            type="number"
            min={1}
            value={raceLength}
            onChange={(e) => setRaceLength(Math.max(1, Number(e.target.value) || 1))}
            className={`${FIELD} mt-1`}
          />
          <p className="mt-1 text-[0.65rem] text-muted-foreground">Games needed to win a match. Any positive number (5, 7, 9, 11…). Editable later.</p>
        </div>

        <div>
          <label className={LABEL}>Camera requirement</label>
          <select value={cam} onChange={(e) => setCam(e.target.value as 'REQUIRED' | 'OPTIONAL' | 'NO_CAM')} className={`${FIELD} mt-1`}>
            <option value="OPTIONAL">Optional</option>
            <option value="REQUIRED">Required</option>
            <option value="NO_CAM">No cam</option>
          </select>
        </div>

        <div>
          <label className={LABEL}>Initial state</label>
          <select value={initialState} onChange={(e) => setInitialState(e.target.value as 'DRAFT' | 'UPCOMING')} className={`${FIELD} mt-1`}>
            <option value="UPCOMING">Upcoming</option>
            <option value="DRAFT">Draft</option>
          </select>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={submit} disabled={pending || !name.trim()}>
          {pending ? 'Creating…' : 'Create cup'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <span className="text-xs text-muted-foreground">A unique cup number + code are assigned automatically.</span>
      </div>
    </div>
  )
}
