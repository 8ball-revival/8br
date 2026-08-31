'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Lock, Sparkles, Check } from 'lucide-react'

import { cn } from '@/lib/utils'
import { COMPETITION_YEAR_MAX, COMPETITION_YEAR_MIN, currentCompetitionYear } from '@/lib/competition/competition-year'
import { Button } from '@/components/ui/button'
import { createTournamentAction, saveFlairDefaultAction, getFlairDefaultAction } from '@/lib/competition/tournament-actions'
import type { CreateTournamentConfig } from '@/lib/competition/tournament-create'
import { FlairEditor, FlairPreview, EMPTY_FLAIR, type FlairValue } from '@/components/tournaments/flair-editor'
import { GROUPS_PLAYOFFS_FORMAT_SUMMARY } from '@/lib/competition/match-format'

/*
 * Groups + Playoffs is a Tournament format.
 *
 * It is not the annual Season Championship, which lives at /seasons and stays there. This is a
 * one-off event that happens to run groups before its bracket — the shape the first 8BR Tournament
 * had — and filing it as a Season would put it under Season Championships and Season W-L.
 */
type Format = 'SINGLE_ELIM' | 'DOUBLE_ELIM' | 'GROUPS_PLAYOFFS' | 'SWISS'
const LOUNGES = ['Social', "Beginner's Lounge", 'Intermediate Lounge', 'Advanced Lounge']
const FMT_LABEL: Record<Format, string> = {
  SINGLE_ELIM: 'Single Elimination',
  DOUBLE_ELIM: 'Double Elimination',
  GROUPS_PLAYOFFS: 'Groups + Playoffs',
  SWISS: 'Swiss System',
}

/** The bracket a field of N needs: the next power of two, at least 2. Mirrors recommendedBracketSize. */
const nextPow2 = (n: number) => (n <= 2 ? 2 : 2 ** Math.ceil(Math.log2(n)))

const input = 'w-full rounded-none border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'
const eyebrow = 'flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand'

export interface CompetitionChoice {
  id: number
  name: string
  shortName: string
  active: boolean
}

export function CreateTournamentForm({ competitions }: { competitions: CompetitionChoice[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  /*
   * Which Competition this Tournament belongs to.
   *
   * Deliberately starts EMPTY rather than pre-selecting the first row. A pre-filled required field
   * is one nobody reads, and the whole point of asking is that two Tournaments can share a title
   * under different Competitions — a silent default would file them together.
   */
  /* CueVerse by default; Yahoo files the Tournament into the historical archive. */
  const [platform, setPlatform] = useState<'CUEVERSE' | 'YAHOO'>('CUEVERSE')
  const [competitionSeriesId, setCompetitionSeriesId] = useState('')
  // Competition Year defaults to the current calendar year; the server re-validates the range.
  const [competitionYear, setCompetitionYear] = useState(String(currentCompetitionYear()))
  const [race, setRace] = useState(7)
  const [lounge, setLounge] = useState('Social')

  const [format, setFormat] = useState<Format>('SINGLE_ELIM')
  const [swissRounds, setSwissRounds] = useState(4)

  // Groups + Playoffs only. Defaults describe the commonest shape rather than a rule: four groups,
  // top two through, single-elimination after. Every one is editable, and the bracket size is only
  // ever a recommendation — the real field is not known until the groups finish.
  const [groupCount, setGroupCount] = useState(4)
  const [qualifiersPerGroup, setQualifiersPerGroup] = useState(2)
  const [playoffDoubleElim, setPlayoffDoubleElim] = useState(false)
  const [playoffSeeding, setPlayoffSeeding] = useState<'standing' | 'random' | 'manual'>('standing')

  const [participant, setParticipant] = useState<'INDIVIDUAL' | 'TEAM'>('INDIVIDUAL')
  const [teamSize, setTeamSize] = useState(2)
  const [teamFormation, setTeamFormation] = useState<'PICK' | 'RANDOM'>('PICK')

  const [access, setAccess] = useState<'OPEN' | 'PASSWORD'>('OPEN')
  const [joinPassword, setJoinPassword] = useState('')

  const [scheduleLater, setScheduleLater] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('19:00')

  const [flair, setFlair] = useState<FlairValue>(EMPTY_FLAIR)
  const [savedDefault, setSavedDefault] = useState(false)

  // Prefill with this admin's saved default flair, if any.
  useEffect(() => {
    let live = true
    getFlairDefaultAction().then((d) => { if (live && d) setFlair({ description: d.description ?? null, badge: d.badge ?? null }) }).catch(() => {})
    return () => { live = false }
  }, [])

  const summary = useMemo(() => {
    let fmt: string = FMT_LABEL[format]
    if (format === 'SWISS') fmt += ` · ${swissRounds} rounds`
    if (format === 'GROUPS_PLAYOFFS') {
      fmt += ` · ${groupCount} group${groupCount === 1 ? '' : 's'}, top ${qualifiersPerGroup}`
    }
    return { fmt }
  }, [format, swissRounds, groupCount, qualifiersPerGroup])

  const submit = () => {
    setError(null)
    if (!name.trim()) return setError('Give the Tournament a name.')
    if (!competitionSeriesId) return setError('Choose a Competition.')
    if (access === 'PASSWORD' && joinPassword.trim().length < 4) return setError('Set a join password of at least 4 characters.')
    if (scheduleLater && !date) return setError('Pick a date for the scheduled start.')

    const cfg: CreateTournamentConfig = {
      name: name.trim(),
      competitionYear,
      competitionSeriesId,
      platform,
      participantFormat: participant,
      teamSize: participant === 'TEAM' ? teamSize : null,
      teamFormation: participant === 'TEAM' ? teamFormation : undefined,
      tournamentFormat: format,
      raceLength: race,
      lounge,
      accessMode: access,
      joinPassword: access === 'PASSWORD' ? joinPassword.trim() : null,
      scheduleForLater: scheduleLater,
      scheduledStartAt: scheduleLater ? `${date}T${time || '00:00'}` : null,
      swissRounds: format === 'SWISS' ? swissRounds : null,
      // Sent only for the format that uses them, so no other format's record gains a group setting.
      ...(format === 'GROUPS_PLAYOFFS'
        ? { groupCount, qualifiersPerGroup, playoffDoubleElim, playoffSeeding }
        : {}),
      flair,
    }
    start(async () => {
      const r = await createTournamentAction(cfg)
      if (r.error || !r.number) return setError(r.error ?? 'Could not create the Tournament.')
      router.push(`/tournaments/${r.number}`)
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* ---- form ---- */}
      <div className="divide-y divide-border/60 overflow-hidden rounded-none border border-border bg-surface">
        {/* Format — only the four main format choices (format-specific settings live in Configuration). */}
        <section className="p-6">
          <p className={eyebrow}><span className="text-muted-foreground/50">01</span> Format</p>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            <Choice active={format === 'SINGLE_ELIM'} onClick={() => setFormat('SINGLE_ELIM')} title="Single Elimination" body="One loss and you're out" />
            <Choice active={format === 'DOUBLE_ELIM'} onClick={() => setFormat('DOUBLE_ELIM')} title="Double Elimination" body="Winners + losers bracket" />
            <Choice active={format === 'GROUPS_PLAYOFFS'} onClick={() => setFormat('GROUPS_PLAYOFFS')} title="Groups + Playoffs" body="Round-robin groups into a bracket" />
            <Choice active={format === 'SWISS'} onClick={() => setFormat('SWISS')} title="Swiss System" body="Fixed rounds, no elimination" />
          </div>
        </section>

        {/* Configuration — settings specific to the selected format only (progressive disclosure). */}
        <section className="p-6">
          <p className={eyebrow}><span className="text-muted-foreground/50">02</span> Configuration</p>
          <div className="mt-4 space-y-4">
            {(format === 'SINGLE_ELIM' || format === 'DOUBLE_ELIM') && (
              <p className="text-sm text-muted-foreground">No additional settings for {FMT_LABEL[format]}.</p>
            )}

            {/* Shown only for Groups + Playoffs — every other format is unchanged by its presence. */}
            {format === 'GROUPS_PLAYOFFS' && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Labeled label="Number of groups">
                    <select value={groupCount} onChange={(e) => setGroupCount(Number(e.target.value))} className={cn(input, 'max-w-[140px]')}>
                      {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Created empty. You place entrants into them yourself before the group stage starts.
                    </p>
                  </Labeled>
                  <Labeled label="Advancing per group">
                    <select value={qualifiersPerGroup} onChange={(e) => setQualifiersPerGroup(Number(e.target.value))} className={cn(input, 'max-w-[140px]')}>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      The calculated qualifiers. You can override who goes through before the bracket is built.
                    </p>
                  </Labeled>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Labeled label="Playoff bracket">
                    <select value={playoffDoubleElim ? 'de' : 'se'} onChange={(e) => setPlayoffDoubleElim(e.target.value === 'de')} className={input}>
                      <option value="se">Single elimination</option>
                      <option value="de">Double elimination</option>
                    </select>
                  </Labeled>
                  <Labeled label="Playoff seeding">
                    <select value={playoffSeeding} onChange={(e) => setPlayoffSeeding(e.target.value as typeof playoffSeeding)} className={input}>
                      <option value="standing">By group standing</option>
                      <option value="random">Random draw</option>
                      <option value="manual">Manual — I will place them</option>
                    </select>
                  </Labeled>
                </div>

                <div className="rounded-none border border-border bg-card/60 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    <b className="text-foreground">Recommended bracket: {nextPow2(groupCount * qualifiersPerGroup)} places</b>
                    {' '}for {groupCount * qualifiersPerGroup} qualifiers ({groupCount} × {qualifiersPerGroup}).
                    The bracket is sized from the field you actually confirm, so this is a guide, not a
                    setting — withdrawals and overrides can change it before the playoffs are built.
                  </p>
                </div>

                <div className="rounded-none border border-border bg-card/60 px-3 py-2.5">
                  <p className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Match format</p>
                  <dl className="space-y-0.5">
                    {GROUPS_PLAYOFFS_FORMAT_SUMMARY.map((r) => (
                      <div key={r.stage} className="flex justify-between text-xs">
                        <dt className="text-muted-foreground">{r.stage}</dt>
                        <dd className="font-medium text-foreground">{r.format}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            )}

            {format === 'SWISS' && (
              <Labeled label="Number of rounds">
                <select value={swissRounds} onChange={(e) => setSwissRounds(Number(e.target.value))} className={cn(input, 'max-w-[140px]')}>
                  {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <p className="mt-1.5 text-xs text-muted-foreground">Everyone plays every round; standings and pairings update each round.</p>
              </Labeled>
            )}
          </div>
        </section>

        {/* Basics */}
        <section className="p-6">
          <p className={eyebrow}><span className="text-muted-foreground/50">03</span> Basics</p>
          <div className="mt-4 space-y-4">
            <Labeled label="Tournament name" hint="required">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 8BR Winter Open" maxLength={80} className={input} />
            </Labeled>
            {/* Before Competition, because it decides which one is the sensible default. Secondary
                by design: a Tournament is identified by its name and its Competition. */}
            <Labeled label="Platform" hint="required">
              <div role="group" aria-label="Platform" className="inline-flex overflow-hidden rounded-none border border-input">
                {(['CUEVERSE', 'YAHOO'] as const).map((pf) => (
                  <button
                    key={pf}
                    type="button"
                    aria-pressed={platform === pf}
                    onClick={() => {
                      setPlatform(pf)
                      if (pf === 'YAHOO') {
                        /* Matched on the stored short name: this choice type carries no slug, and
                           8BRCAM is the Competition every Yahoo record belongs to. */
                        const canonical = competitions.find((c) => c.shortName.toUpperCase() === '8BRCAM')
                        if (canonical) setCompetitionSeriesId(String(canonical.id))
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
                New Tournaments are CueVerse. Yahoo files one into the historical archive.
              </p>
            </Labeled>
            <Labeled label="Competition" hint="required">
              <select
                value={competitionSeriesId}
                onChange={(e) => setCompetitionSeriesId(e.target.value)}
                className={input}
                required
                aria-describedby="competition-hint"
              >
                <option value="">Choose a Competition…</option>
                {competitions.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}{c.active ? '' : ' (retired)'}
                  </option>
                ))}
              </select>
              <p id="competition-hint" className="mt-1 text-[0.7rem] text-muted-foreground/70">
                Which Competition this Tournament belongs to. Two Tournaments may share a name under
                different Competitions — this is what tells them apart.
              </p>
            </Labeled>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Labeled label="Match format">
                <div className="inline-flex items-center overflow-hidden rounded-none border border-input bg-card">
                  <button type="button" onClick={() => setRace((v) => Math.max(1, v - 1))} className="h-10 w-10 text-lg hover:bg-card-2">–</button>
                  <input value={race} onChange={(e) => setRace(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} inputMode="numeric" className="h-10 w-14 border-x border-input bg-transparent text-center font-bold tabular-nums outline-none" aria-label="Race to" />
                  <button type="button" onClick={() => setRace((v) => Math.min(99, v + 1))} className="h-10 w-10 text-lg hover:bg-card-2">+</button>
                  <span className="px-3 text-sm text-muted-foreground">Race to <b className="text-foreground">{race}</b></span>
                </div>
              </Labeled>
              <Labeled label="Lounge">
                <select value={lounge} onChange={(e) => setLounge(e.target.value)} className={input}>
                  {LOUNGES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Labeled>
            </div>
            <Labeled label="Game room">
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
                <Lock className="size-3.5 text-muted-foreground/60" aria-hidden />
                <code className="font-mono text-[0.8rem] text-foreground">https://cueverse.gg/play/</code>
                <span className="ml-auto text-[0.65rem] uppercase tracking-wider text-muted-foreground/50">Fixed</span>
              </div>
            </Labeled>
          </div>
        </section>

        {/* Participants */}
        <section className="p-6">
          <p className={eyebrow}><span className="text-muted-foreground/50">04</span> Participants</p>
          <Labeled label="Who competes" className="mt-4">
            <Segmented
              options={[{ v: 'INDIVIDUAL', l: 'Individual (1v1)' }, { v: 'TEAM', l: 'Teams' }]}
              value={participant}
              onChange={(v) => setParticipant(v as 'INDIVIDUAL' | 'TEAM')}
            />
          </Labeled>
          {participant === 'TEAM' && (
            <Reveal>
              <Labeled label="Players per team">
                <Segmented options={[2, 3, 4, 5, 6].map((n) => ({ v: String(n), l: String(n) }))} value={String(teamSize)} onChange={(v) => setTeamSize(Number(v))} />
              </Labeled>
              <Labeled label="How teams form" className="mt-4">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Choice active={teamFormation === 'PICK'} onClick={() => setTeamFormation('PICK')} title="Players pick their roster" body="A captain selects teammates from registered accounts" />
                  <Choice active={teamFormation === 'RANDOM'} onClick={() => setTeamFormation('RANDOM')} title="Random draw" body="Everyone registers solo; teams are shuffled when registration closes" />
                </div>
              </Labeled>
            </Reveal>
          )}
        </section>

        {/* Access */}
        <section className="p-6">
          <p className={eyebrow}><span className="text-muted-foreground/50">05</span> Access</p>
          <Labeled label="Who can register" className="mt-4">
            <Segmented
              options={[{ v: 'OPEN', l: 'Open to all' }, { v: 'PASSWORD', l: 'Password required' }]}
              value={access}
              onChange={(v) => setAccess(v as 'OPEN' | 'PASSWORD')}
            />
          </Labeled>
          {access === 'PASSWORD' && (
            <Reveal>
              <Labeled label="Join password">
                <input value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} placeholder="Players enter this to register" maxLength={64} className={cn(input, 'max-w-[300px]')} autoComplete="off" />
                <p className="mt-1.5 text-xs text-muted-foreground">Admins can always add players manually, regardless of this setting.</p>
              </Labeled>
            </Reveal>
          )}
        </section>

        {/* Schedule */}
        <section className="p-6">
          <p className={eyebrow}><span className="text-muted-foreground/50">06</span> Schedule</p>
          <Labeled label="When registration opens" className="mt-4">
            <Segmented
              options={[{ v: 'now', l: 'Start now' }, { v: 'later', l: 'Schedule for later' }]}
              value={scheduleLater ? 'later' : 'now'}
              onChange={(v) => setScheduleLater(v === 'later')}
            />
          </Labeled>
          {scheduleLater && (
            <Reveal>
              <div className="grid gap-4 sm:grid-cols-2">
                <Labeled label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></Labeled>
                <Labeled label="Time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} /></Labeled>
              </div>
            </Reveal>
          )}
          <p className="mt-3 text-xs text-muted-foreground">“Start now” opens registration immediately — you advance it through close → bracket → begin yourself. Tournaments stay open as long as needed.</p>
        </section>

        {/* Flair */}
        <section className="p-6">
          <p className={eyebrow}><span className="text-muted-foreground/50">07</span> Flair <span className="font-normal normal-case tracking-normal text-muted-foreground/60">— optional, on-brand</span></p>
          <div className="mt-4">
            <FlairEditor value={flair} onChange={setFlair} />
          </div>
        </section>
      </div>

      {/* ---- review rail ---- */}
      <div>
        <div className="sticky top-4 overflow-hidden rounded-none border border-border bg-surface">
          <div className="border-b border-border/60 p-5">
            <h3 className="mb-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live preview</h3>
            <FlairPreview value={flair} name={name} />
          </div>
          <div className="border-b border-border/60 p-5">
            <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Review</h3>
            <p className={cn('mt-2 text-lg font-bold', name.trim() ? 'text-foreground' : 'text-muted-foreground/60')}>{name.trim() || 'Untitled Tournament'}</p>
            <span className="mt-2.5 inline-flex items-center gap-1.5 cyber-clip-sm border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
              <span className="size-1.5 rounded-full bg-success" /> Reports to Rankings
            </span>
          </div>
          <dl className="px-5 py-1 text-sm">
            <Row k="Format" v={summary.fmt} />
            <Row k="Match" v={`Race to ${race}`} />
            <Row k="Participants" v={participant === 'TEAM' ? `Teams of ${teamSize}` : 'Individual (1v1)'} />
            {participant === 'TEAM' && <Row k="Team draw" v={teamFormation === 'RANDOM' ? 'Random draw' : 'Pick roster'} />}
            <Row k="Lounge" v={lounge} />
            <Row k="Access" v={access === 'PASSWORD' ? 'Password required' : 'Open to all'} />
            <Row k="Starts" v={scheduleLater ? (date ? `${date}${time ? ' ' + time : ''}` : 'Scheduled') : 'Now'} last />
          </dl>
          <div className="flex flex-col gap-2 p-5">
            {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <Button onClick={submit} disabled={pending}>
              <Users className="size-4" /> {pending ? 'Creating…' : 'Create Tournament'}
            </Button>
            <button
              type="button"
              onClick={() => { setSavedDefault(false); saveFlairDefaultAction(flair).then((r) => { if (!r.error) setSavedDefault(true) }) }}
              className="inline-flex items-center justify-center gap-1.5 rounded-none border border-input py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {savedDefault ? (<><Check className="size-3.5 text-success" /> Saved as your default</>) : (<><Sparkles className="size-3.5" /> Save flair as my default</>)}
            </button>
            <p className="text-center text-[0.7rem] text-muted-foreground/60">A Tournament number + code are assigned automatically.</p>
          </div>
        </div>
      </div>
    </div>
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

function Reveal({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 border-l-2 border-brand pl-4">{children}</div>
}

function Choice({ active, onClick, title, body }: { active: boolean; onClick: () => void; title: string; body: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative cyber-clip border p-3 pl-10 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        active ? 'border-brand bg-[var(--selected-surface)]' : 'border-border bg-card hover:border-border/70',
      )}
    >
      <span className={cn('absolute left-3.5 top-3.5 size-4 rounded-full border-2', active ? 'border-brand shadow-[inset_0_0_0_3px_var(--color-brand)]' : 'border-border')} />
      <span className="block text-sm font-semibold text-foreground">{title}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
    </button>
  )
}

function Segmented({ options, value, onChange }: { options: { v: string; l: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-none border border-input bg-card p-1">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn('rounded px-4 py-1.5 text-sm font-semibold transition-colors', value === o.v ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

function Row({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3 py-2.5 text-sm', !last && 'border-b border-border/50')}>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-semibold">{v}</dd>
    </div>
  )
}
