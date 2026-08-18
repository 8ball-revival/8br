'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Save, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { SeasonView } from '@/lib/seasons/service'
import type { CompetitionRef } from '@/lib/competitions/shared'
import { CompetitionSelect } from '@/components/competitions/competition-select'
import { COMPETITION_YEAR_MAX, COMPETITION_YEAR_MIN } from '@/lib/competition/competition-year'
import { updateSeasonSettingsAction, exportSeasonDataAction, deleteSeasonAction } from '@/lib/seasons/actions'

const input = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

/** Season Settings — lifecycle-aware. Registration access/schedule edit only before close; match
 *  format until playoffs begin (warned once live); after Close only identity/description/export. */
export function SeasonSettingsForm({ seasonId, view, isHeadAdmin, competitions }: { seasonId: number; view: SeasonView; isHeadAdmin: boolean; competitions: CompetitionRef[] }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const st = view.lifecycleState
  const regEditable = st === 'REGISTRATION_SCHEDULED' || st === 'REGISTRATION_OPEN'
  const formatEditable = !['PLAYOFF_SETUP', 'PLAYOFFS_LIVE', 'COMPLETED'].includes(st)
  const formatWarn = st === 'GROUP_STAGE_LIVE' || st === 'GROUPS_CLOSED'
  const completed = st === 'COMPLETED'

  const [competitionYear, setCompetitionYear] = useState(String(view.year))
  const [competitionSeriesId, setCompetitionSeriesId] = useState<number | null>(view.competition.id)
  const [subtitle, setSubtitle] = useState(view.subtitle ?? '')
  // Display identity only. Editable at any point in the lifecycle, a finished Season included —
  // renumbering changes a label, never a result.
  const [seasonNumber, setSeasonNumber] = useState(String(view.number))
  const [numberError, setNumberError] = useState<string | null>(null)
  const [description, setDescription] = useState(view.description ?? '')
  const [lounge, setLounge] = useState(view.lounge)
  const [access, setAccess] = useState(view.accessMode === 'PASSWORD' ? 'PASSWORD' : 'OPEN')
  const [joinPassword, setJoinPassword] = useState('')
  const [fmt, setFmt] = useState(view.format)

  // The official title is derived, so the preview follows Competition, number and year as they are
  // edited — the administrator sees the new name before saving it.
  const competitionName =
    competitions.find((c) => c.id === competitionSeriesId)?.name ?? view.competition.name
  const previewTitle =
    `${competitionName} Season ${seasonNumber.trim() === '' ? '—' : seasonNumber.trim()} · ${competitionYear}`

  const save = async () => {
    if (formatWarn) {
      const res = await confirm({ title: 'Change the match format?', message: 'The group stage is already live. Changing the match format now affects the displayed labels for matches still to be played.', confirmLabel: 'Change Format', tone: 'warning' })
      if (!res.confirmed) return
    }
    start(async () => {
      const r = await updateSeasonSettingsAction(seasonId, {
        competitionYear: Number(competitionYear), competitionSeriesId,
        number: Number(seasonNumber),
        subtitle, description, ...(completed ? {} : { lounge }),
        ...(regEditable ? { accessMode: access as 'OPEN' | 'PASSWORD', joinPassword: access === 'PASSWORD' ? joinPassword : null } : {}),
        ...(formatEditable ? { groupStageGames: fmt.groupStageGames, earlyRaceTo: fmt.earlyRaceTo, semifinalRaceTo: fmt.semifinalRaceTo, finalRaceTo: fmt.finalRaceTo } : {}),
      })
      if (r.error && r.suggestion != null) {
        setNumberError(r.error)
        setSeasonNumber(String(r.suggestion))
        setMsg(null)
        return
      }
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' })
      if (!r.error) router.refresh()
    })
  }

  const exportData = () => start(async () => {
    const r = await exportSeasonDataAction(seasonId)
    if (r.error || !r.data) { setMsg({ ok: false, text: r.error ?? 'Export failed.' }); return }
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `8br-season-${view.number}.json`; a.click(); URL.revokeObjectURL(url)
  })

  return (
    <div className="max-w-2xl space-y-6">
      {msg && <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>}

      <Section title="Identity">
        <Field label="Competition Year">
          <input type="number" inputMode="numeric" value={competitionYear} onChange={(e) => setCompetitionYear(e.target.value)} min={COMPETITION_YEAR_MIN} max={COMPETITION_YEAR_MAX} step={1} className={input} />
        </Field>
        <Field label="Competition">
          <CompetitionSelect competitions={competitions} value={competitionSeriesId} onChange={(id) => setCompetitionSeriesId(id)} inputClassName={input} />
        </Field>
        <Field label="Season Number">
          <input
            type="number"
            inputMode="numeric"
            value={seasonNumber}
            onChange={(e) => { setSeasonNumber(e.target.value); setNumberError(null) }}
            min={1}
            step={1}
            className={cn(input, numberError && 'border-destructive')}
            aria-invalid={numberError ? true : undefined}
          />
          <p className="mt-1 text-[0.7rem] text-muted-foreground/70">
            Only has to be unique within this Competition and year. Changing it renames the Season —
            it does not touch groups, playoffs, results or rankings.
          </p>
          {numberError && <p role="alert" className="mt-1 text-[0.7rem] text-destructive">{numberError}</p>}
        </Field>
        <div className="rounded-md border border-[var(--gold-dim)]/50 bg-[var(--gold)]/[0.05] px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">Official title: </span>
          <span className="font-display font-bold text-[var(--gold-soft)]">{previewTitle}</span>
        </div>
        <Field label="Custom subtitle"><input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={80} className={input} /></Field>
        <Field label="Description / announcement"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={600} className={cn(input, 'resize-y')} /></Field>
      </Section>

      {!completed && (
        <Section title="Basics">
          <Field label="Lounge"><input value={lounge} onChange={(e) => setLounge(e.target.value)} className={input} /></Field>
        </Section>
      )}

      {regEditable && (
        <Section title="Registration access & schedule">
          <Field label="Access">
            <div className="inline-flex gap-1 rounded-md border border-input bg-card p-1">
              {['OPEN', 'PASSWORD'].map((v) => <button key={v} type="button" onClick={() => setAccess(v)} className={cn('rounded px-3 py-1.5 text-sm font-semibold', access === v ? 'bg-brand text-white' : 'text-muted-foreground')}>{v === 'OPEN' ? 'Open' : 'Password'}</button>)}
            </div>
          </Field>
          {access === 'PASSWORD' && <Field label="New join password"><input value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} className={cn(input, 'max-w-[280px]')} placeholder="Leave blank to keep current" autoComplete="off" /></Field>}
        </Section>
      )}

      <Section title={`Match format${formatEditable ? '' : ' (locked)'}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          {([['Group-stage games', 'groupStageGames'], ['Early Race To', 'earlyRaceTo'], ['Semifinal Race To', 'semifinalRaceTo'], ['Final Race To', 'finalRaceTo']] as const).map(([label, key]) => (
            <Field key={key} label={label}>
              <input type="number" min={1} max={99} disabled={!formatEditable} value={fmt[key]} onChange={(e) => setFmt((f) => ({ ...f, [key]: Math.max(1, Math.min(99, Number(e.target.value) || 1)) }))} className={cn(input, 'max-w-[120px]', !formatEditable && 'opacity-50')} />
            </Field>
          ))}
        </div>
        {formatWarn && <p className="mt-2 text-xs text-amber-500">Changing the match format after the group stage is live requires confirmation.</p>}
      </Section>

      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={save}><Save className="size-4" /> Save settings</Button>
        <Button variant="outline" disabled={pending} onClick={exportData}><Download className="size-4" /> Export Season Data</Button>
      </div>

      <DangerZone seasonId={seasonId} completed={completed} isHeadAdmin={isHeadAdmin} />
    </div>
  )
}

function DangerZone({ seasonId, completed, isHeadAdmin }: { seasonId: number; completed: boolean; isHeadAdmin: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const canDelete = completed ? isHeadAdmin : true

  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/[0.04] p-4">
      <h3 className="text-sm font-bold text-destructive">Danger Zone</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Permanently delete this Season and everything in it (entrants, groups, results, standings, bracket
        {completed ? ', and reverse its ranking updates + remove its Season Championship award' : ''}).
        {completed && !isHeadAdmin ? ' A completed Season can only be deleted by the Head Admin.' : ''} This cannot be undone.
      </p>
      {canDelete && (
        <div className="mt-3">
          <Button
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={async () => {
              const res = await confirm({
                title: 'Permanently Delete Season?',
                message: (
                  <div>
                    <p>This permanently removes the Season and everything in it: entrants, rating snapshots, groups, all results and statuses, standings, qualification decisions, the playoff bracket{completed ? ', and it reverses the ranking updates + removes the Season Championship award' : ''}.</p>
                    <p className="mt-1.5 font-semibold text-destructive">This cannot be undone.</p>
                  </div>
                ),
                confirmLabel: 'Permanently Delete',
                tone: 'danger',
                input: { label: 'Enter your admin password to confirm', placeholder: 'Your password', password: true, required: true },
                action: async (value) => deleteSeasonAction(seasonId, value),
              })
              if (res.confirmed) router.push('/seasons')
            }}
          >
            <Trash2 className="size-4" /> Permanently Delete Season
          </Button>
        </div>
      )}
    </section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 rounded-lg border border-border bg-card/40 p-4"><h3 className="text-sm font-semibold text-foreground">{title}</h3>{children}</section>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1.5 block text-[0.8rem] font-semibold text-foreground">{label}</label>{children}</div>
}
