'use client'

import { useState, useTransition } from 'react'
import { Plus, Pencil, Copy, Archive, ArchiveRestore, Trash2, ArrowUp, ArrowDown, Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { DefinitionInput } from '@/lib/achievements/validate'
import type { Achievement } from '@/lib/achievements/types'
import {
  createAchievementAction, updateAchievementAction, setAchievementStatusAction,
  duplicateAchievementAction, deleteAchievementAction, reorderAchievementAction,
  previewAchievementAction,
} from '@/lib/achievements/actions'
import { AchievementEditor, EMPTY_DEFINITION, type EditorOptions } from './achievement-editor'

/**
 * Admin management for achievements, on the /achievements page itself.
 *
 * ── Why here and not in Creator ──────────────────────────────────────────────────────────────────
 * Creator manages competitions — records with a lifecycle, entrants and results. An achievement is a
 * presentation rule, and the useful thing when editing one is seeing it next to the others it will
 * sit beside. Putting the controls on the page they affect means the preview is the real context
 * rather than an approximation of it.
 *
 * ── Visitors never see any of this ───────────────────────────────────────────────────────────────
 * The page only renders this component for a staff session, and every action re-checks permission on
 * the server. Hiding a control is presentation; the refusal lives in the action.
 */

export interface AdminRow {
  id: number
  key: string
  title: string
  awardType: 'AUTOMATIC' | 'MANUAL'
  status: 'ACTIVE' | 'ARCHIVED'
  statistic: string | null
  sortOrder: number
  /** The current form values, so Edit opens on what is actually stored. */
  input: DefinitionInput
}

export function AchievementAdmin({
  rows,
  options,
  canDelete,
}: {
  rows: AdminRow[]
  options: EditorOptions
  /** Permanent deletion is Owner-only; the control is absent otherwise. */
  canDelete: boolean
}) {
  const [editing, setEditing] = useState<{ id: number | null; input: DefinitionInput } | null>(null)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    startTransition(async () => {
      const res = await fn()
      setMessage(res.ok ? null : res.message ?? 'That did not work.')
    })
  }

  const save = (input: DefinitionInput) => {
    startTransition(async () => {
      const res = editing?.id != null
        ? await updateAchievementAction(editing.id, input)
        : await createAchievementAction(input)
      if (res.ok) { setEditing(null); setMessage(null) }
      else setMessage(res.message ?? 'Check the fields and try again.')
    })
  }

  const preview = async (input: DefinitionInput): Promise<{ card?: Achievement; errors?: Record<string, string> }> => {
    const res = await previewAchievementAction(input)
    return { card: res.card, errors: res.errors }
  }

  const active = rows.filter((r) => r.status === 'ACTIVE')
  const archived = rows.filter((r) => r.status === 'ARCHIVED')

  if (editing) {
    return (
      <section className="cyber-clip border-2 border-[var(--acid)] bg-[var(--graphite)] p-4">
        <h2 className="mb-4 font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--acid)]">
          {editing.id == null ? 'New achievement' : 'Editing achievement'}
        </h2>
        <AchievementEditor
          initial={editing.input}
          options={options}
          onSave={save}
          onPreview={preview}
          onCancel={() => { setEditing(null); setMessage(null) }}
          saving={pending}
        />
        {message && <p className="mt-3 text-sm text-[var(--hot-red)]" role="alert">{message}</p>}
      </section>
    )
  }

  return (
    <section className="cyber-clip border-2 border-[var(--acid)] bg-[var(--graphite)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--acid)]">
          Manage achievements
        </h2>
        <button
          type="button"
          onClick={() => setEditing({ id: null, input: { ...EMPTY_DEFINITION } })}
          className="cyber-clip-sm inline-flex items-center gap-1.5 bg-[var(--acid)] px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--acid-ink)] transition-colors hover:bg-[var(--acid-hover)]"
        >
          <Plus className="size-3.5" aria-hidden />
          Add achievement
        </button>
      </div>

      {message && <p className="border-b border-[var(--line)] px-4 py-2 text-sm text-[var(--hot-red)]" role="alert">{message}</p>}

      <AdminList
        title={`Active (${active.length})`}
        rows={active}
        pending={pending}
        onEdit={(r) => setEditing({ id: r.id, input: r.input })}
        onDuplicate={(r) => run(() => duplicateAchievementAction(r.id))}
        onArchive={(r) => run(() => setAchievementStatusAction(r.id, 'ARCHIVED'))}
        onRestore={(r) => run(() => setAchievementStatusAction(r.id, 'ACTIVE'))}
        onDelete={canDelete ? (r) => run(() => deleteAchievementAction(r.id)) : undefined}
        onMove={(r, dir) => run(() => reorderAchievementAction(r.id, dir))}
      />

      {archived.length > 0 && (
        <AdminList
          title={`Hidden (${archived.length})`}
          note="Archived achievements keep their configuration and never appear publicly."
          rows={archived}
          pending={pending}
          onEdit={(r) => setEditing({ id: r.id, input: r.input })}
          onDuplicate={(r) => run(() => duplicateAchievementAction(r.id))}
          onArchive={(r) => run(() => setAchievementStatusAction(r.id, 'ARCHIVED'))}
          onRestore={(r) => run(() => setAchievementStatusAction(r.id, 'ACTIVE'))}
          onDelete={canDelete ? (r) => run(() => deleteAchievementAction(r.id)) : undefined}
        />
      )}
    </section>
  )
}

function AdminList({
  title, note, rows, pending, onEdit, onDuplicate, onArchive, onRestore, onDelete, onMove,
}: {
  title: string
  note?: string
  rows: AdminRow[]
  pending: boolean
  onEdit: (r: AdminRow) => void
  onDuplicate: (r: AdminRow) => void
  onArchive: (r: AdminRow) => void
  onRestore: (r: AdminRow) => void
  onDelete?: (r: AdminRow) => void
  onMove?: (r: AdminRow, dir: 'up' | 'down') => void
}) {
  return (
    <div>
      <div className="border-b border-[var(--line)] bg-[var(--void)]/40 px-4 py-2">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
        {note && <p className="mt-0.5 text-[0.7rem] text-muted-foreground/80">{note}</p>}
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {rows.map((r, i) => (
          <li key={r.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3', pending && 'opacity-60')}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-foreground">{r.title}</span>
              <span className="block truncate text-[0.7rem] text-muted-foreground">
                {r.awardType === 'AUTOMATIC' ? `Automatic · ${r.statistic ?? 'no statistic'}` : 'Manual'}
              </span>
            </span>

            {/* Reordering is only meaningful within the active list. */}
            {onMove && (
              <span className="flex items-center gap-1">
                <IconButton label={`Move ${r.title} up`} onClick={() => onMove(r, 'up')} disabled={i === 0 || pending}>
                  <ArrowUp className="size-3.5" aria-hidden />
                </IconButton>
                <IconButton label={`Move ${r.title} down`} onClick={() => onMove(r, 'down')} disabled={i === rows.length - 1 || pending}>
                  <ArrowDown className="size-3.5" aria-hidden />
                </IconButton>
              </span>
            )}

            <span className="flex flex-wrap items-center gap-1">
              <IconButton label={`Edit ${r.title}`} onClick={() => onEdit(r)} disabled={pending}>
                <Pencil className="size-3.5" aria-hidden />
              </IconButton>
              <IconButton label={`Duplicate ${r.title}`} onClick={() => onDuplicate(r)} disabled={pending}>
                <Copy className="size-3.5" aria-hidden />
              </IconButton>
              {r.status === 'ACTIVE' ? (
                <IconButton label={`Hide ${r.title}`} onClick={() => onArchive(r)} disabled={pending}>
                  <Archive className="size-3.5" aria-hidden />
                </IconButton>
              ) : (
                <IconButton label={`Restore ${r.title}`} onClick={() => onRestore(r)} disabled={pending}>
                  <ArchiveRestore className="size-3.5" aria-hidden />
                </IconButton>
              )}
              {/*
                Permanent deletion is Owner-only, archived-only, and confirmed. Three gates, because
                it is the one action on this page that cannot be undone.
              */}
              {onDelete && r.status === 'ARCHIVED' && (
                <IconButton
                  label={`Delete ${r.title} permanently`}
                  danger
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Permanently delete "${r.title}"? This cannot be undone. Its rule and text are lost.`)) {
                      onDelete(r)
                    }
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </IconButton>
              )}
              {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
            </span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-4 py-6 text-sm text-muted-foreground">Nothing here yet.</li>
        )}
      </ul>
    </div>
  )
}

function IconButton({
  label, onClick, disabled, danger, children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'cyber-clip-sm inline-flex size-8 items-center justify-center border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        danger
          ? 'border-[var(--hot-red)] text-[var(--hot-red)] hover:bg-[var(--hot-red)] hover:text-[var(--clean-white)]'
          : 'border-[var(--line-strong)] text-muted-foreground hover:border-[var(--cyan)] hover:text-[var(--cyan)]',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  )
}
