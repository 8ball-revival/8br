'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import { cn } from '@/lib/utils'
import { createSeasonAction } from '@/lib/creator/season-create-actions'

/**
 * Create a Season.
 *
 * ── The preview is the point ─────────────────────────────────────────────────────────────────────
 * Competition, year, number and division together ARE the Season's identity — the same four fields
 * the duplicate rule uses. Showing the resulting title as it is typed means the reader sees what
 * they are about to create before they create it, which is the cheapest possible way to catch
 * "wrong year" before it becomes a record with entrants in it.
 *
 * ── One submission, whatever the network does ────────────────────────────────────────────────────
 * The idempotency key is generated once for this form instance, not per click. A slow response and
 * an impatient second click send the same key, and the second call returns the record the first one
 * made. The database's unique index is still the thing that guarantees it; this only makes the
 * common case pleasant.
 */
export function SeasonCreateForm({
  competitions,
  structures,
  defaultYear,
}: {
  competitions: { id: number; name: string }[]
  structures: { id: string; label: string; hint: string }[]
  defaultYear: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [existingHref, setExistingHref] = useState<string | null>(null)

  const [competitionSeriesId, setCompetition] = useState(competitions[0]?.id ?? 0)
  const [competitionYear, setYear] = useState(defaultYear)
  const [structure, setStructure] = useState(structures[0]?.id ?? '')
  const [number, setNumber] = useState<string>('')
  const [division, setDivision] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  /*
   * One key per form instance, minted on first submit rather than during render.
   *
   * A retry of THIS submission reuses it and gets back the record the first attempt made; a fresh
   * form gets a fresh key. Generated in the event handler because a random value produced while
   * rendering is not stable across re-renders — which would defeat the whole point of it.
   */
  const keyRef = useRef<string | null>(null)

  const competitionName = competitions.find((c) => c.id === competitionSeriesId)?.name ?? 'Competition'
  const previewNumber = number.trim() === '' ? 'next' : number.trim()
  const preview = `${competitionName} Season ${previewNumber} · ${competitionYear}`
    + (division.trim() ? ` · ${division.trim()}` : '')

  const submit = () => {
    setError(null)
    setExistingHref(null)
    start(async () => {
      const r = await createSeasonAction({
        competitionYear,
        competitionSeriesId,
        structure,
        number: number.trim() === '' ? null : Number(number),
        division: division.trim() || null,
        title: title.trim() || null,
        description: description.trim() || null,
        idempotencyKey: (keyRef.current ??= crypto.randomUUID()),
      })
      if (r.ok && r.href) { router.push(r.href); return }
      setError(r.error ?? 'The Season could not be created.')
      setExistingHref(r.existingHref ?? null)
    })
  }

  return (
    <form
      className="max-w-2xl space-y-5"
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/[0.05] px-4 py-3">
        <p className="eyebrow text-muted-foreground">This will create</p>
        <p className="mt-0.5 font-display text-lg font-bold text-[var(--gold)]">{preview}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/[0.06] px-4 py-3 text-sm text-destructive">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
          {existingHref && (
            <Link
              href={existingHref}
              className="mt-2 inline-block font-semibold text-[var(--gold)] hover:underline"
            >
              Open in Creator →
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Competition">
          <select
            value={competitionSeriesId}
            onChange={(e) => setCompetition(Number(e.target.value))}
            className={inputCls}
          >
            {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        <Field label="Competition Year">
          <input
            type="number"
            value={competitionYear}
            onChange={(e) => setYear(Number(e.target.value) || defaultYear)}
            className={inputCls}
          />
        </Field>

        <Field label="Season Number" hint="Leave blank to take the next free number.">
          <input
            type="number"
            min={1}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="next"
            className={inputCls}
          />
        </Field>

        <Field label="Division" hint="A divisional pair may share a Season number.">
          <select value={division} onChange={(e) => setDivision(e.target.value)} className={inputCls}>
            <option value="">No Division</option>
            <option value="Division A">Division A</option>
            <option value="Division B">Division B</option>
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-foreground">Structure</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {structures.map((s) => (
            <label
              key={s.id}
              className={cn(
                'cursor-pointer rounded-lg border px-3 py-2.5 transition-colors',
                structure === s.id
                  ? 'border-[var(--gold)]/50 bg-[var(--gold)]/[0.07]'
                  : 'border-border bg-card/40 hover:border-[var(--gold)]/30',
              )}
            >
              <span className="flex items-start gap-2">
                <input
                  type="radio"
                  name="structure"
                  value={s.id}
                  checked={structure === s.id}
                  onChange={() => setStructure(s.id)}
                  className="mt-1 accent-[var(--gold)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Subtitle" hint="Optional. Shown under the Season title.">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </Field>

      <Field label="Description or announcement" hint="Optional.">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={cn(inputCls, 'resize-y')}
        />
      </Field>

      <p className="text-xs text-muted-foreground">
        Entrants are added in Creator. Whether members may enter this Season themselves is decided by
        the site-wide registration policy, not per Season.
      </p>

      <button
        type="submit"
        disabled={pending || !competitionSeriesId || !structure}
        className="rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
      >
        {pending ? 'Creating…' : 'Create Season'}
      </button>
    </form>
  )
}

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
