'use client'

import { useRef, useState } from 'react'
import { Check, ExternalLink, Settings2, Share2 } from 'lucide-react'
import { ProfileAvatar } from './profile-avatar'
import { CountUp, usePointerTilt, usePrefersReducedMotion } from './motion'
import type { ProfileIdentity } from '@/lib/players/profile'

/**
 * Who this player is, and how good they are — the first two things the profile has to say.
 *
 * ── The hierarchy, in the order the eye should take it ──────────────────────────────────────────
 * The avatar and the handle lead at full size. The name sits under the handle and the aliases under
 * that, each quieter than the last. Rank and rating close the row as the two headline figures.
 *
 * ── Why the utility controls are small ──────────────────────────────────────────────────────────
 * CueVerse Profile, Share and Edit used to be a column of buttons in the middle of the header,
 * which gave three rarely-used controls the most valuable space on the page and left the identity
 * competing with them. They are now what they are: a text link and a compact control beside the
 * aliases, and — for the owner — one small settings button in the corner. All three keep their
 * labels, their keyboard focus and their behaviour; only their weight changed.
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
  const headerRef = useRef<HTMLElement>(null)
  const reduced = usePrefersReducedMotion()
  usePointerTilt(headerRef, !reduced)

  /**
   * Share, the way the device does it.
   *
   * `navigator.share` opens the real system sheet on a phone; desktop browsers mostly do not
   * implement it, so the fallback copies the canonical URL and says so — a Share control that
   * silently does nothing is worse than none. A cancelled sheet rejects with AbortError, which is
   * somebody changing their mind rather than a failure, and must not show an error.
   */
  const share = async () => {
    const title = `${identity.name} — 8 Ball Registry`
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: `${identity.name}'s 8 Ball Registry profile`, url: shareUrl })
        setShared('Shared')
        window.setTimeout(() => setShared(null), 3000)
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShared('Link copied')
    } catch {
      setShared(shareUrl)
    }
    window.setTimeout(() => setShared(null), 3200)
  }

  const cueverseHref = identity.cueverseId
    ? `https://cueverse.gg/profile/?name=${encodeURIComponent(identity.cueverseId)}&game=pool`
    : null

  return (
    <header ref={headerRef} className="pf-identity pf-reveal">
      {/*
        The accent wash. Purely decorative, drawn from the player's own accent so a customised
        profile is recognisable at a glance, and `aria-hidden` because it says nothing.
      */}
      <span aria-hidden className="pf-identity-wash" />

      {/* Owner-only, and deliberately the smallest control in the header. */}
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="pf-icon-btn pf-press absolute right-3 top-3 z-20"
          aria-label="Edit profile appearance"
          title="Edit profile"
        >
          <Settings2 className="size-4" aria-hidden />
        </button>
      )}

      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-7">
        {/* ── Identity ──────────────────────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <ProfileAvatar
            name={identity.name}
            src={identity.avatarUrl}
            framing={{
              focalX: identity.avatarFocalX,
              focalY: identity.avatarFocalY,
              zoom: identity.avatarZoom,
              shape: identity.avatarShape,
            }}
            size="xl"
          />

          <div className="min-w-0">
            <h1 className="pf-handle truncate">{identity.name}</h1>
            {identity.displayName && <p className="pf-realname truncate">{identity.displayName}</p>}

            {identity.aliases.length > 0 && (
              <div className="mt-2 max-w-md">
                <p className="pf-label">Also known as</p>
                <p className="pf-aliases">{identity.aliases.join(', ')}</p>
              </div>
            )}

            {/*
              The utility row: a text link and a compact control, beneath the aliases.
              Small, adjacent, and out of the way of everything above them.
            */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {cueverseHref && (
                <a
                  href={cueverseHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pf-utility pf-press"
                >
                  CueVerse Profile
                  <ExternalLink className="size-3 pf-arrow" aria-hidden />
                </a>
              )}
              <button type="button" onClick={share} className="pf-utility pf-press">
                <Share2 className="size-3" aria-hidden />
                Share Profile
              </button>
              <span aria-live="polite" className="pf-utility-note">
                {shared && (
                  <span className="inline-flex items-center gap-1">
                    <Check className="size-3" aria-hidden />
                    {shared}
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* ── The two headline figures ──────────────────────────────────────────────────────── */}
        <dl className="ml-auto flex shrink-0 items-start gap-6 sm:gap-10">
          <div>
            <dt className="pf-label">Current Rank</dt>
            <dd className="pf-headline pf-headline-accent">
              {rank != null ? <CountUp value={rank} prefix="#" /> : '—'}
            </dd>
          </div>
          <div className="pf-headline-divider pl-6 sm:pl-10">
            <dt className="pf-label">Current Rating</dt>
            <dd className="pf-headline">
              {rating != null ? <CountUp value={rating} /> : '—'}
            </dd>
          </div>
        </dl>
      </div>
    </header>
  )
}
