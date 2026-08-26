'use client'

import { useState, useTransition } from 'react'
import { Eye, Save, X, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { STATISTICS, TIEBREAK_STATISTICS, statistic } from '@/lib/achievements/statistics'
import { validateDefinition, type DefinitionInput, type ValidationErrors } from '@/lib/achievements/validate'
import type { Achievement } from '@/lib/achievements/types'
import { AchievementCard } from '@/components/home/achievements-carousel'

/**
 * The achievement editor, including the rule builder.
 *
 * ── The point of the whole feature ───────────────────────────────────────────────────────────────
 * Everything here is dropdowns, numbers and toggles. There is no SQL, no expression language and no
 * place to type code, because the requirement was that a new achievement takes a form rather than a
 * developer. "Most losses of all time" is: Automatic → Losses → All competitions → All matches →
 * Highest → `{value} LOSSES`.
 *
 * ── Fields appear only when they change the answer ───────────────────────────────────────────────
 * The form reads the statistic registry to decide what to show. A percentage reveals the minimum-
 * matches field and demands it; a career figure like Rating hides the stage filter, because a rating
 * is not a per-stage number. Showing every field always would mean most of them are noise most of
 * the time, and the ones that matter would be lost among them.
 *
 * ── Validation is shared, not re-implemented ─────────────────────────────────────────────────────
 * This calls the same `validateDefinition` the server action calls. The form's job is to put the
 * message next to the field; the server's job is to refuse regardless of what the form did.
 */

export interface EditorOptions {
  competitions: { id: number; name: string }[]
  seasons: { id: number; label: string }[]
  tournaments: { id: number; label: string }[]
  players: { id: string; label: string }[]
}

export const EMPTY_DEFINITION: DefinitionInput = {
  title: '',
  flavorText: '',
  description: '',
  awardType: 'AUTOMATIC',
  status: 'ACTIVE',
  displayFormat: '{value}',
  statistic: 'wins',
  scope: 'ALL_COMPETITIONS',
  stage: 'ALL_MATCHES',
  winner: 'HIGHEST',
  tiePolicy: 'SHOW_ALL',
}

export function AchievementEditor({
  initial,
  options,
  onSave,
  onPreview,
  onCancel,
  saving,
}: {
  initial: DefinitionInput
  options: EditorOptions
  onSave: (input: DefinitionInput) => void
  onPreview: (input: DefinitionInput) => Promise<{ card?: Achievement; errors?: ValidationErrors }>
  onCancel: () => void
  saving?: boolean
}) {
  const [form, setForm] = useState<DefinitionInput>(initial)
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [preview, setPreview] = useState<Achievement | null>(null)
  const [previewNote, setPreviewNote] = useState<string | null>(null)
  const [previewing, startPreview] = useTransition()

  const set = <K extends keyof DefinitionInput>(k: K, v: DefinitionInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    // Clear the message for the field being edited; the rest stay until re-checked.
    setErrors((e) => { const n = { ...e }; delete n[k as string]; return n })
    setPreview(null)
  }

  const def = statistic(form.statistic)
  const isAuto = form.awardType === 'AUTOMATIC'

  const runPreview = () => {
    const found = validateDefinition(form)
    setErrors(found)
    if (Object.keys(found).length > 0) { setPreviewNote('Fix the errors above first.'); return }
    startPreview(async () => {
      const res = await onPreview(form)
      if (res.errors && Object.keys(res.errors).length > 0) { setErrors(res.errors); setPreview(null); return }
      setPreview(res.card ?? null)
      setPreviewNote(
        res.card && res.card.winners.length === 0
          ? 'This rule currently matches nobody. Choose "Show a placeholder" if you want the card to appear anyway.'
          : null,
      )
    })
  }

  const submit = () => {
    const found = validateDefinition(form)
    setErrors(found)
    if (Object.keys(found).length === 0) onSave(form)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
      <div className="min-w-0 space-y-4">
        {/* ── Basics ───────────────────────────────────────────────────────────────────────── */}
        <Group title="Basics">
          <Field label="Name" error={errors.title}>
            <input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="MOST LOSSES OF ALL TIME"
              className={input}
            />
          </Field>
          <Field label="Flavour text" hint="The joke. Shown under the figure." error={errors.flavorText}>
            <input
              value={form.flavorText ?? ''}
              onChange={(e) => set('flavorText', e.target.value)}
              placeholder="Kept turning up anyway."
              className={input}
            />
          </Field>
          <Field label="Explanation" hint="The arithmetic, so the number can be checked.">
            <textarea
              value={form.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              placeholder="More recorded losses than anybody in the archive."
              className={cn(input, 'resize-y')}
            />
          </Field>
          <Field label="Status" hint="Hidden achievements stay here but never appear publicly.">
            <Segmented
              value={form.status ?? 'ACTIVE'}
              onChange={(v) => set('status', v as 'ACTIVE' | 'ARCHIVED')}
              options={[['ACTIVE', 'Active'], ['ARCHIVED', 'Hidden']]}
            />
          </Field>
        </Group>

        {/* ── How it is awarded ────────────────────────────────────────────────────────────── */}
        <Group title="How it is awarded">
          <Field label="Award type">
            <Segmented
              value={form.awardType}
              onChange={(v) => set('awardType', v as 'AUTOMATIC' | 'MANUAL')}
              options={[['AUTOMATIC', 'Automatic'], ['MANUAL', 'Manual']]}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {isAuto
                ? 'The holder is worked out from the rule below and follows the data. If the archive changes, the card changes.'
                : 'You choose the holder and the value. Use this for anything the database cannot measure.'}
            </p>
          </Field>

          {isAuto ? (
            <>
              <Field label="Statistic" hint={def?.hint} error={errors.statistic}>
                <select value={form.statistic ?? ''} onChange={(e) => set('statistic', e.target.value)} className={input}>
                  {STATISTICS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Field>

              <Field label="Winner" error={errors.winner}>
                <Segmented
                  value={form.winner ?? 'HIGHEST'}
                  onChange={(v) => set('winner', v)}
                  options={[['HIGHEST', 'Highest value'], ['LOWEST', 'Lowest value']]}
                />
              </Field>

              <Field label="Competitions" error={errors.competitionId ?? errors.seasonId ?? errors.tournamentId}>
                <select value={form.scope ?? 'ALL_COMPETITIONS'} onChange={(e) => set('scope', e.target.value)} className={input}>
                  <option value="ALL_COMPETITIONS">All competitions</option>
                  <option value="SEASONS">Seasons only</option>
                  <option value="TOURNAMENTS">Tournaments only</option>
                  <option value="SPECIFIC_COMPETITION">One competition…</option>
                  <option value="SPECIFIC_SEASON">One Season…</option>
                  <option value="SPECIFIC_TOURNAMENT">One Tournament…</option>
                </select>
                {form.scope === 'SPECIFIC_COMPETITION' && (
                  <select value={form.competitionId ?? ''} onChange={(e) => set('competitionId', Number(e.target.value) || null)} className={cn(input, 'mt-2')}>
                    <option value="">Choose a competition…</option>
                    {options.competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {form.scope === 'SPECIFIC_SEASON' && (
                  <select value={form.seasonId ?? ''} onChange={(e) => set('seasonId', Number(e.target.value) || null)} className={cn(input, 'mt-2')}>
                    <option value="">Choose a Season…</option>
                    {options.seasons.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                )}
                {form.scope === 'SPECIFIC_TOURNAMENT' && (
                  <select value={form.tournamentId ?? ''} onChange={(e) => set('tournamentId', Number(e.target.value) || null)} className={cn(input, 'mt-2')}>
                    <option value="">Choose a Tournament…</option>
                    {options.tournaments.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                )}
              </Field>

              {/* A career figure has no stage, so the control is not offered for one. */}
              {def?.stageAware !== false && (
                <Field label="Matches" error={errors.stage}>
                  <select value={form.stage ?? 'ALL_MATCHES'} onChange={(e) => set('stage', e.target.value)} className={input}>
                    <option value="ALL_MATCHES">All matches</option>
                    <option value="GROUP_STAGE">Group stage only</option>
                    <option value="PLAYOFFS">Playoffs only</option>
                    <option value="FINALS">Finals only</option>
                  </select>
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="Player" hint="Leave blank for a site-wide fact with no holder.">
                <select value={form.manualPlayerId ?? ''} onChange={(e) => set('manualPlayerId', e.target.value || null)} className={input}>
                  <option value="">No player (site-wide)</option>
                  {options.players.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Value" hint="Shown exactly as typed." error={errors.manualValue}>
                <input
                  value={form.manualValue ?? ''}
                  onChange={(e) => set('manualValue', e.target.value)}
                  placeholder="6-0 in finals"
                  className={input}
                />
              </Field>
            </>
          )}
        </Group>

        {/* ── Qualification, ties and empties ──────────────────────────────────────────────── */}
        {isAuto && (
          <Group title="Qualification and ties">
            <Field
              label="Minimum matches"
              hint={def?.needsMinimum
                ? 'Required for a percentage: without it, one lucky match wins the award.'
                : 'Optional. Leave blank for no minimum.'}
              error={errors.minMatches}
            >
              <input
                type="number" min={0} inputMode="numeric"
                value={form.minMatches ?? ''}
                onChange={(e) => set('minMatches', e.target.value === '' ? null : Number(e.target.value))}
                placeholder={def?.needsMinimum ? '50' : 'none'}
                className={input}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Min. seasons" error={errors.minSeasons}>
                <input type="number" min={0} value={form.minSeasons ?? ''} placeholder="none"
                  onChange={(e) => set('minSeasons', e.target.value === '' ? null : Number(e.target.value))} className={input} />
              </Field>
              <Field label="Min. finals" error={errors.minFinals}>
                <input type="number" min={0} value={form.minFinals ?? ''} placeholder="none"
                  onChange={(e) => set('minFinals', e.target.value === '' ? null : Number(e.target.value))} className={input} />
              </Field>
              <Field label="Min. playoff matches" error={errors.minPlayoffMatches}>
                <input type="number" min={0} value={form.minPlayoffMatches ?? ''} placeholder="none"
                  onChange={(e) => set('minPlayoffMatches', e.target.value === '' ? null : Number(e.target.value))} className={input} />
              </Field>
            </div>

            <Field label="When players tie" error={errors.tieBreakStat}>
              <Segmented
                value={form.tiePolicy ?? 'SHOW_ALL'}
                onChange={(v) => set('tiePolicy', v)}
                options={[['SHOW_ALL', 'Show everyone tied'], ['SECONDARY_STAT', 'Break with another statistic']]}
              />
              {form.tiePolicy === 'SECONDARY_STAT' && (
                <select value={form.tieBreakStat ?? ''} onChange={(e) => set('tieBreakStat', e.target.value || null)} className={cn(input, 'mt-2')}>
                  <option value="">Choose a tie-break statistic…</option>
                  {TIEBREAK_STATISTICS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              )}
            </Field>
          </Group>
        )}

        {/* ── Display ──────────────────────────────────────────────────────────────────────── */}
        {isAuto && (
          <Group title="Display">
            <Field
              label="Figure format"
              hint="Use {value} where the number goes. It is the only token."
              error={errors.displayFormat}
            >
              <input
                value={form.displayFormat}
                onChange={(e) => set('displayFormat', e.target.value)}
                placeholder="{value} LOSSES"
                className={cn(input, 'font-mono')}
              />
            </Field>
          </Group>
        )}
      </div>

      {/* ── Preview and actions ─────────────────────────────────────────────────────────────── */}
      <aside className="space-y-3 lg:sticky lg:top-20">
        <div className="cyber-clip border border-[var(--line-strong)] bg-[var(--graphite)] p-3">
          <p className="eyebrow mb-2 text-[var(--hot-red)]">Preview</p>
          {preview ? (
            <AchievementCard achievement={preview} />
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Preview to see the real card, with the holder this rule currently produces.
            </p>
          )}
          {previewNote && <p className="mt-2 text-xs text-[var(--warning)]">{previewNote}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={runPreview} disabled={previewing}
            className="cyber-clip-sm inline-flex items-center gap-1.5 border border-[var(--line-strong)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-foreground transition-colors hover:border-[var(--cyan)] hover:text-[var(--cyan)] disabled:opacity-50">
            {previewing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            Preview
          </button>
          <button type="button" onClick={submit} disabled={saving}
            className="cyber-clip-sm inline-flex items-center gap-1.5 bg-[var(--acid)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--acid-ink)] transition-colors hover:bg-[var(--acid-hover)] disabled:opacity-50">
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
            Save
          </button>
          <button type="button" onClick={onCancel}
            className="cyber-clip-sm inline-flex items-center gap-1.5 border border-[var(--line)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
            <X className="size-3.5" aria-hidden />
            Cancel
          </button>
        </div>

        {Object.keys(errors).length > 0 && (
          <ul className="cyber-clip border border-[var(--hot-red)] bg-[var(--graphite)] p-3 text-xs text-[var(--hot-red)]" role="alert">
            {Object.entries(errors).map(([k, v]) => <li key={k}>{v}</li>)}
          </ul>
        )}
      </aside>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────────── pieces ───────── */

const input =
  'cyber-clip-sm w-full border border-[var(--line-strong)] bg-[var(--void)] px-2.5 py-2 text-sm '
  + 'text-[var(--clean-white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]'

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="cyber-clip border border-[var(--line-strong)] bg-[var(--graphite)] p-4">
      <h3 className="font-display text-xs font-bold uppercase tracking-[0.14em] text-[var(--hot-red)]">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label, hint, error, children,
}: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-[0.7rem] leading-snug text-muted-foreground/80">{hint}</span>}
      {error && <span className="mt-1 block text-[0.7rem] font-semibold text-[var(--hot-red)]">{error}</span>}
    </label>
  )
}

function Segmented({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div role="radiogroup" className="cyber-clip-sm inline-flex flex-wrap overflow-hidden border border-[var(--line-strong)]">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'px-3 py-1.5 text-[0.68rem] font-bold uppercase tracking-wider transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]',
            value === v ? 'bg-[var(--acid)] text-[var(--acid-ink)]' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
