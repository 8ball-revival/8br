'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

import { createRecordAction } from '@/app/(frontend)/creator/actions'

/**
 * Creator setup — the form that brings a Season or a Cup into existence.
 *
 * Ordered the way the decision is actually made: what kind of record, then when it was played, then
 * which Competition it belongs to, then whether it is being run or being rebuilt. Everything after
 * that is detail, and the detail that only applies to one branch is hidden on the other rather than
 * disabled — a field that cannot apply should not be there to be puzzled over.
 *
 * Purpose is the pivot. A Historical Reconstruction has no registration to schedule, no password to
 * protect and no public listing to appear on, so choosing it removes those questions entirely
 * instead of asking them and ignoring the answers.
 */

export interface StructureOption {
  id: string
  label: string
  hint: string
  seasons: boolean
  cups: boolean
}

export interface SetupFormProps {
  competitions: { id: number; name: string }[]
  structures: StructureOption[]
  initialType: 'season' | 'cup'
  currentYear: number
}

const YEAR_MIN = 1900

const INPUT =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60'

const CHOICE_ON = 'border-[var(--gold)] bg-[var(--gold)]/10 text-foreground'
const CHOICE_OFF = 'border-border text-muted-foreground hover:border-[var(--gold)]/40 hover:text-foreground'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function SetupForm({ competitions, structures, initialType, currentYear }: SetupFormProps) {
  const router = useRouter()
  const [type, setType] = useState<'season' | 'cup'>(initialType)
  const [v, setV] = useState<Record<string, string>>({
    competitionYear: String(currentYear),
    competitionSeriesId: competitions[0] ? String(competitions[0].id) : '',
    purpose: 'reconstruction',
    structure: '',
    title: '',
    number: '',
    division: '',
    description: '',
    groupStageGames: '',
    earlyRaceTo: '',
    semifinalRaceTo: '',
    finalRaceTo: '',
    accessMode: 'OPEN',
    joinPassword: '',
    registrationOpensAt: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Minted on the FIRST submit and reused for every retry of THIS form. A retry after a timeout
  // must not become a second Season, and only a stable key can tell the server those are the same
  // attempt. Generated in the event handler rather than during render, because a random value read
  // while rendering is not a stable identity — a re-render would mint a second key and defeat the
  // protection it exists to provide.
  const idempotencyKey = useRef<string | null>(null)

  const available = useMemo(
    () => structures.filter((s) => (type === 'season' ? s.seasons : s.cups)),
    [structures, type],
  )
  const reconstruction = v.purpose === 'reconstruction'
  const set = (k: string) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const year = Number(v.competitionYear)
    if (!Number.isInteger(year) || year < YEAR_MIN) {
      setError('Enter a four-digit competition year.')
      return
    }
    if (!v.competitionSeriesId) {
      setError('Choose a Competition.')
      return
    }
    if (!v.structure) {
      setError('Choose a structure.')
      return
    }
    if (type === 'cup' && !v.title.trim()) {
      setError('A Cup needs a title.')
      return
    }

    setBusy(true)
    try {
      idempotencyKey.current ??= `setup-${initialType}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
      const res = await createRecordAction({ ...v, type, idempotencyKey: idempotencyKey.current })
      if (!res.ok || res.id == null) {
        setError(res.error ?? 'The record could not be created.')
        setBusy(false)
        return
      }
      // Deliberately not clearing `busy` on success: the navigation is the end of this form's life,
      // and re-enabling the button during the transition invites the second submit.
      router.push(res.type === 'cup' ? `/creator/cups/${res.id}` : `/creator/seasons/${res.id}`)
    } catch {
      setError('The record could not be created. Nothing was saved — try again.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Field label="What are you creating?">
        <div className="flex flex-col gap-2 sm:flex-row">
          {(['season', 'cup'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => {
                setType(t)
                setV((p) => ({ ...p, structure: '' }))
              }}
              className={`flex-1 rounded-md border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60 ${type === t ? CHOICE_ON : CHOICE_OFF}`}
            >
              <span className="block font-display text-sm font-bold">{t === 'season' ? 'Season' : 'Cup'}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t === 'season'
                  ? 'A numbered Season within a Competition, with a group stage.'
                  : 'A standalone Cup, decided by a bracket or by Swiss rounds.'}
              </span>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Competition Year" hint="The year it was PLAYED, not today.">
          <input
            type="number"
            inputMode="numeric"
            min={YEAR_MIN}
            max={2100}
            value={v.competitionYear}
            onChange={set('competitionYear')}
            className={INPUT}
            required
          />
        </Field>

        <Field label="Competition">
          <select value={v.competitionSeriesId} onChange={set('competitionSeriesId')} className={INPUT} required>
            {competitions.length === 0 ? <option value="">No Competitions exist yet</option> : null}
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Purpose">
        <div className="flex flex-col gap-2 sm:flex-row">
          {([
            ['live', 'Live Competition', 'It will be played from here. Registration and scheduling apply.'],
            ['reconstruction', 'Historical Reconstruction', 'It was played already. Entered by hand, hidden from the public until it is completed.'],
          ] as const).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              aria-pressed={v.purpose === id}
              onClick={() => setV((p) => ({ ...p, purpose: id }))}
              className={`flex-1 rounded-md border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60 ${v.purpose === id ? CHOICE_ON : CHOICE_OFF}`}
            >
              <span className="block font-display text-sm font-bold">{label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Structure">
        <div className="space-y-2">
          {available.map((s) => (
            <label
              key={s.id}
              className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 transition-colors ${v.structure === s.id ? 'border-[var(--gold)] bg-[var(--gold)]/10' : 'border-border hover:border-[var(--gold)]/40'}`}
            >
              <input
                type="radio"
                name="structure"
                value={s.id}
                checked={v.structure === s.id}
                onChange={set('structure')}
                className="mt-1 accent-[var(--gold)]"
              />
              <span>
                <span className="block text-sm font-semibold">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={type === 'cup' ? 'Title' : 'Custom title'}
          hint={type === 'cup' ? undefined : 'Optional. Left blank, it is named from its Competition and number.'}
        >
          <input value={v.title} onChange={set('title')} maxLength={80} className={INPUT} required={type === 'cup'} />
        </Field>

        {type === 'season' ? (
          <Field label="Season number" hint="Optional. Left blank, it takes the next number going spare.">
            <input type="number" inputMode="numeric" min={1} value={v.number} onChange={set('number')} className={INPUT} />
          </Field>
        ) : null}

        <Field label="Division" hint="Optional. Left blank, it ranks as Unassigned.">
          <input value={v.division} onChange={set('division')} maxLength={40} className={INPUT} />
        </Field>
      </div>

      <Field label="Description" hint="Optional. Plain text.">
        <textarea value={v.description} onChange={set('description')} rows={3} maxLength={2000} className={INPUT} />
      </Field>

      <fieldset className="rounded-md border border-border p-4">
        <legend className="px-1.5 font-display text-xs font-bold uppercase tracking-wide text-[var(--gold)]">
          Match format
        </legend>
        <p className="mb-3 text-xs text-muted-foreground">
          Optional — left blank, each takes the application default. A reconstruction records the
          scores as they were played whatever is set here.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {type === 'season' ? (
            <Field label="Group games">
              <input type="number" min={1} value={v.groupStageGames} onChange={set('groupStageGames')} className={INPUT} />
            </Field>
          ) : null}
          <Field label={type === 'cup' ? 'Race to' : 'Early rounds race to'}>
            <input type="number" min={1} value={v.earlyRaceTo} onChange={set('earlyRaceTo')} className={INPUT} />
          </Field>
          {type === 'season' ? (
            <>
              <Field label="Semifinal race to">
                <input type="number" min={1} value={v.semifinalRaceTo} onChange={set('semifinalRaceTo')} className={INPUT} />
              </Field>
              <Field label="Final race to">
                <input type="number" min={1} value={v.finalRaceTo} onChange={set('finalRaceTo')} className={INPUT} />
              </Field>
            </>
          ) : null}
        </div>
      </fieldset>

      {!reconstruction ? (
        <fieldset className="rounded-md border border-border p-4">
          <legend className="px-1.5 font-display text-xs font-bold uppercase tracking-wide text-[var(--gold)]">
            Registration
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Access">
              <select value={v.accessMode} onChange={set('accessMode')} className={INPUT}>
                <option value="OPEN">Open — anyone signed in may enter</option>
                <option value="PASSWORD">Password — an entry password is required</option>
              </select>
            </Field>
            {v.accessMode === 'PASSWORD' ? (
              <Field label="Entry password" hint="Stored hashed. It is never shown again.">
                <input
                  type="password"
                  value={v.joinPassword}
                  onChange={set('joinPassword')}
                  className={INPUT}
                  autoComplete="new-password"
                />
              </Field>
            ) : null}
            <Field label="Registration opens" hint="Optional. A future time schedules it; blank opens it now.">
              <input
                type="datetime-local"
                value={v.registrationOpensAt}
                onChange={set('registrationOpensAt')}
                className={INPUT}
              />
            </Field>
          </div>
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--gold)] px-5 py-2.5 font-display text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Creating…' : 'Create and continue'}
        </button>
        <Link href="/creator" className="text-sm text-muted-foreground hover:text-foreground">Cancel</Link>
      </div>
    </form>
  )
}
