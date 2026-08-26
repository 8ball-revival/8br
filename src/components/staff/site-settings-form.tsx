'use client'
import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SETTINGS_FIELDS, type SiteSettings } from '@/lib/staff/site-settings-shared'
import { updateSiteSettingsAction } from '@/lib/staff/settings-actions'

const input = 'w-full rounded-none border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand'

export function SiteSettingsForm({ initial }: { initial: SiteSettings }) {
  const [values, setValues] = useState<SiteSettings>(initial)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (k: keyof SiteSettings, v: string) => setValues((s) => ({ ...s, [k]: v }))

  const save = () => start(async () => {
    setMsg(null)
    const r = await updateSiteSettingsAction(values)
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Settings saved.' })
  })

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        {msg && <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>}
        {SETTINGS_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="mb-1.5 block text-sm font-semibold text-foreground">{f.label}</label>
            {f.kind === 'textarea'
              ? <textarea value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} rows={3} className={cn(input, 'resize-y')} />
              : <input type={f.kind === 'email' ? 'email' : 'text'} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.hint} className={input} />}
          </div>
        ))}
        <Button disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save settings'}</Button>
        <p className="text-xs text-muted-foreground">Plain text only — HTML, scripts, and CSS are rejected. URL and email fields are validated. Branding logo/favicon/banner image uploads use the existing media system (coming next).</p>
      </div>

      {/* Live preview */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <p className="eyebrow text-brand">Preview</p>
        <div className="mt-2 rounded-none border border-border bg-card/50 p-5">
          <p className="font-display text-2xl font-bold">{values.siteName || 'Site name'}</p>
          <p className="text-sm text-[var(--gold)]">{values.shortName || '8BR'}</p>
          {values.homepageBanner && <p className="mt-3 rounded-md bg-[var(--selected-surface)] px-3 py-2 text-sm text-foreground">{values.homepageBanner}</p>}
          {values.description && <p className="mt-3 text-sm text-muted-foreground">{values.description}</p>}
          <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
            <div><dt className="inline font-semibold text-foreground">Lounge:</dt> {values.defaultLounge || '—'}</div>
            <div><dt className="inline font-semibold text-foreground">Game room:</dt> {values.gameRoomLink || '—'}</div>
            <div><dt className="inline font-semibold text-foreground">Contact:</dt> {values.contactEmail || '—'}</div>
            {values.supportInfo && <div><dt className="inline font-semibold text-foreground">Support:</dt> {values.supportInfo}</div>}
          </dl>
        </div>
      </div>
    </div>
  )
}
