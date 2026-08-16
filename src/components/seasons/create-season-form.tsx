'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Diamond, Lock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { createSeasonAction } from '@/lib/seasons/actions'
import type { CreateSeasonConfig } from '@/lib/seasons/service'

const LOUNGES = ['Social', "Beginner's Lounge", 'Intermediate Lounge', 'Advanced Lounge']
const input = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'
const eyebrow = 'flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-[#d6ae42]'

/** Create Season — the standalone Season creation form (individual 1v1 only, no format selector, no
 *  groups/qualifiers/bracket-type decisions; those happen later in the Season lifecycle). */
export function CreateSeasonForm({ nextNumber, year }: { nextNumber: number; year: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [subtitle, setSubtitle] = useState('')
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

  const officialTitle = useMemo(() => `8BR Season ${nextNumber} · ${year}`, [nextNumber, year])

  const submit = () => {
    setError(null)
    if (access === 'PASSWORD' && joinPassword.trim().length < 4) return setError('Set a join password of at least 4 characters.')
    if (scheduleLater && !date) return setError('Pick a date for the scheduled registration opening.')

    const cfg: CreateSeasonConfig = {
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
      if (r.error || !r.number) return setError(r.error ?? 'Could not create the Season.')
      router.push(`/seasons/${r.number}`)
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-[#8a6d24] bg-surface">
        {/* Identity */}
        <section className="p-6">
          <p className={eyebrow}><Diamond className="size-3.5 fill-[#e6c463] text-[#e6c463]" aria-hidden /> Season Identity</p>
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-[#8a6d24]/50 bg-[#d6ae42]/[0.05] px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">Official title: </span>
              <span className="font-display font-bold text-[#e6c463]">{officialTitle}</span>
              <p className="mt-1 text-[0.7rem] text-muted-foreground/70">Assigned automatically from the sequence and year.</p>
            </div>
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
          <p className={eyebrow}><Diamond className="size-3.5 fill-[#e6c463] text-[#e6c463]" aria-hidden /> Match Format</p>
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
          <p className={eyebrow}><Diamond className="size-3.5 fill-[#e6c463] text-[#e6c463]" aria-hidden /> Basics</p>
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
          <p className={eyebrow}><Diamond className="size-3.5 fill-[#e6c463] text-[#e6c463]" aria-hidden /> Registration Access</p>
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
          <p className={eyebrow}><Diamond className="size-3.5 fill-[#e6c463] text-[#e6c463]" aria-hidden /> Registration Schedule</p>
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
        <div className="sticky top-4 overflow-hidden rounded-xl border border-[#8a6d24] bg-surface">
          <div className="border-b border-border/60 p-5">
            <h3 className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[#d6ae42]">Review</h3>
            <p className="font-display text-lg font-bold text-[#f5f1e6]">{subtitle.trim() || officialTitle}</p>
            {subtitle.trim() && <p className="text-sm font-semibold text-[#d6ae42]">{officialTitle}</p>}
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
            <Button onClick={submit} disabled={pending} className="bg-[#d6ae42] text-black hover:bg-[#e6c463]">
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
      <div className="inline-flex items-center overflow-hidden rounded-md border border-input bg-card">
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
    <div className="inline-flex flex-wrap gap-1 rounded-md border border-input bg-card p-1">
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
      <dd className="text-right font-semibold">{v}{s && <span className="tabular-nums text-[#d6ae42]">{s}</span>}</dd>
    </div>
  )
}
