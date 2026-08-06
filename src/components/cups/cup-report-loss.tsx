'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Flag } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { reportCupLossAction } from '@/lib/competition/cup-actions'

/**
 * Player self-report control for the viewer's OWN active cup match. A player may ONLY report
 * themselves as the LOSER — there is no "I won" path (the opponent is recorded as the winner
 * server-side). Shown only for an In-Progress cup, on an unresolved match the viewer is in, that
 * is not a bye. Requires a confirmation naming the opponent before submitting. The server re-checks
 * every one of these conditions; this UI is a convenience, not the gate.
 */
export function CupReportLoss({
  matchId,
  opponentName,
  matchLabel,
  raceLength,
}: {
  matchId: number
  opponentName: string
  matchLabel: string
  raceLength: number
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [myGames, setMyGames] = useState(0)
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)
  const [done, setDone] = useState(false)

  if (done) {
    return (
      <p role="status" className="rounded-lg border border-success/30 bg-success/[0.06] px-4 py-3 text-sm text-success">
        {msg?.text ?? 'Your loss was reported and your opponent advanced.'}
      </p>
    )
  }

  const submit = () => {
    const confirmed = window.confirm(
      `Report YOURSELF as the loser of ${matchLabel} against ${opponentName}?\n\n` +
        `Your opponent will be recorded as the winner (${myGames}–${raceLength}) and will advance. This cannot be undone by you.`,
    )
    if (!confirmed) return
    setMsg(null)
    start(async () => {
      const r = await reportCupLossAction(matchId, myGames)
      if (r.error) setMsg({ text: r.error })
      else {
        setDone(true)
        setMsg({ ok: true, text: r.message ?? 'Your loss was reported.' })
        router.refresh()
      }
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <p className="text-sm font-semibold text-foreground">Your match: {matchLabel}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">vs {opponentName} · race to {raceLength}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">
          Games you won
          <input
            type="number"
            min={0}
            max={raceLength - 1}
            value={myGames}
            onChange={(e) => setMyGames(Math.max(0, Math.min(raceLength - 1, Number(e.target.value) || 0)))}
            className="mt-1 block w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        <Button size="sm" variant="destructive" disabled={pending} onClick={submit}>
          <Flag className="size-4" /> Report my loss
        </Button>
      </div>
      <p className="mt-2 text-[0.7rem] text-muted-foreground">
        You can only report your own loss. Your opponent is recorded as the winner. If this is wrong, contact an admin.
      </p>
      {msg && !msg.ok && <p role="status" className="mt-2 text-sm text-destructive">{msg.text}</p>}
    </div>
  )
}
