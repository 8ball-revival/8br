'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { updateEditorialSettingsAction } from '@/lib/editorial/actions'

export interface EditorialSettingsValue {
  featuredArticleId: number | null
  showFeatured: boolean
  showOfficial: boolean
  showPredictions: boolean
  showCommunity: boolean
  showDiscussed: boolean
}

/**
 * What the homepage editorial band shows.
 *
 * Every section can be turned off, and the whole band is allowed to be empty — a site with no
 * articles yet must have a homepage that looks finished rather than broken. Turning a section off
 * hides it; it never leaves a labelled gap.
 */
export function EditorialSettingsForm({
  initial,
  candidates,
}: {
  initial: EditorialSettingsValue
  /** Published articles that could be the chosen feature. */
  candidates: { id: number; title: string }[]
}) {
  const router = useRouter()
  const [value, setValue] = useState(initial)
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ ok?: boolean; text: string } | null>(null)

  const save = () => {
    setMessage(null)
    start(async () => {
      const r = await updateEditorialSettingsAction(value)
      if (r.error) setMessage({ text: r.error })
      else { setMessage({ ok: true, text: 'Homepage updated.' }); router.refresh() }
    })
  }

  const toggle = (key: keyof EditorialSettingsValue) => (checked: boolean) =>
    setValue((v) => ({ ...v, [key]: checked }))

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="featured" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Featured article
        </label>
        <select
          id="featured"
          value={value.featuredArticleId ?? ''}
          onChange={(e) => setValue((v) => ({ ...v, featuredArticleId: e.target.value ? Number(e.target.value) : null }))}
          className="w-full rounded-none border border-input bg-card px-3 py-2 text-sm"
        >
          <option value="">Newest article flagged as featured</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          Choosing one here overrides the flag. If the chosen article stops being public, the homepage
          falls back to the newest featured one on its own.
        </p>
      </div>

      <fieldset className="rounded-none border border-border p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sections</legend>
        <div className="space-y-2.5">
          <Row id="showFeatured" checked={value.showFeatured} onChange={toggle('showFeatured')} label="Featured story" />
          <Row id="showOfficial" checked={value.showOfficial} onChange={toggle('showOfficial')} label="Official news" />
          <Row id="showPredictions" checked={value.showPredictions} onChange={toggle('showPredictions')} label="Predictions" />
          <Row id="showCommunity" checked={value.showCommunity} onChange={toggle('showCommunity')} label="Community" />
          <Row id="showDiscussed" checked={value.showDiscussed} onChange={toggle('showDiscussed')} label="Most discussed (last 30 days)" />
        </div>
      </fieldset>

      {message && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${message.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
          {message.text}
        </p>
      )}

      <Button disabled={pending} onClick={save}><Save className="size-4" aria-hidden />Save</Button>
    </div>
  )
}

function Row({
  id, checked, onChange, label,
}: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--gold)]" />
      {label}
    </label>
  )
}
