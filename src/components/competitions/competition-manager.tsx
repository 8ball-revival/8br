'use client'

import { useRef, useState } from 'react'
import { Loader2, Trash2, Upload, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { CompetitionAdminRow } from '@/lib/competitions/shared'
import {
  createCompetitionAction,
  deleteCompetitionAction,
  setCompetitionIconAction,
  updateCompetitionAction,
} from '@/lib/competitions/actions'
import { CompetitionBadge } from './competition-badge'

const input =
  'rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

/**
 * Staff management for Competitions: list, create, edit, activate/deactivate, icon, delete.
 *
 * Every mutation goes through a server action gated on `manage_competitions` (ADMIN/OWNER) — this
 * component only decides what to *show*. Deletion is additionally refused server-side while any
 * Season still belongs to the Competition; the button is disabled here purely as a courtesy.
 *
 * Icon upload posts the file to the existing Payload Media endpoint with the session cookie, then
 * records the returned filename against the Competition. No new storage system is introduced.
 */
export function CompetitionManager({ initial }: { initial: CompetitionAdminRow[] }) {
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState<number | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')

  const patch = (id: number, next: Partial<CompetitionAdminRow>) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...next } : x)))

  async function create() {
    setError(null)
    if (!name.trim()) return setError('A Competition name is required.')
    setBusy('new')
    const res = await createCompetitionAction({ name: name.trim(), shortName: shortName.trim() || name.trim() })
    setBusy(null)
    if (res.error || !res.competition) return setError(res.error ?? 'Could not create the Competition.')
    setRows((r) => [...r, { ...res.competition!, seasonCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)))
    setName('')
    setShortName('')
  }

  async function save(row: CompetitionAdminRow) {
    setError(null)
    setBusy(row.id)
    const res = await updateCompetitionAction(row.id, {
      name: row.name,
      shortName: row.shortName,
      slug: row.slug,
      active: row.active,
    })
    setBusy(null)
    if (res.error) return setError(res.error)
    if (res.competition) patch(row.id, res.competition)
  }

  async function remove(row: CompetitionAdminRow) {
    setError(null)
    setBusy(row.id)
    const res = await deleteCompetitionAction(row.id)
    setBusy(null)
    if (res.error) return setError(res.error)
    setRows((r) => r.filter((x) => x.id !== row.id))
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Create */}
      <section className="rounded-none border border-border bg-card p-4">
        <p className="eyebrow text-brand">New Competition</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-[0.7rem] text-muted-foreground">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. 8BRCAM" className={cn(input, 'mt-1 block w-56')} />
          </label>
          <label className="text-[0.7rem] text-muted-foreground">
            Short name
            <input value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={20} placeholder="defaults to the name" className={cn(input, 'mt-1 block w-44')} />
          </label>
          <button type="button" onClick={create} disabled={busy === 'new'} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {busy === 'new' ? 'Creating…' : 'Create'}
          </button>
        </div>
        <p className="mt-2 text-[0.7rem] text-muted-foreground/70">The slug is derived from the short name and must be unique.</p>
      </section>

      {/* List */}
      <div className="overflow-x-auto rounded-none border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Icon</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Short</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Seasons</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No Competitions yet.</td></tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className={cn(!row.active && 'opacity-60')}>
                <td className="px-3 py-2">
                  <IconCell row={row} onChange={(f) => patch(row.id, { iconMediaId: f })} onError={setError} />
                </td>
                <td className="px-3 py-2">
                  <input value={row.name} onChange={(e) => patch(row.id, { name: e.target.value })} maxLength={80} className={cn(input, 'w-48')} aria-label={`Name for ${row.name}`} />
                </td>
                <td className="px-3 py-2">
                  <input value={row.shortName} onChange={(e) => patch(row.id, { shortName: e.target.value })} maxLength={20} className={cn(input, 'w-28')} aria-label={`Short name for ${row.name}`} />
                </td>
                <td className="px-3 py-2">
                  <input value={row.slug} onChange={(e) => patch(row.id, { slug: e.target.value })} maxLength={60} className={cn(input, 'w-40 font-mono text-xs')} aria-label={`Slug for ${row.name}`} />
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.seasonCount}</td>
                <td className="px-3 py-2">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={row.active} onChange={(e) => patch(row.id, { active: e.target.checked })} className="size-4 accent-[var(--gold)]" />
                    {row.active ? 'Active' : 'Inactive'}
                  </label>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => save(row)} disabled={busy === row.id} className="rounded-none border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                      {busy === row.id ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(row)}
                      disabled={busy === row.id || row.seasonCount > 0}
                      title={row.seasonCount > 0 ? `Owns ${row.seasonCount} Season(s) — deactivate instead` : 'Delete'}
                      className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs font-semibold text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" aria-hidden /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Icon preview + upload / replace / remove for one Competition. */
function IconCell({
  row,
  onChange,
  onError,
}: {
  row: CompetitionAdminRow
  onChange: (filename: string | null) => void
  onError: (msg: string | null) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    onError(null)
    setBusy(true)
    try {
      // Reuse the existing Payload Media collection. `credentials: 'include'` sends the session
      // cookie, and Media's create access is already staff-gated server-side.
      const body = new FormData()
      body.append('file', file)
      body.append('_payload', JSON.stringify({ alt: `${row.name} icon` }))
      const res = await fetch('/api/media', { method: 'POST', body, credentials: 'include' })
      if (!res.ok) throw new Error(`Upload failed (${res.status})`)
      const json = await res.json()
      const filename: string | undefined = json?.doc?.filename
      if (!filename) throw new Error('Upload succeeded but returned no filename.')
      const saved = await setCompetitionIconAction(row.id, filename)
      if (saved.error) throw new Error(saved.error)
      onChange(filename)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not upload the icon.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function clear() {
    onError(null)
    setBusy(true)
    const res = await setCompetitionIconAction(row.id, null)
    setBusy(false)
    if (res.error) return onError(res.error)
    onChange(null)
  }

  return (
    <div className="flex items-center gap-2">
      <CompetitionBadge name={row.name} shortName={row.shortName} iconMediaId={row.iconMediaId} size={28} />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        title={row.iconMediaId ? 'Replace icon' : 'Upload icon'}
        className="inline-flex items-center rounded-none border border-border p-1.5 disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
        <span className="sr-only">{row.iconMediaId ? 'Replace icon' : 'Upload icon'}</span>
      </button>
      {row.iconMediaId && (
        <button type="button" onClick={clear} disabled={busy} title="Remove icon (falls back to initials)" className="inline-flex items-center rounded-none border border-border p-1.5 disabled:opacity-50">
          <X className="size-3.5" aria-hidden />
          <span className="sr-only">Remove icon</span>
        </button>
      )}
    </div>
  )
}
