'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Info } from 'lucide-react'

import { setSeasonPlayoffDisclaimerAction } from '@/lib/seasons/actions'

/**
 * The note shown under a Season's playoff bracket.
 *
 * Most brackets carry nothing here. It exists so a reconstructed season can say plainly where its
 * bracket came from — that the pairings are archived but the scores were not recorded, say — rather
 * than letting an approximation pass as fact.
 *
 * Visible to everyone once set; only an admin sees the editor.
 */
export function PlayoffDisclaimer({
  seasonId,
  value,
  canManage,
}: {
  seasonId: number
  value: string | null
  canManage: boolean
}) {
  const router = useRouter()
  const [text, setText] = useState(value ?? '')
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const saved = (value ?? '').trim()
  const dirty = text.trim() !== saved

  function save() {
    setError(null)
    start(async () => {
      const r = await setSeasonPlayoffDisclaimerAction(seasonId, text.trim() || null)
      if (r.error) { setError(r.error); return }
      setOpen(false)
      router.refresh()
    })
  }

  if (!canManage && !saved) return null

  return (
    <div className="mt-6">
      {saved && (
        <p className="flex max-w-3xl items-start gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="whitespace-pre-wrap">{saved}</span>
        </p>
      )}

      {canManage && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-xs text-brand hover:underline"
        >
          {saved ? 'Edit bracket note' : 'Add a note about this bracket'}
        </button>
      )}

      {canManage && open && (
        <div className="mt-2 max-w-3xl rounded-md border border-border bg-card/40 p-3">
          <label className="text-[0.7rem] font-semibold text-foreground" htmlFor="playoff-note">
            Bracket note <span className="font-normal text-muted-foreground">(shown to everyone)</span>
          </label>
          <textarea
            id="playoff-note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={500}
            disabled={pending}
            placeholder="e.g. The pairings are taken from the archive; the individual scores were never recorded and are approximate."
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save note'}
            </button>
            <button
              type="button"
              onClick={() => { setText(value ?? ''); setOpen(false); setError(null) }}
              disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
            >
              Cancel
            </button>
            {saved && (
              <button
                type="button"
                onClick={() => { setText(''); start(async () => { await setSeasonPlayoffDisclaimerAction(seasonId, null); setOpen(false); router.refresh() }) }}
                disabled={pending}
                className="ml-auto text-xs text-muted-foreground hover:text-destructive"
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[0.7rem] text-muted-foreground">{text.trim().length}/500</p>
          {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
