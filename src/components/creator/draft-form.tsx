'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Check, Loader2, RotateCw } from 'lucide-react'

import { AutosaveEngine, type AutosaveSnapshot } from '@/lib/creator/autosave-engine'
import { updateSeasonSettingsAction } from '@/lib/seasons/actions'
import { cn } from '@/lib/utils'

/**
 * The editable metadata of a Creator draft, with autosave.
 *
 * Everything here writes through `updateSeasonSettingsAction` — the same lifecycle-aware, capability
 * -gated service the Season settings page uses. There is deliberately no second persistence path:
 * two ways to change a Season's title is two sets of rules about what a valid title is, and they
 * disagree within the month.
 *
 * Autosave never CREATES. The draft already exists by the time this renders, and every write targets
 * its id, so no amount of typing or retrying can produce a second Season.
 *
 * Entrants are not here. They are added and removed through their own server actions, which already
 * persist immediately; routing them through a generic autosave as well would mean two writers for
 * one list and a race between them.
 */

export interface DraftFormProps {
  seasonId: number
  competitions: { id: number; name: string }[]
  initial: {
    title: string
    competitionYear: string
    competitionSeriesId: string
    number: string
    division: string
    description: string
    groupStageGames: string
    earlyRaceTo: string
    semifinalRaceTo: string
    finalRaceTo: string
  }
  /** Where Save and Continue goes — the next thing this draft actually needs. */
  continueHref: string
  continueLabel: string
}

type Values = DraftFormProps['initial']

const INPUT =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60'

/** Map the form's string fields onto the settings patch the service accepts. */
function toPatch(patch: Partial<Values>) {
  const out: Record<string, unknown> = {}
  if ('title' in patch) out.subtitle = patch.title?.trim() || null
  if ('competitionYear' in patch) out.competitionYear = patch.competitionYear || null
  if ('competitionSeriesId' in patch) out.competitionSeriesId = patch.competitionSeriesId || null
  if ('number' in patch) out.number = patch.number || null
  if ('description' in patch) out.description = patch.description?.trim() || null
  for (const k of ['groupStageGames', 'earlyRaceTo', 'semifinalRaceTo', 'finalRaceTo'] as const) {
    if (k in patch) {
      const n = Number(patch[k])
      if (Number.isFinite(n) && n > 0) out[k] = n
    }
  }
  return out
}

export function DraftForm({ seasonId, competitions, initial, continueHref, continueLabel }: DraftFormProps) {
  const router = useRouter()
  /*
   * The engine is a stable instance, held in lazy state rather than a ref.
   *
   * It is mutable and long-lived, which reads like a ref — but it is read inside event handlers and
   * effects that React must be able to reason about, and a lazy `useState` initialiser gives the
   * same create-once guarantee without the render-time access a ref would involve.
   */
  const [engine] = useState(() => new AutosaveEngine<Values>(initial))

  const [values, setValues] = useState<Values>(initial)
  const [status, setStatus] = useState<AutosaveSnapshot>(() => engine.snapshot())
  const [leaving, setLeaving] = useState<null | 'exit' | 'continue'>(null)
  const [exitError, setExitError] = useState<string | null>(null)

  /**
   * Send one request and hand the answer back to the engine.
   *
   * `division` is not on the settings service, so it is written through the same action's sibling
   * fields where supported and otherwise left to the settings page — see the note in toPatch.
   */
  const send = useCallback(async (req: { seq: number; patch: Partial<Values> }) => {
    let result: { ok: boolean; error?: string }
    try {
      const r = await updateSeasonSettingsAction(seasonId, toPatch(req.patch))
      result = r.ok ? { ok: true } : { ok: false, error: r.error ?? 'The change could not be saved.' }
    } catch {
      result = { ok: false, error: 'The change could not be saved. Nothing was lost — try again.' }
    }
    engine.settle(req.seq, result, Date.now())
    setStatus(engine.snapshot())
    return result
  }, [seasonId, engine])

  // The engine owns WHEN to write; this only supplies a clock. Polling rather than a per-keystroke
  // timeout keeps one timer for the whole form instead of one per field.
  useEffect(() => {
    const t = setInterval(() => {
      const req = engine.tick(Date.now())
      setStatus(engine.snapshot())
      if (req) void send(req)
    }, 250)
    return () => clearInterval(t)
  }, [send, engine])

  // Only genuinely unconfirmed work blocks a reload — see shouldWarnOnLeave.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (engine.shouldWarnOnLeave()) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [engine])

  const set = (key: keyof Values) => (e: { target: { value: string } }) => {
    const v = e.target.value
    setValues((p) => ({ ...p, [key]: v }))
    engine.change(key, v, Date.now())
    setStatus(engine.snapshot())
  }

  /**
   * Flush, wait for the server to confirm, and only then leave.
   *
   * The order matters: navigating first and saving in the background is how an edit disappears. If
   * the save fails the page stays put, the values stay on screen and the error is shown, so a retry
   * is one click rather than a re-type.
   */
  async function saveThen(where: 'exit' | 'continue') {
    setExitError(null)
    setLeaving(where)

    const req = engine.flush()
    if (req) {
      const result = await send(req)
      if (!result.ok) {
        setExitError(result.error ?? 'The change could not be saved.')
        setLeaving(null)
        return
      }
    }
    // Anything typed during that write must land too, or leaving would drop it.
    if (engine.isDirty()) {
      const tail = engine.flush()
      if (tail) {
        const result = await send(tail)
        if (!result.ok) {
          setExitError(result.error ?? 'The change could not be saved.')
          setLeaving(null)
          return
        }
      }
    }

    router.push(where === 'exit' ? '/creator' : continueHref)
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
          Setup
        </h2>
        <SaveBadge
          status={status}
          onRetry={() => {
            const req = engine.retry()
            setStatus(engine.snapshot())
            if (req) void send(req)
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" hint="Left blank, it is named from its Competition and number.">
          <input value={values.title} onChange={set('title')} maxLength={80} className={INPUT} />
        </Field>
        <Field label="Competition Year" hint="The year it was PLAYED.">
          <input type="number" inputMode="numeric" min={1900} max={2100}
            value={values.competitionYear} onChange={set('competitionYear')} className={INPUT} />
        </Field>
        <Field label="Competition">
          <select value={values.competitionSeriesId} onChange={set('competitionSeriesId')} className={INPUT}>
            {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Season number">
          <input type="number" inputMode="numeric" min={1} value={values.number} onChange={set('number')} className={INPUT} />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Description" hint="Optional. Plain text.">
          <textarea value={values.description} onChange={set('description')} rows={3} maxLength={2000} className={INPUT} />
        </Field>
      </div>

      <fieldset className="mt-4 rounded-md border border-border p-3">
        <legend className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Match format
        </legend>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Group games">
            <input type="number" min={1} value={values.groupStageGames} onChange={set('groupStageGames')} className={INPUT} />
          </Field>
          <Field label="Early race to">
            <input type="number" min={1} value={values.earlyRaceTo} onChange={set('earlyRaceTo')} className={INPUT} />
          </Field>
          <Field label="Semifinal race to">
            <input type="number" min={1} value={values.semifinalRaceTo} onChange={set('semifinalRaceTo')} className={INPUT} />
          </Field>
          <Field label="Final race to">
            <input type="number" min={1} value={values.finalRaceTo} onChange={set('finalRaceTo')} className={INPUT} />
          </Field>
        </div>
      </fieldset>

      {exitError && (
        <p role="alert" className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {exitError} Your changes are still here — nothing was lost.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void saveThen('continue')}
          disabled={leaving !== null}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--gold)] px-4 py-2 font-display text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {leaving === 'continue' && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {continueLabel}
        </button>
        <button
          type="button"
          onClick={() => void saveThen('exit')}
          disabled={leaving !== null}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm transition-colors hover:border-[var(--brand)]/50 disabled:opacity-60"
        >
          {leaving === 'exit' && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save and Exit
        </button>
        <p className="text-xs text-muted-foreground">
          Nothing here is published. The draft stays private until you complete it.
        </p>
      </div>
    </div>
  )
}

/**
 * The save state, announced politely.
 *
 * `aria-live="polite"` on a region that only ever holds four short strings: a screen reader hears
 * "Saving…" then "Saved" rather than the whole form re-read on every keystroke.
 */
function SaveBadge({ status, onRetry }: { status: AutosaveSnapshot; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-live="polite"
        className={cn(
          'inline-flex items-center gap-1.5 text-xs',
          status.state === 'error' ? 'text-red-400'
            : status.state === 'saved' ? 'text-muted-foreground'
              : 'text-muted-foreground',
        )}
      >
        {status.state === 'saving' && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {status.state === 'saved' && <Check className="size-3.5" aria-hidden />}
        {status.state === 'error' && <AlertCircle className="size-3.5" aria-hidden />}
        {status.message}
      </span>
      {status.state === 'error' && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:border-[var(--brand)]/50"
        >
          <RotateCw className="size-3" aria-hidden />
          Retry
        </button>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}
