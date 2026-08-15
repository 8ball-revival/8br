'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Bracket } from '@/components/tournaments/bracket'
import type { BracketRound } from '@/lib/tournaments/service'
import type { SeasonSeedRow } from '@/lib/seasons/playoffs'
import type { PlayablePlayoff } from '@/lib/seasons/views'
import {
  setSeasonQualificationAction, setSeasonPlayoffTypeAction, generateSeasonBracketAction,
  startSeasonPlayoffsAction, recordSeasonPlayoffResultAction, closeSeasonAction,
} from '@/lib/seasons/actions'

const QUAL_LABEL: Record<string, string> = { AUTOMATIC: 'Automatic Qualifier', WILDCARD: 'Wildcard', DISQUALIFIED: 'Disqualified', KICKED_OUT: 'Kicked Out', NOT_SELECTED: 'Not Selected' }

/** Playoff setup (locked seeding + selection + generate/start) OR the live public bracket. */
export function SeasonPlayoffs({
  seasonId, phase, seeding, rounds, doubleElim, hasDraft, playable, canManage, canClose,
}: {
  seasonId: number
  phase: 'setup' | 'live'
  seeding: SeasonSeedRow[]
  rounds: BracketRound[]
  doubleElim: boolean
  hasDraft: boolean
  playable: PlayablePlayoff[]
  canManage: boolean
  canClose: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' }); router.refresh() })

  if (phase === 'live') {
    return (
      <div className="mt-8 space-y-6">
        {msg && <Toast msg={msg} />}
        {rounds.length > 0 ? <div className="w-full"><Bracket rounds={rounds} fluid /></div> : <p className="text-sm text-muted-foreground">The bracket is being prepared.</p>}
        {canManage && <LivePlayoffAdmin playable={playable} run={run} pending={pending} />}
        {canManage && canClose && (
          <div className="border-t border-border pt-4">
            <Button className="bg-[#d6ae42] text-black hover:bg-[#e6c463]" disabled={pending} onClick={() => { if (window.confirm('Close Season?\n\nThis crowns the champion, locks all results, applies the Ladder ranking update (played matches only), and awards the Season Championship.')) run(() => closeSeasonAction(seasonId)) }}>
              Close Season & Crown Champion
            </Button>
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

      {/* Locked seeding list */}
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
                <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-[#e6c463]">{r.overallSeed ?? '—'}</td>
                <td className="px-2 py-1.5">{r.name}{r.cueverseId && r.cueverseId !== r.name && <span className="ml-1.5 text-xs text-muted-foreground">{r.cueverseId}</span>}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.group}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.groupPosition}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.points}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-muted-foreground">{r.record}</td>
                <td className="px-2 py-1.5"><QualBadge q={r.qualification} included={r.included} /></td>
                {canManage && (
                  <td className="px-2 py-1.5 text-right">
                    {r.qualification === 'KICKED_OUT' ? <span className="text-xs text-muted-foreground">—</span>
                      : r.included ? (
                        <button className="text-xs text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => { const reason = window.prompt(`Disqualify ${r.name}? Enter a reason:`); if (reason?.trim()) run(() => setSeasonQualificationAction(seasonId, r.entrantId, 'disqualify', reason.trim())) }}>Disqualify</button>
                      ) : (
                        <button className="text-xs text-brand hover:underline" disabled={pending} onClick={() => { const reason = window.prompt(`Add ${r.name} as a Wildcard? Enter a reason:`); if (reason?.trim()) run(() => setSeasonQualificationAction(seasonId, r.entrantId, 'wildcard', reason.trim())) }}>Wildcard</button>
                      )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage && (
        <Button className="bg-[#d6ae42] text-black hover:bg-[#e6c463]" disabled={pending || !hasDraft} title={hasDraft ? undefined : 'Generate the bracket first.'} onClick={() => { if (window.confirm('Start Playoffs?\n\nThis publishes the bracket publicly and permanently locks the participants, seeds and bracket type.')) run(() => startSeasonPlayoffsAction(seasonId)) }}>
          Start Playoffs
        </Button>
      )}
    </div>
  )
}

function LivePlayoffAdmin({ playable, run, pending }: { playable: PlayablePlayoff[]; run: (fn: () => Promise<{ ok?: boolean; error?: string; message?: string; warning?: { affected: { id: number; label: string }[] } }>) => void; pending: boolean }) {
  const open = playable.filter((m) => !m.decided)
  if (!open.length) return null
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <p className="eyebrow mb-3 text-muted-foreground">Enter playoff results</p>
      <ul className="space-y-2">
        {open.map((m) => <PlayoffRow key={m.id} m={m} run={run} pending={pending} />)}
      </ul>
    </div>
  )
}

function PlayoffRow({ m, run, pending }: { m: PlayablePlayoff; run: (fn: () => Promise<{ ok?: boolean; error?: string; message?: string; warning?: { affected: { id: number; label: string }[] } }>) => void; pending: boolean }) {
  const [h, setH] = useState('')
  const [a, setA] = useState('')
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-[10rem] flex-1 truncate">{m.label ? <span className="text-xs text-muted-foreground">{m.label}: </span> : null}{m.homeUsername} <span className="text-muted-foreground">vs</span> {m.awayUsername}</span>
      <input value={h} onChange={(e) => setH(e.target.value)} inputMode="numeric" className="h-8 w-12 rounded border border-input bg-card text-center text-sm" aria-label={`${m.homeUsername} games`} />
      <input value={a} onChange={(e) => setA(e.target.value)} inputMode="numeric" className="h-8 w-12 rounded border border-input bg-card text-center text-sm" aria-label={`${m.awayUsername} games`} />
      <Button size="sm" variant="outline" disabled={pending || h === '' || a === ''} onClick={() => run(async () => {
        const first = await recordSeasonPlayoffResultAction(m.id, Number(h), Number(a))
        if (first.warning) { if (window.confirm(`This changes a completed match. ${first.warning.affected.length} downstream match(es) will be cleared and rebuilt. Continue?`)) return recordSeasonPlayoffResultAction(m.id, Number(h), Number(a), true); return { ok: true } }
        return first
      })}>Save</Button>
    </li>
  )
}

function QualBadge({ q, included }: { q: string; included: boolean }) {
  const tone = q === 'AUTOMATIC' ? 'text-success' : q === 'WILDCARD' ? 'text-brand' : q === 'KICKED_OUT' ? 'text-destructive' : q === 'DISQUALIFIED' ? 'text-destructive' : 'text-muted-foreground'
  return <span className={cn('text-xs font-medium', tone)}>{QUAL_LABEL[q] ?? q}{included && q === 'AUTOMATIC' ? '' : ''}</span>
}

function Toast({ msg }: { msg: { ok: boolean; text: string } }) {
  return <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>
}
