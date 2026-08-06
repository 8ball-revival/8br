'use client'

import { useState } from 'react'
import { MessageCircle, Check } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * DiscordContactButton — the deliberate, safe Discord contact affordance. Discord is public
 * ONLY through this icon; the raw username is never printed as page text.
 *
 * Behavior is chosen from what is actually stored (audited: the value is usually a bare
 * username, from which Discord supports NO reliable DM deep-link):
 *  - a Discord URL (discord.com/discord.gg) → open it;
 *  - a numeric user ID (snowflake) → open https://discord.com/users/<id>;
 *  - anything else (bare username) → copy to clipboard (no fabricated DM link).
 * Email is NEVER used as a fallback. Accessible label: "Message <name> on Discord".
 */

function classify(value: string): { kind: 'url' | 'id' | 'username'; href?: string } {
  const v = value.trim()
  if (/^https?:\/\//i.test(v) || /(^|\.)discord\.(gg|com)\//i.test(v)) {
    return { kind: 'url', href: /^https?:\/\//i.test(v) ? v : `https://${v}` }
  }
  if (/^\d{17,20}$/.test(v)) return { kind: 'id', href: `https://discord.com/users/${v}` }
  return { kind: 'username' }
}

export function DiscordContactButton({
  discord,
  name,
  className,
}: {
  discord: string | null | undefined
  name: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const value = (discord || '').trim()
  if (!value) return null

  const { kind, href } = classify(value)
  const label = `Message ${name} on Discord`
  const base = cn(
    'inline-flex items-center justify-center rounded-md border border-border bg-card/60 p-2 text-[#5865F2] transition-colors hover:bg-card hover:text-[#5865F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
    className,
  )

  if (kind !== 'username' && href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={base}>
        <MessageCircle className="size-4" aria-hidden />
      </a>
    )
  }

  // Bare username → copy to clipboard (safest supported behavior; no fabricated DM link).
  return (
    <button
      type="button"
      aria-label={`${label} — copy Discord username`}
      title={`${label} — click to copy “${value}”`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable — no-op, never expose more */
        }
      }}
      className={base}
    >
      {copied ? <Check className="size-4 text-success" aria-hidden /> : <MessageCircle className="size-4" aria-hidden />}
    </button>
  )
}
