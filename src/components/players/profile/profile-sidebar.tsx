'use client'

import { useState, useTransition } from 'react'
import { Check, Pencil, Share2 } from 'lucide-react'
import { PlayerAvatar } from '@/components/primitives'
import { updateProfileNameAction } from '@/lib/players/profile-actions'
import { cn } from '@/lib/utils'

/**
 * Who this profile is, and the two things a visitor can do with it.
 *
 * On a wide screen this is the left rail beside the tabs; below `lg` the same content becomes a
 * compact header across the top, because a sidebar on a phone is just a very tall preamble before
 * the thing somebody came to read.
 */

export interface SidebarStats {
  rank: number | null
  rating: number | null
  wins: number
  losses: number
  draws: number
  winPct: number
  /** Signed: positive is a winning run, negative a losing one. */
  streak: number
  longestWinStreak: number
}

export function ProfileSidebar({
  playerId, handle, displayName, shareUrl, stats, canEdit,
}: {
  playerId: string
  handle: string
  displayName: string | null
  /** The canonical, absolute profile URL — what Share hands over. */
  shareUrl: string
  stats: SidebarStats
  canEdit: boolean
}) {
  const [name, setName] = useState(displayName ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(displayName ?? '')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const [shared, setShared] = useState<string | null>(null)

  /**
   * Share, the way the device does it.
   *
   * `navigator.share` opens the real system sheet on a phone — messages, mail, whatever is
   * installed — which is what somebody expects from a Share button there. Desktop browsers mostly
   * do not implement it, so the fallback copies the canonical URL and says so out loud; a Share
   * button that silently does nothing is worse than no Share button.
   *
   * A cancelled share sheet rejects with AbortError. That is somebody changing their mind, not a
   * failure, and it must not put an error on screen.
   */
  const share = async () => {
    const title = `${handle} — 8 Ball Registry`
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: `${handle}'s 8 Ball Registry profile`, url: shareUrl })
        setShared('Shared.')
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        // Anything else falls through to the clipboard rather than dead-ending.
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShared('Profile link copied')
    } catch {
      setShared('Copy this link: ' + shareUrl)
    }
    window.setTimeout(() => setShared(null), 3200)
  }

  const save = () => {
    start(async () => {
      const r = await updateProfileNameAction(playerId, draft)
      if (r.error) { setMessage({ ok: false, text: r.error }); return }
      setName(r.name ?? draft)
      setEditing(false)
      setMessage({ ok: true, text: 'Profile updated.' })
    })
  }

  const record = `${stats.wins}–${stats.losses}${stats.draws > 0 ? `–${stats.draws}` : ''}`
  const streakLabel = stats.streak === 0 ? '—' : stats.streak > 0 ? `W${stats.streak}` : `L${Math.abs(stats.streak)}`

  return (
    <aside
      aria-label="Player summary"
      className="dl-surface border border-border bg-card p-4 lg:sticky lg:top-4 lg:self-start"
    >
      {/*
        Identity. Horizontal on a phone so the header stays compact; stacked from `lg`, where it is
        the top of a rail.
      */}
      <div className="flex items-center gap-3 lg:flex-col lg:items-start lg:gap-3">
        {/* A monogram, deliberately. Photographs are a later pass and this is not a placeholder for
            one — it is what the profile shows until then. */}
        <PlayerAvatar name={handle} size="lg" className="shrink-0" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold text-foreground lg:text-2xl">{handle}</h1>
          {name && name.toLowerCase() !== handle.toLowerCase() && (
            <p className="truncate text-sm text-muted-foreground">{name}</p>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3 lg:grid-cols-2">
        <Stat label="Rank" value={stats.rank != null ? `#${stats.rank}` : '—'} />
        <Stat label="Rating" value={stats.rating != null ? String(stats.rating) : '—'} accent />
        <Stat label="Record" value={record} />
        <Stat label="Win %" value={`${stats.winPct.toFixed(1)}%`} />
        <Stat label="Streak" value={streakLabel} />
        <Stat label="Longest Win Streak" value={stats.longestWinStreak > 0 ? `W${stats.longestWinStreak}` : '—'} />
      </dl>
      <p className="mt-2 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
        Official 8 Ball Registry record
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={share}
          className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground transition-colors hover:border-[var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <Share2 className="size-3.5" aria-hidden />
          Share Profile
        </button>
        {/* Rendered for the owner and for staff who hold player management. The action re-checks. */}
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => { setDraft(name); setEditing(true); setMessage(null) }}
            className="inline-flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground transition-colors hover:border-[var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Pencil className="size-3.5" aria-hidden />
            Edit Profile
          </button>
        )}
      </div>

      {/* Confirmation, visible rather than assumed — the whole point of the clipboard fallback. */}
      <p aria-live="polite" className="mt-2 min-h-[1.1rem] text-xs text-muted-foreground">
        {shared ? (
          <span className="inline-flex items-center gap-1 text-[var(--win,inherit)]">
            <Check className="size-3.5" aria-hidden />
            {shared}
          </span>
        ) : ''}
      </p>

      {canEdit && editing && (
        <div className="mt-3 border-t border-border pt-3">
          <label htmlFor="profile-preferred-name" className="eyebrow block text-foreground">Display name</label>
          <input
            id="profile-preferred-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={handle}
            className="mt-1 w-full border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The name shown beneath your CueVerse ID. Leave it empty to show the ID alone.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="border border-border bg-[var(--signal-fill,transparent)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setMessage(null) }}
              className="border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <p aria-live="polite" className={cn('mt-2 text-xs', message.ok ? 'text-muted-foreground' : 'text-destructive')}>
          {message.text}
        </p>
      )}
    </aside>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[0.62rem] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn('font-display text-lg font-bold', accent ? 'text-[var(--gold)]' : 'text-foreground')}>
        {value}
      </dd>
    </div>
  )
}
