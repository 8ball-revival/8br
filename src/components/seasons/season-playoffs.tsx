'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Bracket } from '@/components/tournaments/bracket'
import { SeasonLiveBracket } from '@/components/seasons/season-live-bracket'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { BracketRound } from '@/lib/tournaments/service'
import type { SeasonSeedRow } from '@/lib/seasons/playoffs'
import {
  setSeasonQualificationAction, setSeasonPlayoffTypeAction, generateSeasonBracketAction,
  startSeasonPlayoffsAction, closeSeasonAction,
} from '@/lib/seasons/actions'

const QUAL_LABEL: Record<string, string> = { AUTOMATIC: 'Automatic Qualifier', WILDCARD: 'Wildcard', DISQUALIFIED: 'Disqualified', KICKED_OUT: 'Kicked Out', NOT_SELECTED: 'Not Selected' }

/** Playoff setup (locked seeding + selection + generate/start) OR the live public bracket with inline
 *  admin score entry. */
export function SeasonPlayoffs({
  seasonId, phase, seeding, rounds, doubleElim, hasDraft, canManage, canClose,
}: {
  seasonId: number
  phase: 'setup' | 'live'
  seeding: SeasonSeedRow[]
  rounds: BracketRound[]
  doubleElim: boolean
  hasDraft: boolean
  canManage: boolean
  canClose: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' }); router.refresh() })

  if (phase === 'live') {
    return (
      <div className="mt-8 space-y-6">
        {msg && <Toast msg={msg} />}
        {rounds.length > 0 ? <SeasonLiveBracket rounds={rounds} canManage={canManage} /> : <p className="text-sm text-muted-foreground">The bracket is being prepared.</p>}
        {canManage && canClose && (
          <div className="border-t border-border pt-4">
            <Button className="bg-[var(--gold)] text-black hover:bg-[var(--gold-soft)]" disabled={pending} onClick={async () => {
              const res = await confirm({
                title: 'Close Season & Crown Champion?',
                message: 'This crowns the champion, locks all group and playoff results, applies the Ladder ranking update (genuinely-played matches only — FF/KO/voided/no-contest excluded), and awards the Season Championship.',
                confirmLabel: 'Close Season', cancelLabel: 'Not yet', tone: 'warning',
                action: async () => closeSeasonAction(seasonId),
              })
              if (res.confirmed) router.refresh()
            }}>Close Season & Crown Champion</Button>
          </div>
        )}
        {canManage && !canClose && <p className="text-xs text-muted-foreground">Close Season becomes available once the final has a winner.</p>}
      </div>
    )
  }

  // --- setup ---
  return (
    <div className="mt-8 space-y-5">
      {msg && <Toast msg={msg} />}
      {canManage && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/40 p-4">
          <span className="text-sm font-semibold text-foreground">Playoff bracket:</span>
          <div className="inline-flex gap-1 rounded-md border border-input bg-card p-1">
            {[{ v: false, l: 'Single elim' }, { v: true, l: 'Double elim' }].map((o) => (
              <button key={String(o.v)} disabled={pending} onClick={() => run(() => setSeasonPlayoffTypeAction(seasonId, o.v))} className={cn('rounded px-4 py-1.5 text-sm font-semibold', doubleElim === o.v ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground')}>{o.l}</button>
            ))}
          </div>
          <Button size="sm" className="ml-auto" disabled={pending} onClick={() => run(() => generateSeasonBracketAction(seasonId))}>{hasDraft ? 'Regenerate Bracket' : 'Generate Bracket'}</Button>
        </div>
      )}

      {canManage && hasDraft && rounds.length > 0 && (
        <div className="rounded-lg border border-brand/30 bg-card/40 p-4">
          <p className="eyebrow mb-3 text-muted-foreground">Draft bracket (private preview)</p>
          <div className="w-full"><Bracket rounds={rounds} fluid /></div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-border bg-card/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-center">Seed</th><th className="px-2 py-2">Player</th><th className="px-2 py-2">Group</th>
              <th className="px-2 py-2 text-center">Pos</th><th className="px-2 py-2 text-center">Pts</th><th className="px-2 py-2 text-center">Record</th>
              <th className="px-2 py-2">Qualification</th>{canManage && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {seeding.map((r) => (
              <tr key={r.entrantId} className="border-b border-border/50">
                <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-[var(--gold-soft)]">{r.overallSeed ?? '—'}</td>
                <td className="px-2 py-1.5">{r.name}{r.cueverseId && r.cueverseId !== r.name && <span className="ml-1.5 text-xs text-muted-foreground">{r.cueverseId}</span>}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.group}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.groupPosition}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.points}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-muted-foreground">{r.record}</td>
                <td className="px-2 py-1.5"><QualBadge q={r.qualification} /></td>
                {canManage && (
                  <td className="px-2 py-1.5 text-right">
                    {r.qualification === 'KICKED_OUT' ? <span className="text-xs text-muted-foreground">—</span>
                      : r.included ? (
                        <button className="text-xs text-muted-foreground hover:text-destructive" disabled={pending} onClick={async () => {
                          const res = await confirm({ title: `Disqualify ${r.name}?`, message: 'The player is removed from the playoff field and any draft bracket is invalidated.', confirmLabel: 'Disqualify', tone: 'danger', input: { label: 'Reason (required)', placeholder: 'Why is this player disqualified?', required: true }, action: async (reason) => setSeasonQualificationAction(seasonId, r.entrantId, 'disqualify', reason) })
                          if (res.confirmed) router.refresh()
                        }}>Disqualify</button>
                      ) : (
                        <button className="text-xs text-brand hover:underline" disabled={pending} onClick={async () => {
                          const res = await confirm({ title: `Add ${r.name} as a Wildcard?`, message: 'The player is added to the playoff field. A note is optional.', confirmLabel: 'Add Wildcard', input: { label: 'Note (optional)', placeholder: 'Optional — why this wildcard?' }, action: async (note) => setSeasonQualificationAction(seasonId, r.entrantId, 'wildcard', note || undefined) })
                          if (res.confirmed) router.refresh()
                        }}>Wildcard</button>
                      )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <Button className="bg-[var(--gold)] text-black hover:bg-[var(--gold-soft)]" disabled={pending || !hasDraft} title={hasDraft ? undefined : 'Generate the bracket first.'} onClick={async () => {
          const res = await confirm({
            title: 'Start Playoffs?',
            message: 'This publishes the bracket publicly and permanently locks the participants, seeds and bracket type.',
            confirmLabel: 'Start Playoffs', tone: 'warning',
            action: async () => startSeasonPlayoffsAction(seasonId),
          })
          if (res.confirmed) router.refresh()
        }}>Start Playoffs</Button>
      )}
    </div>
  )
}

function QualBadge({ q }: { q: string }) {
  const tone = q === 'AUTOMATIC' ? 'text-success' : q === 'WILDCARD' ? 'text-brand' : q === 'KICKED_OUT' || q === 'DISQUALIFIED' ? 'text-destructive' : 'text-muted-foreground'
  return <span className={cn('text-xs font-medium', tone)}>{QUAL_LABEL[q] ?? q}</span>
}

function Toast({ msg }: { msg: { ok: boolean; text: string } }) {
  return <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>
}
