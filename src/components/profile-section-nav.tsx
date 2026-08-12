'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Link2 } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { cn } from '@/lib/utils'

export interface ProfileNavSection {
  id: string
  label: string
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Sticky, scroll-spy section nav for the player profile. Highlights the section
 * in view, scrolls smoothly (respecting reduced-motion), keeps the URL hash in
 * sync, supports deep-linking, and offers a Copy Profile Link action with an
 * accessible toast. Anchors remain real links → keyboard accessible by default.
 */
export function ProfileSectionNav({ sections }: { sections: ProfileNavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '')
  const [copied, setCopied] = useState(false)
  const navRef = useRef<HTMLElement>(null)

  // Deep-link: honour an incoming hash on mount (deferred to avoid a sync
  // setState in the effect body).
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash && sections.some((s) => s.id === hash)) {
      const raf = requestAnimationFrame(() => setActive(hash))
      return () => cancelAnimationFrame(raf)
    }
  }, [sections])

  // Scroll-spy: mark the topmost section currently in the reading area.
  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el != null)
    if (els.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      // Offset for the sticky site header + this nav; trigger before the section hits the very top.
      { rootMargin: '-120px 0px -60% 0px', threshold: 0 },
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [sections])

  // Keep the active tab visible within the horizontally-scrolling nav (mobile).
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>(`[data-nav-id="${active}"]`)
    el?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [active])

  const handleClick = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    history.replaceState(null, '', `#${id}`)
    setActive(id)
  }, [])

  const copyLink = useCallback(async () => {
    try {
      const url = window.location.href.split('#')[0]
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (e.g. insecure context) — fail silently.
    }
  }, [])

  return (
    <div className="sticky top-16 z-30 border-b border-border bg-background/85 backdrop-blur">
      <Container>
        <div className="flex items-center gap-2">
          <nav
            ref={navRef}
            aria-label="Profile sections"
            className="-mx-1 flex flex-1 gap-1 overflow-x-auto py-2"
          >
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                data-nav-id={s.id}
                aria-current={active === s.id ? 'true' : undefined}
                onClick={(e) => handleClick(e, s.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active === s.id
                    ? 'bg-brand/10 text-brand'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {s.label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            onClick={copyLink}
            aria-label="Copy profile link"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {copied ? (
              <>
                <Check className="size-4 text-success" aria-hidden /> Copied
              </>
            ) : (
              <>
                <Link2 className="size-4" aria-hidden />
                <span className="hidden sm:inline">Copy link</span>
              </>
            )}
          </button>
        </div>
      </Container>

      <div
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-card px-4 py-2 text-sm shadow-lg transition-opacity duration-200 motion-reduce:transition-none',
          copied ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-4 text-success" aria-hidden /> Profile link copied
        </span>
      </div>
    </div>
  )
}
