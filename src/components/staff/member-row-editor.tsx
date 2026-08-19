'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { adminUpdateMemberProfileAction } from '@/lib/staff/member-profile-actions'
import { addAliasAction } from '@/lib/players/alias-actions'

const cell =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-foreground outline-none ' +
  'hover:border-border focus:border-brand focus:bg-background focus-visible:ring-2 focus-visible:ring-brand/25'

/**
 * One editable row of the Member Management table: CueVerse ID and Preferred Name in place.
 *
 * The Save button only appears once something has actually changed, so the table reads as a table
 * until you edit it. Saving goes through the same admin profile action the member page uses, which
 * validates, renames the login, writes the audit entry and pushes the new identity out to every
 * season and tournament the player appears in — so the row count it reports back is the number of
 * competition records that were re-labelled.
 */
export function MemberRowEditor({
  userId,
  playerId,
  cueverseId,
  preferredName,
  canEdit,
}: {
  userId: number
  /** Null when the account has no canonical profile yet — there is nothing to alias. */
  playerId: string | null
  cueverseId: string | null
  preferredName: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [id, setId] = useState(cueverseId ?? '')
  const [name, setName] = useState(preferredName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const idChanged = id.trim() !== (cueverseId ?? '')
  const nameChanged = name.trim() !== (preferredName ?? '')
  const dirty = idChanged || nameChanged

  async function save() {
    if (!dirty || saving) return
    setError(null)
    setSaved(null)
    setSaving(true)
    try {
      const res = await adminUpdateMemberProfileAction(userId, {
        ...(idChanged ? { cueverseId: id.trim() } : {}),
        ...(nameChanged ? { preferredName: name.trim() } : {}),
      })
      if (res.error) {
        setError(res.error)
        return
      }
      setSaved(
        res.propagated
          ? `Saved — ${res.propagated} competition record${res.propagated === 1 ? '' : 's'} updated.`
          : 'Saved.',
      )
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? `Could not save: ${e.message}` : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  function revert() {
    setId(cueverseId ?? '')
    setName(preferredName ?? '')
    setError(null)
    setSaved(null)
  }

  if (!canEdit) {
    return (
      <>
        <td className="px-4 py-2.5">
          <Link href={`/staff/members/${userId}`} className="text-muted-foreground hover:text-brand">
            {cueverseId ? `@${cueverseId}` : '—'}
          </Link>
        </td>
        <td className="px-4 py-2.5">{preferredName || <span className="italic text-muted-foreground">—</span>}</td>
      </>
    )
  }

  return (
    <>
      <td className="px-4 py-2 align-top">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">@</span>
          <input
            value={id}
            onChange={(e) => { setId(e.target.value); setSaved(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') revert() }}
            aria-label="CueVerse ID"
            spellCheck={false}
            autoComplete="off"
            className={cn(cell, idChanged && 'border-brand/60')}
          />
        </div>
      </td>
      <td className="px-4 py-2 align-top">
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') revert() }}
          aria-label="Preferred name"
          placeholder="—"
          autoComplete="off"
          className={cn(cell, nameChanged && 'border-brand/60')}
        />
        {dirty && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !id.trim()}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={revert}
              disabled={saving}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold"
            >
              Cancel
            </button>
            <span className="text-[0.7rem] text-muted-foreground">Enter saves &middot; Esc reverts</span>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-1.5 text-[0.7rem] text-destructive">
            {error}
          </p>
        )}
        {saved && !dirty && (
          <p className="mt-1.5 text-[0.7rem] text-success" aria-live="polite">
            {saved}
          </p>
        )}
      </td>
      <td className="px-4 py-2 align-top">
        <QuickAlias playerId={playerId} disabled={!canEdit} />
      </td>
    </>
  )
}

/**
 * Add one alias without leaving the roster.
 *
 * Add only. Removing an alias can break a lookup that currently works — a search, an entrant match,
 * an archive reconciliation — and that is not a judgement to make from a table of a hundred rows,
 * so the full list with its remove buttons lives on the member's own page.
 *
 * The field empties on success and reports the stored form, which is normalised and therefore often
 * not what was typed. Showing it back is the only way to make that visible.
 */
function QuickAlias({ playerId, disabled }: { playerId: string | null; disabled: boolean }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!playerId) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  async function submit() {
    const raw = value.trim()
    if (!raw || !playerId) return
    setBusy(true); setError(null); setAdded(null)
    const res = await addAliasAction(playerId, raw)
    if (!res.ok) setError(res.error ?? 'Could not record that alias.')
    else {
      setValue('')
      setAdded(res.aliases?.[res.aliases.length - 1]?.alias ?? raw)
    }
    setBusy(false)
  }

  return (
    <div>
      <input
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); setAdded(null) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
        onBlur={() => { if (value.trim()) void submit() }}
        disabled={disabled || busy}
        placeholder="Add alias"
        aria-label="Add an alias"
        autoComplete="off"
        spellCheck={false}
        className={cn(cell, value.trim() && 'border-brand/60')}
      />
      {busy && <p className="mt-1 text-[0.68rem] text-muted-foreground">Saving…</p>}
      {added && !busy && <p className="mt-1 text-[0.68rem] text-success">Added @{added}</p>}
      {error && <p className="mt-1 text-[0.68rem] text-destructive">{error}</p>}
    </div>
  )
}
