'use client'

import { useRef, useState } from 'react'
import { ImagePlus, RotateCcw, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { ACCENT_PRESETS, BADGES, DEFAULT_ACCENT_KEY, DESCRIPTION_MAX, accentStyleVars, accentByKey, badgeByKey } from '@/lib/competition/flair'

export interface FlairValue {
  bannerImageUrl: string | null
  description: string | null
  badge: string | null
  accentPreset: string | null
}

export const EMPTY_FLAIR: FlairValue = { bannerImageUrl: null, description: null, badge: null, accentPreset: null }

const MAX_UPLOAD = 5 * 1024 * 1024 // 5 MB
const input = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

/** Controlled editor for a tournament's curated flair. Shared by the create form and the manage page. */
export function FlairEditor({ value, onChange }: { value: FlairValue; onChange: (v: FlairValue) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const set = (patch: Partial<FlairValue>) => onChange({ ...value, ...patch })

  async function upload(file: File) {
    setUploadError(null)
    if (!file.type.startsWith('image/')) return setUploadError('Choose an image file.')
    if (file.type === 'image/svg+xml') return setUploadError('SVG uploads are not allowed.')
    if (file.size > MAX_UPLOAD) return setUploadError('Image must be 5 MB or smaller.')
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/media', { method: 'POST', body: fd, credentials: 'same-origin' })
      if (!res.ok) throw new Error('upload failed')
      const json = await res.json()
      const url: string | undefined = json?.doc?.url || json?.url
      if (!url) throw new Error('no url')
      set({ bannerImageUrl: url })
    } catch {
      setUploadError('Upload failed. You can paste an https image URL instead.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div>
        <label className="mb-1.5 block text-[0.8rem] font-semibold text-foreground">Hero banner <span className="font-normal text-muted-foreground/60">(optional)</span></label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm font-medium hover:border-brand/50 disabled:opacity-60">
            <ImagePlus className="size-4" /> {uploading ? 'Uploading…' : 'Upload image'}
          </button>
          <span className="text-xs text-muted-foreground">or</span>
          <input value={value.bannerImageUrl ?? ''} onChange={(e) => set({ bannerImageUrl: e.target.value || null })} placeholder="https://…/banner.jpg" className={cn(input, 'flex-1 min-w-[180px]')} inputMode="url" />
          {value.bannerImageUrl && (
            <button type="button" onClick={() => set({ bannerImageUrl: null })} className="rounded-md border border-input p-2 text-muted-foreground hover:text-destructive" aria-label="Remove banner"><X className="size-4" /></button>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = '' }} />
        </div>
        {uploadError && <p className="mt-1.5 text-xs text-destructive">{uploadError}</p>}
        <p className="mt-1.5 text-xs text-muted-foreground">Upload (PNG/JPG/WebP/GIF, ≤5 MB) or an https link. No SVGs.</p>
      </div>

      {/* Accent */}
      <div>
        <label className="mb-1.5 block text-[0.8rem] font-semibold text-foreground">Accent color</label>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((p) => {
            const active = (value.accentPreset ?? DEFAULT_ACCENT_KEY) === p.key
            return (
              <button key={p.key} type="button" onClick={() => set({ accentPreset: p.key === DEFAULT_ACCENT_KEY ? null : p.key })} aria-pressed={active} title={p.label}
                className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors', active ? 'border-foreground/40 bg-card' : 'border-border bg-card/50 hover:border-border/70')}>
                <span className="size-3.5 rounded-full" style={{ background: p.brand }} />
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Badge */}
      <div>
        <label className="mb-1.5 block text-[0.8rem] font-semibold text-foreground">Badge <span className="font-normal text-muted-foreground/60">(optional)</span></label>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => set({ badge: null })} aria-pressed={!value.badge} className={cn('rounded-md border px-3 py-1.5 text-xs font-medium', !value.badge ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-card text-muted-foreground hover:text-foreground')}>None</button>
          {BADGES.map((b) => (
            <button key={b.key} type="button" onClick={() => set({ badge: b.key })} aria-pressed={value.badge === b.key} title={b.label}
              className={cn('rounded-md border px-2.5 py-1.5 text-base leading-none', value.badge === b.key ? 'border-brand bg-brand/10' : 'border-border bg-card hover:border-border/70')}>
              <span aria-hidden>{b.emoji}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="mb-1.5 block text-[0.8rem] font-semibold text-foreground">Description / announcement <span className="font-normal text-muted-foreground/60">(optional)</span></label>
        <textarea value={value.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} maxLength={DESCRIPTION_MAX} rows={3} placeholder="A short note shown on the tournament page — plain text." className={cn(input, 'resize-y')} />
        <p className="mt-1 text-right text-[0.7rem] text-muted-foreground/60">{(value.description ?? '').length}/{DESCRIPTION_MAX}</p>
      </div>

      <button type="button" onClick={() => onChange({ ...EMPTY_FLAIR })} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <RotateCcw className="size-3.5" /> Restore WCC default
      </button>
    </div>
  )
}

/** Live preview of how the tournament header will look with the chosen flair. */
export function FlairPreview({ value, name }: { value: FlairValue; name: string }) {
  const accent = accentByKey(value.accentPreset)
  const badge = badgeByKey(value.badge)
  const style = accentStyleVars(value.accentPreset) as React.CSSProperties
  return (
    <div style={style} className="overflow-hidden rounded-lg border border-border bg-background">
      {value.bannerImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value.bannerImageUrl} alt="" className="h-24 w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
      ) : (
        <div className="h-2" style={{ background: accent.brand }} />
      )}
      <div className="p-4">
        <div className="flex items-center gap-2">
          {badge && <span className="text-lg" aria-hidden>{badge.emoji}</span>}
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.16em]" style={{ color: accent.brand }}>Tournament</span>
        </div>
        <h4 className="mt-1 text-lg font-bold tracking-tight" style={{ color: '#fff' }}>{name.trim() || 'Untitled tournament'}</h4>
        {value.description && <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{value.description}</p>}
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-[0.65rem] font-semibold text-white" style={{ background: accent.brand }}>Registration Open</span>
          <span className="rounded-md border px-2.5 py-1 text-[0.65rem] font-semibold" style={{ borderColor: accent.brand, color: accent.brand }}>Register</span>
        </div>
      </div>
    </div>
  )
}
