'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'

import type { DirectoryPlayer } from '@/lib/players/directory'
import { updatePlayerIdentityAction } from '@/lib/players/directory-actions'

/**
 * The Players directory.
 *
 * ── Search is client-side, deliberately ─────────────────────────────────────────────────────────
 * Five hundred names is small enough to filter in the browser, and doing it there makes typing
 * instant instead of a round trip per keystroke. A server search would be the right answer at ten
 * thousand; it is the wrong one here.
 *
 * ── The admin controls are a convenience, never the check ───────────────────────────────────────
 * `canEdit` decides whether the editing controls are DRAWN. It decides nothing about whether the
 * edit is allowed: `updatePlayerIdentityAction` re-establishes `manage_players` on the server every
 * time, because a server action is a public endpoint and a form that is not rendered stops nobody.
 */
export function PlayersDirectory({ players, canEdit }: {
  players: DirectoryPlayer[]
  canEdit: boolean
}) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState(players)
  const [editing, setEditing] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((p) =>
      (p.cueverseId ?? '').toLowerCase().includes(q) || p.preferredName.toLowerCase().includes(q))
  }, [rows, query])

  const save = (id: string, cueverseId: string, preferredName: string) => {
    start(async () => {
      const r = await updatePlayerIdentityAction(id, { cueverseId, preferredName })
      if (r.error) { setMessage({ ok: false, text: r.error }); return }
      /*
        The row is updated in place from what was typed, rather than the page being reloaded. The
        server has already written and propagated it; re-fetching five hundred rows to show two
        changed words would throw away the reader's scroll position and their search.
      */
      setRows((list) => list.map((p) => (
        p.id === id ? { ...p, cueverseId: cueverseId || p.cueverseId, preferredName: preferredName || p.preferredName } : p
      )))
      setEditing(null)
      setMessage({
        ok: true,
        text: r.propagated
          ? `Saved — ${r.propagated} record${r.propagated === 1 ? '' : 's'} re-labelled.`
          : 'Saved.',
      })
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="sr-only" htmlFor="player-search">Search players</label>
        <input
          id="player-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by CueVerse ID or name…"
          className="w-full max-w-sm rounded-none border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
        />
        <p className="text-sm text-muted-foreground">
          {shown.length === rows.length
            ? `${rows.length} active player${rows.length === 1 ? '' : 's'}`
            : `${shown.length} of ${rows.length}`}
        </p>
      </div>

      {message && (
        <p
          aria-live="polite"
          className={`mt-3 text-sm ${message.ok ? 'text-[var(--neon-cyan)]' : 'text-destructive'}`}
        >
          {message.text}
        </p>
      )}

      {/*
        The table scrolls inside its own frame rather than making the page 20,000 pixels tall.

        Five hundred rows in the document flow is a page nobody can navigate: the header scrolls
        away, the footer is unreachable, and the search box the reader needs is somewhere above
        them. Bounding it keeps the search and the column headings on screen while the names move,
        which is what the Rankings table already does with the same amount of data.
      */}
      <div className="scrollbar-metal mt-4 max-h-[calc(100dvh-20rem)] min-h-[20rem] overflow-auto border border-border">
        <table className="w-full min-w-max text-sm">
          <caption className="sr-only">Every active player, with their CueVerse ID and preferred name.</caption>
          <thead>
            {/* Sticky, so the columns stay named however far down the list the reader is. */}
            <tr className="sticky top-0 z-10 border-b border-border bg-[var(--surface)] shadow-[0_1px_0_var(--border)]">
              <th scope="col" className="px-3 py-2 text-left font-semibold">CueVerse ID</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Preferred Name</th>
              {/*
                Matches and Account are administrative detail, not what a visitor came for.

                A reader looking somebody up wants the name and the way through to their profile;
                how many matches are on file and whether a login is attached are facts about the
                RECORD rather than about the player, and they are the two columns an administrator
                actually needs when deciding whether an identity is safe to correct.
              */}
              {canEdit && <th scope="col" className="px-3 py-2 text-right font-semibold">Matches</th>}
              {canEdit && <th scope="col" className="px-3 py-2 text-left font-semibold">Account</th>}
              {canEdit && <th scope="col" className="px-3 py-2 text-right font-semibold">Edit</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              editing === p.id ? (
                <EditRow key={p.id} player={p} pending={pending} onCancel={() => setEditing(null)} onSave={save} />
              ) : (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {p.slug
                      ? <Link href={`/players/${encodeURIComponent(p.slug)}`} className="text-brand hover:underline">{p.cueverseId ?? '—'}</Link>
                      : (p.cueverseId ?? '—')}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{p.preferredName}</td>
                  {canEdit && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p.matches || '—'}</td>}
                  {canEdit && <td className="px-3 py-2 text-muted-foreground">{p.hasAccount ? 'Yes' : 'Archive'}</td>}
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => { setMessage(null); setEditing(p.id) }}
                        className="cyber-clip border border-[var(--gold)]/50 px-2 py-1 text-xs font-semibold uppercase tracking-wider hover:bg-white/[0.06]"
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              )
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={canEdit ? 5 : 2} className="px-3 py-6 text-center text-muted-foreground">No player matches that.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * One row, being edited.
 *
 * Its own component so the inputs hold their own state: keeping five hundred rows' worth of draft
 * values in the table above would re-render the whole list on every keystroke.
 */
function EditRow({ player, pending, onCancel, onSave }: {
  player: DirectoryPlayer
  pending: boolean
  onCancel: () => void
  onSave: (id: string, cueverseId: string, preferredName: string) => void
}) {
  const [handle, setHandle] = useState(player.cueverseId ?? '')
  const [name, setName] = useState(player.preferredName)

  return (
    <tr className="border-b border-border/60 bg-[var(--selected-surface)] last:border-0">
      <td className="px-3 py-2">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          aria-label={`CueVerse ID for ${player.preferredName}`}
          className="w-40 rounded-none border border-input bg-card px-2 py-1 text-sm outline-none focus-visible:border-brand"
        />
      </td>
      <td className="px-3 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`Preferred name for ${player.preferredName}`}
          className="w-40 rounded-none border border-input bg-card px-2 py-1 text-sm outline-none focus-visible:border-brand"
        />
      </td>
      {/* Only ever rendered for an administrator, so these two always belong here. */}
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{player.matches || '—'}</td>
      <td className="px-3 py-2 text-muted-foreground">{player.hasAccount ? 'Yes' : 'Archive'}</td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => onSave(player.id, handle.trim(), name.trim())}
            className="cyber-clip border border-[var(--gold)]/60 bg-[var(--gold)]/10 px-2 py-1 text-xs font-semibold uppercase tracking-wider disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="cyber-clip border border-border px-2 py-1 text-xs font-semibold uppercase tracking-wider disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  )
}
