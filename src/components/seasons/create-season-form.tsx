'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Diamond, Lock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { COMPETITION_YEAR_MAX, COMPETITION_YEAR_MIN } from '@/lib/competition/competition-year'
import { CompetitionSelect } from '@/components/competitions/competition-select'
import type { CompetitionRef } from '@/lib/competitions/shared'
import { Button } from '@/components/ui/button'
import { createSeasonAction, suggestSeasonNumberAction } from '@/lib/seasons/actions'
import type { CreateSeasonConfig } from '@/lib/seasons/service'

const LOUNGES = ['Social', "Beginner's Lounge", 'Intermediate Lounge', 'Advanced Lounge']
const input = 'w-full rounded-none border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'
const eyebrow = 'flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-[var(--gold)]'

/** Create Season — the standalone Season creation form (individual 1v1 only, no format selector, no
 *  groups/qualifiers/bracket-type decisions; those happen later in the Season lifecycle). */
export function CreateSeasonForm({ nextNumber, year, competitions }: { nextNumber: number; year: number; competitions: CompetitionRef[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  /*
   * Platform, chosen first and defaulted to CueVerse.
   *
   * A new Season is a CueVerse Season nearly every time; Yahoo exists so a record the archive import
   * missed can be filed where it belongs. Choosing Yahoo defaults the Competition to 8BRCAM, because
   * that is where every Yahoo record lives — it is still a normal Competition picker afterwards,
   * since a future CueVerse Season may belong to several.
   */
  const [platform, setPlatform] = useState<'CUEVERSE' | 'YAHOO'>('CUEVERSE')
  const [subtitle, setSubtitle] = useState('')
  // Competition Year defaults to the current calendar year; the server re-validates the range.
  const [competitionYear, setCompetitionYear] = useState(String(year))
  // Required: a Season must belong to exactly one Competition. No 'Unassigned' option.
  const [competitionSeriesId, setCompetitionSeriesId] = useState<number | null>(
    competitions.length === 1 ? competitions[0].id : null,
  )
  /**
   * The Season number.
   *
   * Unique only within a Competition and year, so the suggestion has to follow both. `numberTouched`
   * is the important part: once an administrator types a number it is theirs, and changing the
   * Competition or year afterwards must never quietly overwrite it.
   */
  const [seasonNumber, setSeasonNumber] = useState(String(nextNumber))
  const [numberTouched, setNumberTouched] = useState(false)
  const [numberError, setNumberError] = useState<string | null>(null)

  const [lounge, setLounge] = useState('Social')
  const [access, setAccess] = useState<'OPEN' | 'PASSWORD'>('OPEN')
  const [joinPassword, setJoinPassword] = useState('')
  const [scheduleLater, setScheduleLater] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('19:00')
  const [description, setDescription] = useState('')

  const [groupStageGames, setGroupStageGames] = useState(10)
  const [earlyRaceTo, setEarlyRaceTo] = useState(7)
  const [semifinalRaceTo, setSemifinalRaceTo] = useState(9)
  const [finalRaceTo, setFinalRaceTo] = useState(9)

  /**
   * Refresh the suggested number when the Competition or year changes — but only while the field is
   * still automatic. A number the administrator typed is left exactly as they left it.
   */
  const pending_suggest = useRef<AbortController | null>(null)
  useEffect(() => {
    if (numberTouched) return
    const y = Number(competitionYear)
    if (competitionSeriesId == null || !Number.isInteger(y)) return
    pending_suggest.current?.abort()
    const ac = new AbortController()
    pending_suggest.current = ac
    void suggestSeasonNumberAction(competitionSeriesId, y)
      .then((n) => { if (!ac.signal.aborted) setSeasonNumber(String(n)) })
      .catch(() => { /* keep the current suggestion if the lookup fails */ })
    return () => ac.abort()
  }, [competitionSeriesId, competitionYear, numberTouched])

  // The official title is DERIVED from Competition, number and year, so the preview and the Review
  // panel update the instant any of the three changes. It is not a site-brand default: with no
  // Competition chosen yet there is nothing to prefix.
  const competitionName = competitions.find((c) => c.id === competitionSeriesId)?.name ?? ''
  const shownNumber = seasonNumber.trim() === '' ? '—' : seasonNumber.trim()
  const officialTitle = useMemo(
    () =>
      competitionName
        ? `${competitionName} Season ${shownNumber} · ${competitionYear}`
        : `Season ${shownNumber} · ${competitionYear}`,
    [competitionName, shownNumber, competitionYear],
  )

  const submit = () => {
    setError(null)
    setNumberError(null)
    // Mirrors the server rule so the common mistakes are answered without a round trip; the server
    // and the database both check it again regardless.
    const n = Number(seasonNumber.trim())
    if (seasonNumber.trim() === '' || !Number.isFinite(n)) return setNumberError('Enter a Season number.')
    if (!Number.isInteger(n)) return setNumberError('Season number must be a whole number, not a decimal.')
    if (n < 1) return setNumberError('Season number must be 1 or greater.')
    if (access === 'PASSWORD' && joinPassword.trim().length < 4) return setError('Set a join password of at least 4 characters.')
    if (scheduleLater && !date) return setError('Pick a date for the scheduled registration opening.')

    const cfg: CreateSeasonConfig = {
      competitionYear: Number(competitionYear),
      competitionSeriesId,
      platform,
      number: n,
      subtitle: subtitle.trim() || null,
      lounge,
      accessMode: access,
      joinPassword: access === 'PASSWORD' ? joinPassword.trim() : null,
      registrationOpensAt: scheduleLater ? `${date}T${time || '00:00'}` : null,
      description: description.trim() || null,
      groupStageGames,
      earlyRaceTo,
      semifinalRaceTo,
      finalRaceTo,
    }
    start(async () => {
      const r = await createSeasonAction(cfg)
      if (r.error || r.id == null) {
        // A number clash belongs beside the number, with the next free one offered. Everything else
        // already typed stays on screen.
        if (r.suggestion != null) {
          setNumberError(r.error ?? 'That Season number is taken.')
          setSeasonNumber(String(r.suggestion))
          setNumberTouched(false)
          return
        }
        return setError(r.error ?? 'Could not create the Season.')
      }
      // Routed by database id: the number is a label and may point at several Seasons.
      router.push(`/seasons/${r.id}`)
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="divide-y divide-border/60 overflow-hidden cyber-clip border border-[var(--gold-dim)] bg-surface">
        {/* Identity */}
        <section className="p-6">
          <p className={eyebrow}><Diamond className="size-3.5 fill-[var(--gold-soft)] text-[var(--gold-soft)]" aria-hidden /> Season Identity</p>
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-[var(--gold-dim)]/50 bg-[var(--selected-surface)] px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">Official title: </span>
              <span className="font-display font-bold text-[var(--gold-soft)]">{officialTitle}</span>
              <p className="mt-1 text-[0.7rem] text-muted-foreground/70">
                {competitionName
                  ? 'Built from the Competition, Season number and year below.'
                  : 'Select a Competition below — its name leads the official title.'}
              </p>
            </div>
            <Labeled label="Competition Year" hint="required">
              <input
                type="number"
                inputMode="numeric"
                value={competitionYear}
                onChange={(e) => setCompetitionYear(e.target.value)}
                min={COMPETITION_YEAR_MIN}
                max={COMPETITION_YEAR_MAX}
                step={1}
                className={cn(input, 'max-w-[140px]')}
                aria-describedby="competition-year-hint"
              />
              <p id="competition-year-hint" className="mt-1 text-[0.7rem] text-muted-foreground/70">
                Four-digit year this competition belongs to. Past and future years are both allowed.
              </p>
            </Labeled>
            {/* Compact, and before Competition because it decides which one is the sensible default.
                Secondary by design: the Season's identity is its Competition, number and year. */}
            <Labeled label="Platform" hint="required">
              <div role="group" aria-label="Platform" className="inline-flex overflow-hidden rounded-none border border-input">
                {(['CUEVERSE', 'YAHOO'] as const).map((pf) => (
                  <button
                    key={pf}
                    type="button"
                    aria-pressed={platform === pf}
                    onClick={() => {
                      setPlatform(pf)
                      // Yahoo history all belongs to 8BRCAM; offer it rather than make them find it.
                      if (pf === 'YAHOO') {
                        const canonical = competitions.find((c) => c.slug === '8brcam')
                        if (canonical) setCompetitionSeriesId(canonical.id)
                      }
                    }}
                    className={
                      'px-3 py-1.5 text-sm transition-colors '
                      + (platform === pf ? 'bg-[var(--gold)] font-semibold text-black' : 'text-muted-foreground hover:text-foreground')
                    }
                  >
                    {pf === 'CUEVERSE' ? 'CueVerse' : 'Yahoo'}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                New Seasons are CueVerse. Yahoo files a Season into the historical archive.
              </p>
            </Labeled>
            <Labeled label="Competition" hint="required">
              <CompetitionSelect
                competitions={competitions}
                value={competitionSeriesId}
                onChange={(id) => setCompetitionSeriesId(id)}
                inputClassName={input}
              />
            </Labeled>
            <Labeled label="Season Number" hint="required">
              <input
                type="number"
                inputMode="numeric"
                value={seasonNumber}
                onChange={(e) => { setNumberTouched(true); setSeasonNumber(e.target.value); setNumberError(null) }}
                min={1}
                step={1}
                className={cn(input, 'max-w-[140px]', numberError && 'border-destructive')}
                aria-describedby="season-number-hint"
                aria-invalid={numberError ? true : undefined}
              />
              <p id="season-number-hint" className="mt-1 text-[0.7rem] text-muted-foreground/70">
                {numberTouched
                  ? 'Set by you — changing the Competition or year will not overwrite it.'
                  : 'Suggested from the highest number this Competition has used in this year.'}
                {' '}Only has to be unique within this Competition and year.
              </p>
              {numberError && <p role="alert" className="mt-1 text-[0.7rem] text-destructive">{numberError}</p>}
            </Labeled>
            <Labeled label="Custom subtitle" hint="optional">
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. The Winter Classic" maxLength={80} className={input} />
            </Labeled>
            <Labeled label="Description / announcement" hint="optional">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={600} placeholder="Shown on the Season page." className={cn(input, 'resize-y')} />
            </Labeled>
          </div>
        </section>

        {/* Match format */}
        <section className="p-6">
          <p className={eyebrow}><Diamond className="size-3.5 fill-[var(--gold-soft)] text-[var(--gold-soft)]" aria-hidden /> Match Format</p>
          <p className="mt-1 text-xs text-muted-foreground">Intended match lengths / labels — never enforced as required winning scores.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <RaceField label="Group-stage games" value={groupStageGames} onChange={setGroupStageGames} />
            <RaceField label="Early playoff — Race To" value={earlyRaceTo} onChange={setEarlyRaceTo} />
            <RaceField label="Semifinal — Race To" value={semifinalRaceTo} onChange={setSemifinalRaceTo} />
            <RaceField label="Final — Race To" value={finalRaceTo} onChange={setFinalRaceTo} />
          </div>
        </section>

        {/* Basics */}
        <section className="p-6">
          <p className={eyebrow}><Diamond className="size-3.5 fill-[var(--gold-soft)] text-[var(--gold-soft)]" aria-hidden /> Basics</p>
          <div className="mt-4 space-y-4">
            <Labeled label="Lounge">
              <select value={lounge} onChange={(e) => setLounge(e.target.value)} className={input}>
                {LOUNGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Labeled>
            <Labeled label="Game room">
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
                <Lock className="size-3.5 text-muted-foreground/60" aria-hidden />
                <code className="font-mono text-[0.8rem] text-foreground">https://cueverse.gg/play/</code>
                <span className="ml-auto text-[0.65rem] uppercase tracking-wider text-muted-foreground/50">Fixed</span>
              </div>
            </Labeled>
          </div>
        </section>

        {/* Access */}
        <section className="p-6">
          <p className={eyebrow}><Diamond className="size-3.5 fill-[var(--gold-soft)] text-[var(--gold-soft)]" aria-hidden /> Registration Access</p>
          <Labeled label="Who can register" className="mt-4">
            <Segmented options={[{ v: 'OPEN', l: 'Open to all' }, { v: 'PASSWORD', l: 'Password required' }]} value={access} onChange={(v) => setAccess(v as 'OPEN' | 'PASSWORD')} />
          </Labeled>
          {access === 'PASSWORD' && (
            <Labeled label="Join password" className="mt-4">
              <input value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} placeholder="Players enter this to register" maxLength={64} className={cn(input, 'max-w-[300px]')} autoComplete="off" />
            </Labeled>
          )}
        </section>

        {/* Schedule */}
        <section className="p-6">
          <p className={eyebrow}><Diamond className="size-3.5 fill-[var(--gold-soft)] text-[var(--gold-soft)]" aria-hidden /> Registration Schedule</p>
          <Labeled label="When registration opens" className="mt-4">
            <Segmented options={[{ v: 'now', l: 'Open now' }, { v: 'later', l: 'Schedule for later' }]} value={scheduleLater ? 'later' : 'now'} onChange={(v) => setScheduleLater(v === 'later')} />
          </Labeled>
          {scheduleLater && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Labeled label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></Labeled>
              <Labeled label="Time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} /></Labeled>
            </div>
          )}
        </section>
      </div>

      {/* Review rail */}
      <div>
        <div className="sticky top-4 overflow-hidden cyber-clip border border-[var(--gold-dim)] bg-surface">
          <div className="border-b border-border/60 p-5">
            <h3 className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--gold)]">Review</h3>
            <p className="font-display text-lg font-bold text-foreground">{subtitle.trim() || officialTitle}</p>
            {subtitle.trim() && <p className="text-sm font-semibold text-[var(--gold)]">{officialTitle}</p>}
          </div>
          <dl className="px-5 py-1 text-sm">
            <Row k="Groups" v="Group-stage games " s={`${groupStageGames}`} />
            <Row k="Playoffs" v="Early / Semi / Final " s={`${earlyRaceTo}/${semifinalRaceTo}/${finalRaceTo}`} />
            <Row k="Participation" v="Individual (1v1)" />
            <Row k="Lounge" v={lounge} />
            <Row k="Access" v={access === 'PASSWORD' ? 'Password required' : 'Open to all'} />
            <Row k="Opens" v={scheduleLater ? (date ? `${date}${time ? ' ' + time : ''}` : 'Scheduled') : 'Now'} last />
          </dl>
          <div className="flex flex-col gap-2 p-5">
            {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <Button onClick={submit} disabled={pending} className="bg-[var(--gold)] text-black hover:bg-[var(--gold-soft)]">
              <Diamond className="size-4" /> {pending ? 'Creating…' : 'Create Season'}
            </Button>
            <p className="text-center text-[0.7rem] text-muted-foreground/60">A Season number is assigned automatically. Groups, qualifiers and bracket type are decided later.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function RaceField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Labeled label={label}>
      <div className="inline-flex items-center overflow-hidden rounded-none border border-input bg-card">
        <button type="button" onClick={() => onChange(Math.max(1, value - 1))} className="h-10 w-10 text-lg hover:bg-card-2">–</button>
        <input value={value} onChange={(e) => onChange(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} inputMode="numeric" className="h-10 w-14 border-x border-input bg-transparent text-center font-bold tabular-nums outline-none" aria-label={label} />
        <button type="button" onClick={() => onChange(Math.min(99, value + 1))} className="h-10 w-10 text-lg hover:bg-card-2">+</button>
      </div>
    </Labeled>
  )
}

function Labeled({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-[0.8rem] font-semibold text-foreground">
        {label} {hint && <span className="font-normal text-muted-foreground/60">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

function Segmented({ options, value, onChange }: { options: { v: string; l: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-none border border-input bg-card p-1">
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)} className={cn('rounded px-4 py-1.5 text-sm font-semibold transition-colors', value === o.v ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground')}>{o.l}</button>
      ))}
    </div>
  )
}

function Row({ k, v, s, last }: { k: string; v: string; s?: string; last?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3 py-2.5 text-sm', !last && 'border-b border-border/50')}>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-semibold">{v}{s && <span className="tabular-nums text-[var(--gold)]">{s}</span>}</dd>
    </div>
  )
}
