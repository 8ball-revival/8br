'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Bracket } from '@/components/tournaments/bracket'
import { SeasonLiveBracket } from '@/components/seasons/season-live-bracket'
import { PlayoffDisclaimer } from '@/components/competition/playoff-disclaimer'
import { PlayerName } from '@/components/identity/player-name'
import { identityText } from '@/lib/identity/display'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { BracketRound } from '@/lib/tournaments/service'
import type { SeasonSeedRow } from '@/lib/seasons/playoffs'
import {
  setSeasonPlayoffIncludedAction, setSeasonPlayoffFieldAction, swapSeasonBracketSlotsAction,
  setSeasonPlayoffTypeAction, generateSeasonBracketAction,
  startSeasonPlayoffsAction, closeSeasonAction,
} from '@/lib/seasons/actions'


/** Playoff setup (locked seeding + selection + generate/start) OR the live public bracket with inline
 *  admin score entry. */
export function SeasonPlayoffs({
  seasonId, phase, seeding, rounds, doubleElim, hasDraft, canManage, canClose, disclaimer,
}: {
  seasonId: number
  phase: 'setup' | 'live'
  seeding: SeasonSeedRow[]
  rounds: BracketRound[]
  doubleElim: boolean
  hasDraft: boolean
  canManage: boolean
  canClose: boolean
  /** Free-text note shown under the bracket; null for the vast majority of seasons. */
  disclaimer: string | null
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  /** The slot picked up for a swap, if any. */
  const [picked, setPicked] = useState<{ matchId: number; side: 'home' | 'away' } | null>(null)
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
        <PlayoffDisclaimer kind="season" id={seasonId} value={disclaimer} canManage={canManage} />
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
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="eyebrow text-muted-foreground">Draft bracket (private preview)</p>
            <p className="text-xs text-muted-foreground">
              {picked
                ? 'Now click the slot to swap it with — or click it again to cancel.'
                : 'Click a player, then click another slot to swap them.'}
            </p>
            {picked && (
              <button type="button" onClick={() => setPicked(null)} className="text-xs text-brand hover:underline">
                Cancel
              </button>
            )}
          </div>
          <div className="w-full">
            <Bracket
              rounds={rounds}
              fluid
              swap={{
                selected: picked,
                pick: (matchId, side) => {
                  // First click picks a slot up; the second swaps the two and clears the selection.
                  if (!picked) { setPicked({ matchId, side }); return }
                  if (picked.matchId === matchId && picked.side === side) { setPicked(null); return }
                  const from = picked
                  setPicked(null)
                  run(() => swapSeasonBracketSlotsAction(seasonId, from, { matchId, side }))
                },
              }}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Placement is locked once the bracket is published.
          </p>
          <PlayoffDisclaimer kind="season" id={seasonId} value={disclaimer} canManage={canManage} />
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
                    aria-label={`Include ${identityText({ cueverseId: r.cueverseId, preferredName: r.name })} in the playoff bracket`}
                    onChange={(e) => run(() => setSeasonPlayoffIncludedAction(seasonId, r.entrantId, e.target.checked))}
                    className="size-4 accent-[var(--gold)]"
                  />
                </td>
                <td className="px-2 py-1.5 text-center font-semibold tabular-nums text-[var(--gold-soft)]">{r.overallSeed ?? '—'}</td>
                <td className="px-2 py-1.5">
                  <PlayerName identity={{ cueverseId: r.cueverseId, preferredName: r.name }} size="sm" />
                </td>
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


