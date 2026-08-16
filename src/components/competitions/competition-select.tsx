'use client'

import { useState } from 'react'

import { cn } from '@/lib/utils'
import { createCompetitionAction } from '@/lib/competitions/actions'
import type { CompetitionRef } from '@/lib/competitions/shared'
import { CompetitionBadge } from './competition-badge'

const CREATE_NEW = '__create__'

/**
 * Required Competition selector for the Season forms.
 *
 * Lists active Competitions and offers "Create new Competition…", which opens a small inline panel
 * INSIDE the form rather than navigating away — so nothing already typed into the Season form is
 * lost. On success the new Competition is appended to the list and selected automatically.
 *
 * Creation is admin/owner-gated on the server (`manage_competitions`); a non-admin simply gets the
 * error back and the selector stays as it was.
 */
export function CompetitionSelect({
  competitions,
  value,
  onChange,
  inputClassName,
}: {
  competitions: CompetitionRef[]
  value: number | null
  onChange: (id: number | null, list: CompetitionRef[]) => void
  inputClassName?: string
}) {
  const [list, setList] = useState<CompetitionRef[]>(competitions)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = list.find((c) => c.id === value) ?? null

  async function submit() {
    setError(null)
    if (!name.trim()) {
      setError('A Competition name is required.')
      return
    }
    setPending(true)
    const res = await createCompetitionAction({ name: name.trim(), shortName: shortName.trim() || name.trim() })
    setPending(false)
    if (res.error || !res.competition) {
      setError(res.error ?? 'Could not create the Competition.')
      return
    }
    const next = [...list, res.competition].sort((a, b) => a.name.localeCompare(b.name))
    setList(next)
    onChange(res.competition.id, next) // auto-select the new Competition
    setCreating(false)
    setName('')
    setShortName('')
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        {selected && (
          <CompetitionBadge
            name={selected.name}
            shortName={selected.shortName}
            iconMediaId={selected.iconMediaId}
            size={24}
          />
        )}
        <select
          value={value == null ? '' : String(value)}
          onChange={(e) => {
            if (e.target.value === CREATE_NEW) {
              setCreating(true)
              return
            }
            onChange(e.target.value === '' ? null : Number(e.target.value), list)
          }}
          className={cn(inputClassName, 'max-w-[320px]')}
          aria-label="Competition"
        >
          <option value="">Select a Competition…</option>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={CREATE_NEW}>+ Create new Competition…</option>
        </select>
      </div>

      {creating && (
        <div className="mt-3 rounded-md border border-border bg-card p-3">
          <p className="text-xs font-semibold text-foreground">New Competition</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-[0.7rem] text-muted-foreground">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 8BRCAM"
                maxLength={80}
                autoFocus
                className={cn(inputClassName, 'mt-1 w-full')}
              />
            </label>
            <label className="text-[0.7rem] text-muted-foreground">
              Short name
              <input
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="defaults to the name"
                maxLength={20}
                className={cn(inputClassName, 'mt-1 w-full')}
              />
            </label>
          </div>
          <p className="mt-2 text-[0.7rem] text-muted-foreground/70">
            The slug is derived automatically. An icon can be uploaded later — until then the
            Competition shows an initials badge.
          </p>
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {pending ? 'Creating…' : 'Create & select'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false)
                setError(null)
              }}
              disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
