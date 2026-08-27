'use client'

import { useState } from 'react'
import { Loader2, X } from 'lucide-react'

import { addAliasAction, removeAliasAction } from '@/lib/players/alias-actions'
import { cn } from '@/lib/utils'

/**
 * Full alias management for one member.
 *
 * Aliases are how somebody stays findable under a handle they no longer use — search, entrant
 * matching and archive reconciliation all consult them. A rename records one automatically; this is
 * for the far more common case where the rename happened before this site existed and the old
 * handle was never captured.
 *
 * Lives on the member's own page rather than the roster, because removing an alias can break a
 * match that currently works and that is not a decision to make from a list of a hundred rows. The
 * roster gets a quick-add field only.
 *
 * An alias is a spelling and a key. `Big_Nav` and `bignav` must be ONE alias, so the key is
 * normalised and everything matches on that; the spelling is kept beside it and is what the panel
 * shows. The key is shown underneath when the two differ, because this is the screen where somebody
 * needs to see what will actually be matched.
 *
 * Aliases recorded before the spelling column existed have only a key, so that is what they show —
 * they are corrected by removing and re-adding them, not by a migration inventing a spelling.
 */
export function AliasManager({
  playerId,
  initial,
}: {
  playerId: string
  initial: { id: string; alias: string; display: string }[]
}) {
  const [aliases, setAliases] = useState(initial)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const raw = value.trim()
    if (!raw) return
    setBusy(true)
    setError(null)
    const res = await addAliasAction(playerId, raw)
    if (!res.ok) setError(res.error ?? 'That alias could not be recorded.')
    else { setAliases(res.aliases ?? aliases); setValue('') }
    setBusy(false)
  }

  async function remove(aliasId: string) {
    setBusy(true)
    setError(null)
    const res = await removeAliasAction(playerId, aliasId)
    if (!res.ok) setError(res.error ?? 'That alias could not be removed.')
    else setAliases(res.aliases ?? aliases)
    setBusy(false)
  }

  return (
    <section className="rounded-none border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Aliases</h2>
      <p className="mt-1 text-[0.7rem] text-muted-foreground">
        Other handles this player has been known by. Search, entrant matching and the archive all
        look these up, so an old handle recorded here keeps finding the right person. Stored in
        lowercase without punctuation, which is how they are matched.
      </p>

      {aliases.length === 0 ? (
        <p className="mt-3 text-[0.7rem] text-muted-foreground">No aliases recorded.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {aliases.map((a) => (
            <li
              key={a.id}
              className="inline-flex items-center gap-1 cyber-clip-sm border border-border bg-background px-2.5 py-1 text-xs"
            >
              <span className="font-mono">
                {a.display}
                {a.display !== a.alias && (
                  <span className="ml-2 text-xs text-muted-foreground">matches as {a.alias}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => void remove(a.id)}
                disabled={busy}
                aria-label={`Remove the alias ${a.display}`}
                className="rounded text-muted-foreground hover:text-destructive disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-3 flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add an alias"
          aria-label="Add an alias"
          autoComplete="off"
          spellCheck={false}
          className="w-48 rounded-none border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-none border border-border px-3 py-1.5 text-xs font-semibold',
            'disabled:opacity-50',
          )}
        >
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Add
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-[0.7rem] text-destructive">{error}</p>
      )}
    </section>
  )
}
