'use client'

import { useState } from 'react'
import { Check, ExternalLink, Pencil, Share2 } from 'lucide-react'
import { ProfileAvatar } from './profile-avatar'
import type { ProfileIdentity } from '@/lib/players/profile'

/**
 * The full-width band at the top of a profile: who this is, and the two things a visitor can do.
 *
 * Laid out as one rectangle rather than a column of cards, matching the reference: the avatar and
 * name lead, the aliases sit beside them, the actions next, and the two headline figures close the
 * row against the right edge with a rule between them.
 */
export function IdentityHeader({
  identity, rank, rating, shareUrl, canEdit, onEdit,
}: {
  identity: ProfileIdentity
  rank: number | null
  rating: number | null
  shareUrl: string
  canEdit: boolean
  onEdit: () => void
}) {
  const [shared, setShared] = useState<string | null>(null)

  /**
   * Share, the way the device does it.
   *
   * `navigator.share` opens the real system sheet on a phone. Desktop browsers mostly do not
   * implement it, so the fallback copies the canonical URL and says so — a Share button that
   * silently does nothing is worse than none. A cancelled sheet rejects with AbortError, which is
   * somebody changing their mind rather than a failure, and must not show an error.
   */
  const share = async () => {
    const title = `${identity.name} — 8 Ball Registry`
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: `${identity.name}'s 8 Ball Registry profile`, url: shareUrl })
        setShared('Shared.')
        window.setTimeout(() => setShared(null), 3000)
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShared('Profile link copied')
    } catch {
      setShared(shareUrl)
    }
    window.setTimeout(() => setShared(null), 3200)
  }

  const cueverseHref = identity.cueverseId
    ? `https://cueverse.gg/profile/?name=${encodeURIComponent(identity.cueverseId)}&game=pool`
    : null

  return (
    <header className="pf-panel">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <ProfileAvatar
            name={identity.name}
            src={identity.avatarUrl}
            framing={{ focalX: identity.avatarFocalX, focalY: identity.avatarFocalY, zoom: identity.avatarZoom }}
          />
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-extrabold uppercase tracking-tight sm:text-3xl lg:text-4xl" style={{ color: 'var(--pf-text)' }}>
              {identity.name}
            </h1>
            {identity.displayName && (
              <p className="truncate text-sm" style={{ color: 'var(--pf-accent)' }}>{identity.displayName}</p>
            )}
          </div>
        </div>

        {/* Aliases — the handles this player has been known by. */}
        {identity.aliases.length > 0 && (
          <div className="min-w-0 lg:max-w-[16rem] lg:border-l lg:pl-6" style={{ borderColor: 'var(--pf-border)' }}>
            <p className="pf-label">Also known as</p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--pf-muted)' }}>
              {identity.aliases.join(', ')}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex shrink-0 flex-col gap-2 lg:border-l lg:pl-6" style={{ borderColor: 'var(--pf-border)' }}>
          {cueverseHref && (
            <a
              href={cueverseHref}
              target="_blank"
              rel="noopener noreferrer"
              className="pf-label inline-flex items-center gap-1.5 transition-colors hover:opacity-80"
            >
              CueVerse Profile
              <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={share} className="pf-btn inline-flex items-center gap-1.5 px-3 py-1.5">
              <Share2 className="size-3.5" aria-hidden />
              Share Profile
            </button>
            {/* Drawn only when the server said so; every action behind it re-checks independently. */}
            {canEdit && (
              <button type="button" onClick={onEdit} className="pf-btn inline-flex items-center gap-1.5 px-3 py-1.5">
                <Pencil className="size-3.5" aria-hidden />
                Edit Profile
              </button>
            )}
          </div>
          <p aria-live="polite" className="min-h-[1rem] text-[0.68rem]" style={{ color: 'var(--pf-muted)' }}>
            {shared && (
              <span className="inline-flex items-center gap-1">
                <Check className="size-3" aria-hidden />
                {shared}
              </span>
            )}
          </p>
        </div>

        {/* The two headline figures, closing the row. */}
        <dl className="ml-auto flex shrink-0 gap-6 lg:gap-10">
          <div className="lg:border-l lg:pl-6" style={{ borderColor: 'var(--pf-border)' }}>
            <dt className="pf-label">Current Rank</dt>
            <dd className="pf-figure mt-1 text-3xl lg:text-4xl">{rank != null ? `#${rank}` : '—'}</dd>
          </div>
          <div className="lg:border-l lg:pl-6" style={{ borderColor: 'var(--pf-border)' }}>
            <dt className="pf-label">Current Rating</dt>
            <dd className="pf-figure pf-figure-accent mt-1 text-3xl lg:text-4xl">{rating != null ? rating : '—'}</dd>
          </div>
        </dl>
      </div>
    </header>
  )
}
