'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Bracket, type BracketEditApi } from '@/components/tournaments/bracket'
import type { BracketRound } from '@/lib/tournaments/service'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { recordSeasonPlayoffResultAction } from '@/lib/seasons/actions'

interface Meta { updatedAt: string; home: string; away: string; labels: { home: string; away: string } }

/** The live Season playoff bracket. Members see plain read-only scores; admins get inline score inputs
 *  in each playable matchup (Enter or the Save control saves), with completed matches remaining
 *  editable and downstream-rebuild / stale-edit handled via the WCC dialog. */
export function SeasonLiveBracket({ rounds, canManage }: { rounds: BracketRound[]; canManage: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [, startTransition] = useTransition()

  // Per-match metadata + initial (loaded) scores. Keyed by match id.
  const meta = useMemo(() => {
    const m = new Map<number, Meta>()
    for (const round of rounds) for (const mt of round.matches) {
      if (mt.id == null) continue
      m.set(mt.id, { updatedAt: mt.updatedAt ?? '', home: mt.a?.score != null ? String(mt.a.score) : '', away: mt.b?.score != null ? String(mt.b.score) : '', labels: { home: mt.a?.name ?? 'Home', away: mt.b?.name ?? 'Away' } })
    }
    return m
  }, [rounds])
  // Signature so a server refresh (new scores/advancement) discards stale drafts.
  const signature = useMemo(() => [...meta.entries()].map(([id, v]) => `${id}:${v.updatedAt}:${v.home}:${v.away}`).join('|'), [meta])

  const [drafts, setDrafts] = useState<Record<number, { home: string; away: string }>>({})
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})

  // Reset local edit state whenever the underlying bracket changes.
  const [sig, setSig] = useState(signature)
  if (sig !== signature) { setSig(signature); setDrafts({}); setSavingIds(new Set()); setErrors({}) }

  const draftOf = (id: number) => drafts[id] ?? { home: meta.get(id)?.home ?? '', away: meta.get(id)?.away ?? '' }
  const setSaving = (id: number, on: boolean) => setSavingIds((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  const setErr = (id: number, e: string | null) => setErrors((m) => { const n = { ...m }; if (e) n[id] = e; else delete n[id]; return n })

  async function doSave(id: number) {
    const d = draftOf(id)
    const info = meta.get(id)
    if (!info) return
    setErr(id, null)
    const homeBlank = d.home.trim() === '', awayBlank = d.away.trim() === ''
    if (homeBlank && awayBlank) return // unplayed — nothing to save
    if (homeBlank || awayBlank) { setErr(id, 'Enter both scores.'); return }
    if (!/^\d+$/.test(d.home.trim()) || !/^\d+$/.test(d.away.trim())) { setErr(id, 'Whole numbers only.'); return }
    const h = Number(d.home), a = Number(d.away)
    if (h === 0 && a === 0) return // 0–0 remains unplayed
    if (h === a) { setErr(id, 'Equal scores are rejected — a playoff match needs a winner.'); return }

    setSaving(id, true)
    const first = await recordSeasonPlayoffResultAction(id, h, a, { expectedUpdatedAt: info.updatedAt })
    if (first.warning) {
      setSaving(id, false)
      const res = await confirm({
        title: 'Change a completed result?',
        message: (
          <div>
            <p>The winner of this matchup changes. These downstream matches will be cleared and rebuilt:</p>
            <ul className="mt-1.5 list-disc pl-5">{first.warning.affected.map((x) => <li key={x.id}>{x.label}</li>)}</ul>
          </div>
        ),
        confirmLabel: 'Rebuild bracket',
        cancelLabel: 'Keep current result',
        tone: 'warning',
        input: { label: 'Correction note (optional)', placeholder: 'Why is this being corrected?', multiline: true },
      })
      if (!res.confirmed) return // cancel leaves the existing result + bracket unchanged
      setSaving(id, true)
      const second = await recordSeasonPlayoffResultAction(id, h, a, { confirmRebuild: true, note: res.value || null, expectedUpdatedAt: info.updatedAt })
      finish(id, second)
      return
    }
    finish(id, first)
  }

  function finish(id: number, r: { ok?: boolean; error?: string; conflict?: boolean }) {
    setSaving(id, false)
    if (r.error) { setErr(id, r.conflict ? `${r.error}` : r.error); return }
    setErr(id, null)
    startTransition(() => router.refresh())
  }

  const edit: BracketEditApi | undefined = canManage
    ? {
        draft: (id) => draftOf(id),
        set: (id, side, value) => { setErr(id, null); setDrafts((m) => ({ ...m, [id]: { ...draftOf(id), [side]: value } })) },
        dirty: (id) => { const d = draftOf(id), info = meta.get(id); return !!info && (d.home !== info.home || d.away !== info.away) },
        saving: (id) => savingIds.has(id),
        error: (id) => errors[id] ?? null,
        save: (id) => { void doSave(id) },
      }
    : undefined

  return <div className="w-full"><Bracket rounds={rounds} fluid edit={edit} /></div>
}
