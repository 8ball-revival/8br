'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import { cn } from '@/lib/utils'
import { createTournamentAction, type TournamentFormInput } from '@/lib/creator/tournament-create-actions'

type Format = TournamentFormInput['tournamentFormat']

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: 'SINGLE_ELIM', label: 'Single Elimination', hint: 'One bracket. A loss ends the run.' },
  { id: 'DOUBLE_ELIM', label: 'Double Elimination', hint: 'A losers bracket gives everyone a second life.' },
  { id: 'GROUPS_PLAYOFFS', label: 'Groups + Playoffs', hint: 'Round-robin groups, then a knockout bracket.' },
  { id: 'SWISS', label: 'Swiss System', hint: 'Fixed rounds, paired by standing. Nobody is eliminated.' },
]

/**
 * Create a Tournament.
 *
 * ── The team controls stay on screen ─────────────────────────────────────────────────────────────
 * Players-per-team and the random draw are visible but disabled while 1v1 is selected, rather than
 * appearing when Teams is chosen. A control that materialises changes the shape of the form under
 * the reader's hands and hides the fact that the choice exists at all; greyed-out says "this applies
 * to the other option" without moving anything.
 *
 * ── The preview is the review panel ──────────────────────────────────────────────────────────────
 * Format, participants and race length together describe what is about to be created, and the panel
 * restates them in the words the rest of the site uses. Reading your own choices back in the
 * system's vocabulary is the cheapest way to notice you picked the wrong one.
 */
export function TournamentCreateForm({
  competitions, defaultYear,
}: {
  competitions: { id: number; name: string }[]
  defaultYear: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [existingHref, setExistingHref] = useState<string | null>(null)
  const submitted = useRef(false)

  const [name, setName] = useState('')
  /*
    CueVerse by NAME, not "whichever competition is listed first".

    Position is not a default anybody chose: reordering the list, or adding one, silently changes
    what every new Tournament belongs to. Naming it means the fallback only applies when there is no
    CueVerse to find.
  */
  const [competitionSeriesId, setCompetition] = useState(
    competitions.find((c) => c.name.trim().toLowerCase() === 'cueverse')?.id ?? competitions[0]?.id ?? 0,
  )
  const [competitionYear, setYear] = useState(defaultYear)
  const [format, setFormat] = useState<Format>('SINGLE_ELIM')
  const [isTeam, setIsTeam] = useState(false)
  const [teamSize, setTeamSize] = useState(2)
  const [random, setRandom] = useState(false)
  const [raceLength, setRaceLength] = useState(5)
  const [swissRounds, setSwissRounds] = useState(4)
  const [playoffDoubleElim, setPlayoffDoubleElim] = useState(false)
  const [scheduleForLater, setScheduleForLater] = useState(false)
  const [scheduledStartAt, setScheduledStartAt] = useState('')
  const [description, setDescription] = useState('')

  const competitionName = competitions.find((c) => c.id === competitionSeriesId)?.name ?? 'Competition'
  const formatLabel = FORMATS.find((f) => f.id === format)!.label
  const previewTitle = name.trim() || 'Untitled Tournament'
  const previewLines = [
    `${competitionName} · ${competitionYear}`,
    format === 'SWISS' ? `${formatLabel} — ${swissRounds} rounds`
      : format === 'GROUPS_PLAYOFFS' ? `${formatLabel} — ${playoffDoubleElim ? 'double' : 'single'}-elimination playoffs`
        : formatLabel,
    isTeam ? `Teams of ${teamSize}${random ? ' · drawn at random' : ' · assigned by hand'}` : 'Individual 1v1',
    `Race to ${raceLength}`,
    scheduleForLater ? (scheduledStartAt ? `Scheduled for ${scheduledStartAt}` : 'Scheduled') : 'Registration opens now',
  ]

  const submit = () => {
    // One submission per form, whatever the pointer does: the create is not idempotent by identity.
    if (submitted.current) return
    setError(null)
    setExistingHref(null)
    submitted.current = true
    start(async () => {
      const r = await createTournamentAction({
        name, competitionSeriesId, competitionYear,
        tournamentFormat: format,
        participantFormat: isTeam ? 'TEAM' : 'INDIVIDUAL',
        teamSize: isTeam ? teamSize : null,
        teamFormation: random ? 'RANDOM' : 'PICK',
        raceLength,
        swissRounds: format === 'SWISS' ? swissRounds : null,
        playoffDoubleElim: format === 'GROUPS_PLAYOFFS' ? playoffDoubleElim : undefined,
        scheduleForLater,
        scheduledStartAt: scheduleForLater ? scheduledStartAt || null : null,
        description: description.trim() || null,
      })
      /*
        A warning means the Tournament EXISTS but did not arrive as asked, so it stays on this page
        with the reason and a link. Navigating would carry the reader to a screen whose state they
        did not choose, with nothing on it to say why.
      */
      if (r.ok && r.warning && r.href) {
        submitted.current = false
        setError(r.warning)
        setExistingHref(r.href)
        return
      }
      if (r.ok && r.href) { router.push(r.href); return }
      submitted.current = false
      setError(r.error ?? 'The Tournament could not be created.')
      setExistingHref(r.existingHref ?? null)
    })
  }

  return (
    <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <div className="space-y-5">
        {error && (
          <div className="cyber-clip border border-destructive/40 bg-destructive/[0.06] px-4 py-3 text-sm text-destructive">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{error}
            </p>
            {existingHref && (
              <Link href={existingHref} className="mt-2 inline-block font-semibold text-[var(--gold)] hover:underline">
                Open in Creator →
              </Link>
            )}
          </div>
        )}

        <Field label="Tournament Title">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Spring Invitational" />
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-foreground">Format</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <label key={f.id} className={cn('cursor-pointer cyber-clip border px-3 py-2.5 transition-colors',
                format === f.id ? 'border-[var(--gold)]/50 bg-[var(--selected-surface)]' : 'border-border bg-card/40 hover:border-[var(--gold)]/30')}>
                <span className="flex items-start gap-2">
                  <input type="radio" name="format" checked={format === f.id} onChange={() => setFormat(f.id)} className="mt-1 accent-[var(--gold)]" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{f.label}</span>
                    <span className="block text-xs text-muted-foreground">{f.hint}</span>
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {format === 'GROUPS_PLAYOFFS' && (
          <Field label="Playoff bracket">
            <select value={playoffDoubleElim ? 'de' : 'se'} onChange={(e) => setPlayoffDoubleElim(e.target.value === 'de')} className={inputCls}>
              <option value="se">Single Elimination</option>
              <option value="de">Double Elimination</option>
            </select>
          </Field>
        )}

        {format === 'SWISS' && (
          <Field label="Number of rounds">
            <input type="number" min={1} max={16} value={swissRounds}
              onChange={(e) => setSwissRounds(Math.max(1, Math.min(16, Number(e.target.value) || 4)))}
              className={cn(inputCls, 'w-28')} />
          </Field>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-foreground">Participants</legend>
          <div className="flex flex-wrap items-end gap-4">
            <div className="inline-flex gap-1 rounded-none border border-input bg-card p-1">
              {[{ v: false, l: 'Individual 1v1' }, { v: true, l: 'Teams' }].map((o) => (
                <button key={String(o.v)} type="button" onClick={() => setIsTeam(o.v)}
                  className={cn('rounded px-3 py-1.5 text-sm font-semibold transition-colors',
                    isTeam === o.v ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground')}>
                  {o.l}
                </button>
              ))}
            </div>

            {/* Visible always, active only for Teams — see the note at the top. */}
            <label className={cn('block', !isTeam && 'opacity-40')}>
              <span className="mb-1 block text-xs font-medium text-foreground">Players per team</span>
              <input type="number" min={2} max={6} value={teamSize} disabled={!isTeam}
                onChange={(e) => setTeamSize(Math.max(2, Math.min(6, Number(e.target.value) || 2)))}
                className={cn(inputCls, 'w-20 disabled:cursor-not-allowed')} />
            </label>
            <label className={cn('block', !isTeam && 'opacity-40')}>
              <span className="mb-1 block text-xs font-medium text-foreground">Random</span>
              <select value={random ? 'yes' : 'no'} disabled={!isTeam}
                onChange={(e) => setRandom(e.target.value === 'yes')}
                className={cn(inputCls, 'w-24 disabled:cursor-not-allowed')}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Race to" hint="Games required to win a match.">
            <input type="number" min={1} value={raceLength}
              onChange={(e) => setRaceLength(Math.max(1, Number(e.target.value) || 1))} className={cn(inputCls, 'w-24')} />
          </Field>
          <Field label="Start">
            <select value={scheduleForLater ? 'later' : 'now'} onChange={(e) => setScheduleForLater(e.target.value === 'later')} className={inputCls}>
              <option value="now">Start now</option>
              <option value="later">Schedule</option>
            </select>
          </Field>
        </div>

        {scheduleForLater && (
          <Field label="Scheduled start">
            <input type="datetime-local" value={scheduledStartAt} onChange={(e) => setScheduledStartAt(e.target.value)} className={inputCls} />
          </Field>
        )}

        {/*
          ── Filed under details, because they are details ─────────────────────────────────────
          Competition and Year sat directly under the title, ahead of the format and the entrants —
          the two decisions that actually shape a Tournament. They are almost always CueVerse and
          this year, so asking them first made every Tournament begin with two questions whose
          answer was already correct. They stay editable, and the values are shown rather than
          hidden behind a control, so nobody has to open anything to check them.
        */}
        <details className="cyber-clip border border-border bg-card/30">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground marker:text-muted-foreground hover:text-foreground">
            Details — {competitionName} · {competitionYear}
          </summary>
          <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
            <Field label="Competition">
              <select value={competitionSeriesId} onChange={(e) => setCompetition(Number(e.target.value))} className={inputCls}>
                {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Competition Year">
              <input type="number" value={competitionYear} onChange={(e) => setYear(Number(e.target.value) || defaultYear)} className={inputCls} />
            </Field>
          </div>
        </details>

        <Field label="Description or announcement" hint="Optional.">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={cn(inputCls, 'resize-y')} />
        </Field>

        <button type="submit" disabled={pending || !competitionSeriesId || !name.trim()}
          className="cyber-clip-sm bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60">
          {pending ? 'Creating…' : 'Create Tournament'}
        </button>
      </div>

      <aside className="h-max cyber-clip border border-[var(--gold)]/30 bg-[var(--selected-surface)] p-4 lg:sticky lg:top-4">
        <p className="eyebrow text-muted-foreground">This will create</p>
        <p className="mt-1 font-display text-lg font-bold text-[var(--gold)]">{previewTitle}</p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {previewLines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
          Entrants are added in Creator. Whether members may enter is decided by the site-wide
          registration policy, not per Tournament.
        </p>
      </aside>
    </form>
  )
}

const inputCls =
  'w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
