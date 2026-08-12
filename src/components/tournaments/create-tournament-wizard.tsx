'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createTournamentAction } from '@/lib/competition/tournament-actions'
import type { CreateTournamentConfig } from '@/lib/competition/tournament-create'

const FIELD = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
const LABEL = 'eyebrow text-muted-foreground'

type Format = 'BRACKET' | 'GROUPS'

export function CreateTournamentWizard() {
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

  // Tournament Format — Bracket (default) or Group Stage + Playoffs (optional).
  const [format, setFormat] = useState<Format>('BRACKET')
  const [bracketElim, setBracketElim] = useState<'SINGLE_ELIM' | 'DOUBLE_ELIM'>('SINGLE_ELIM')

  // Group Stage + Playoffs config (only used when format = GROUPS).
  const [groupCount, setGroupCount] = useState(4)
  const [qualifiersPerGroup, setQualifiersPerGroup] = useState(2)
  const [playoffSeeding, setPlayoffSeeding] = useState<'standing' | 'random' | 'manual'>('standing')
  const [playoffDoubleElim, setPlayoffDoubleElim] = useState(false)

  const submit = () => {
    setError(null)
    const isGroups = format === 'GROUPS'
    const cfg: CreateTournamentConfig = {
      name: name.trim(),
      gameType,
      participantFormat,
      teamSize: participantFormat === 'TEAM' ? teamSize : null,
      tournamentFormat: isGroups ? 'GROUPS_PLAYOFFS' : bracketElim,
      raceLength,
      camRequirement: cam,
      initialState,
      ...(isGroups
        ? {
            groupCount,
            qualifiersPerGroup,
            playoffSeeding,
            playoffDoubleElim,
          }
        : {}),
    }
    start(async () => {
      const r = await createTournamentAction(cfg)
      if (r.error || !r.number) return setError(r.error ?? 'Could not create the tournament.')
      router.push(`/tournaments/${r.number}`)
    })
  }

  if (!open) {
    return (
      <div className="mb-6">
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Create tournament
        </Button>
      </div>
    )
  }

  return (
    <div className="mb-8 rounded-xl border border-brand/30 bg-card/40 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="default">Admin</Badge>
          <h2 className="font-display text-lg font-semibold">Create a tournament</h2>
        </div>
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      {/* Tournament Format — the primary choice. */}
      <div className="mt-4">
        <label className={LABEL}>Tournament format</label>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <FormatCard
            active={format === 'BRACKET'}
            title="Bracket Tournament"
            body="Single or double elimination. Register, generate the bracket, play it out. (Default)"
            onClick={() => setFormat('BRACKET')}
          />
          <FormatCard
            active={format === 'GROUPS'}
            title="Group Stage + Playoffs"
            body="Round-robin groups first; top players advance into a generated playoff bracket."
            onClick={() => setFormat('GROUPS')}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={LABEL}>Tournament name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. WCC Winter Open" className={`${FIELD} mt-1`} />
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

        {/* Bracket-only: elimination type. No group settings appear here. */}
        {format === 'BRACKET' && (
          <div>
            <label className={LABEL}>Elimination</label>
            <select value={bracketElim} onChange={(e) => setBracketElim(e.target.value as 'SINGLE_ELIM' | 'DOUBLE_ELIM')} className={`${FIELD} mt-1`}>
              <option value="SINGLE_ELIM">Single elimination</option>
              <option value="DOUBLE_ELIM">Double elimination</option>
            </select>
          </div>
        )}

        <div>
          <label className={LABEL}>Race length (race to)</label>
          <input
            type="number"
            min={1}
            value={raceLength}
            onChange={(e) => setRaceLength(Math.max(1, Number(e.target.value) || 1))}
            className={`${FIELD} mt-1`}
          />
          <p className="mt-1 text-[0.65rem] text-muted-foreground">Games needed to win a match. Any positive number. Editable later.</p>
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

      {/* Group Stage settings — shown ONLY for Group Stage + Playoffs. */}
      {format === 'GROUPS' && (
        <div className="mt-4 rounded-lg border border-border bg-background/40 p-4">
          <p className="eyebrow mb-3 text-brand">Group stage settings</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Number of groups</label>
              <input type="number" min={1} value={groupCount} onChange={(e) => setGroupCount(Math.max(1, Number(e.target.value) || 1))} className={`${FIELD} mt-1`} />
            </div>
            <div>
              <label className={LABEL}>Qualifiers per group</label>
              <input type="number" min={1} value={qualifiersPerGroup} onChange={(e) => setQualifiersPerGroup(Math.max(1, Number(e.target.value) || 1))} className={`${FIELD} mt-1`} />
            </div>
            <div>
              <label className={LABEL}>Playoff seeding</label>
              <select value={playoffSeeding} onChange={(e) => setPlayoffSeeding(e.target.value as 'standing' | 'random' | 'manual')} className={`${FIELD} mt-1`}>
                <option value="standing">By group standing (cross-seed)</option>
                <option value="random">Random draw</option>
                <option value="manual">Manual (set later)</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Playoff bracket</label>
              <select value={playoffDoubleElim ? 'DOUBLE' : 'SINGLE'} onChange={(e) => setPlayoffDoubleElim(e.target.value === 'DOUBLE')} className={`${FIELD} mt-1`}>
                <option value="SINGLE">Single elimination</option>
                <option value="DOUBLE">Double elimination</option>
              </select>
            </div>
          </div>
          <p className="mt-3 text-[0.65rem] text-muted-foreground">
            Top {qualifiersPerGroup} from each of {groupCount} group{groupCount === 1 ? '' : 's'} advance into the
            generated playoff bracket. All group settings are editable until the group stage begins.
          </p>
        </div>
      )}

      {error && <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={submit} disabled={pending || !name.trim()}>
          {pending ? 'Creating…' : 'Create tournament'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <span className="text-xs text-muted-foreground">A unique tournament number + code are assigned automatically.</span>
      </div>
    </div>
  )
}

function FormatCard({ active, title, body, onClick }: { active: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-brand bg-brand/10' : 'border-border bg-background/40 hover:border-brand/50',
      )}
    >
      <span className={cn('block text-sm font-semibold', active ? 'text-brand' : 'text-foreground')}>{title}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{body}</span>
    </button>
  )
}
