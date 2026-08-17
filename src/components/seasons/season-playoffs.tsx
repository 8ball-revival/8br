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
  setSeasonPlayoffIncludedAction, setSeasonPlayoffFieldAction, setSeasonBracketSlotAction,
  setSeasonPlayoffTypeAction, generateSeasonBracketAction,
  startSeasonPlayoffsAction, closeSeasonAction,
} from '@/lib/seasons/actions'


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

  // Kicked-out players are never selectable, so they do not count towards the header's all/none state.
  const selectable = seeding.filter((r) => r.qualification !== 'KICKED_OUT')
  const allIncluded = selectable.length > 0 && selectable.every((r) => r.included)
  const someIncluded = selectable.some((r) => r.included)

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

          {/* Generated seeding is a starting point, not a verdict. Any slot can be reassigned; picking
              someone who already sits elsewhere swaps the two, so nobody is duplicated or dropped. */}
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">Rearrange the bracket</summary>
            <p className="mt-1 text-xs text-muted-foreground">
              Choosing a player who is already in another tie swaps them over. Ties that already have a
              result cannot be changed here.
            </p>
            <div className="mt-3 space-y-4">
              {rounds.map((rd) => (
                <div key={rd.name}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">{rd.name}</p>
                  <div className="mt-1.5 space-y-1.5">
                    {rd.matches.filter((m) => m.id != null).map((m, mi) => (
                      <div key={m.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="w-8 shrink-0 text-muted-foreground">#{mi + 1}</span>
                        {(['home', 'away'] as const).map((side) => (
                          <select
                            key={side}
                            aria-label={`${rd.name} match ${mi + 1} ${side} player`}
                            disabled={pending}
                            value={entrantIdFor(seeding, side === 'home' ? m.a?.name : m.b?.name) ?? ''}
                            onChange={(e) => run(() => setSeasonBracketSlotAction(
                              seasonId, m.id!, side, e.target.value === '' ? null : Number(e.target.value),
                            ))}
                            className="min-w-[9rem] rounded border border-input bg-card px-1.5 py-1"
                          >
                            <option value="">&mdash; empty &mdash;</option>
                            {seeding.filter((r) => r.included).map((r) => (
                              <option key={r.entrantId} value={r.entrantId}>
                                {r.overallSeed ? `${r.overallSeed}. ` : ''}{r.name}
                              </option>
                            ))}
                          </select>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-border bg-card/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-center">
                {/* Select-all: with everyone in by default, clearing the column and ticking back the
                    handful who actually played is usually the quicker way round. */}
                {canManage ? (
                  <label className="inline-flex cursor-pointer flex-col items-center gap-0.5">
                    <input
                      type="checkbox"
                      ref={(el) => { if (el) el.indeterminate = someIncluded && !allIncluded }}
                      checked={allIncluded}
                      disabled={pending || selectable.length === 0}
                      aria-label={allIncluded ? 'Remove everyone from the playoff bracket' : 'Add everyone to the playoff bracket'}
                      title={allIncluded ? 'Uncheck all' : 'Check all'}
                      onChange={(e) => run(() => setSeasonPlayoffFieldAction(seasonId, e.target.checked))}
                      className="size-4 accent-[var(--gold)]"
                    />
                    <span className="text-[0.6rem] font-normal normal-case text-muted-foreground">All</span>
                  </label>
                ) : 'In'}
              </th>
              <th className="px-2 py-2 text-center">Seed</th><th className="px-2 py-2">Player</th><th className="px-2 py-2">Group</th>
              <th className="px-2 py-2 text-center">Pos</th><th className="px-2 py-2 text-center">Pts</th><th className="px-2 py-2 text-center">Record</th>
            </tr>
          </thead>
          <tbody>
            {seeding.map((r) => (
              <tr key={r.entrantId} className={cn('border-b border-border/50', !r.included && 'opacity-55')}>
                <td className="px-2 py-1.5 text-center">
                  {/* One switch: in the bracket, or not. A reconstructed season had whatever field it
                      had, so automatic/wildcard/disqualified is a distinction without a difference. */}
                  <input
                    type="checkbox"
                    checked={r.included}
                    disabled={!canManage || pending}
                    aria-label={`Include ${r.name} in the playoff bracket`}
                    onChange={(e) => run(() => setSeasonPlayoffIncludedAction(seasonId, r.entrantId, e.target.checked))}
                    className="size-4 accent-[var(--gold)]"
                  />
                </td>
                <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-[var(--gold-soft)]">{r.overallSeed ?? '—'}</td>
                <td className="px-2 py-1.5">{r.name}{r.cueverseId && r.cueverseId !== r.name && <span className="ml-1.5 text-xs text-muted-foreground">{r.cueverseId}</span>}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.group}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.groupPosition}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.points}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-muted-foreground">{r.record}</td>
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


function Toast({ msg }: { msg: { ok: boolean; text: string } }) {
  return <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>
}


/** The entrant behind a bracket slot's displayed name, so a slot can preselect its current player. */
function entrantIdFor(rows: { entrantId: number; name: string }[], name: string | undefined): number | null {
  if (!name || name === 'Bye' || name === 'TBD') return null
  return rows.find((r) => r.name === name)?.entrantId ?? null
}
