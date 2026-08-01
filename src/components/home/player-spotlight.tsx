'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, UserCircle2 } from 'lucide-react'

import { PlayerAvatar } from '@/components/home/primitives'
import { cn } from '@/lib/utils'
import type { SpotlightPlayer } from '@/lib/spotlight/fixtures'

const STORAGE_KEY = '8br-spotlight-me'

function Tile({ label, value, gold }: { label: string; value: React.ReactNode; gold?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 text-center">
      <div className={cn('tabular text-2xl font-bold tracking-tight', gold ? 'text-gold' : 'text-foreground')}>
        {value}
      </div>
      <div className="mt-0.5 text-[0.65rem] tracking-wide text-muted-foreground uppercase">{label}</div>
    </div>
  )
}

/**
 * "Who are you" spotlight. Visitors pick themselves from the registrant list; the
 * choice is remembered on the device (localStorage) and the card defaults to it on
 * return. Sized with h-full so it matches the Top 10 panel for a symmetrical row.
 */
export function PlayerSpotlight({ players }: { players: SpotlightPlayer[] }) {
  const [slug, setSlug] = useState<string | null>(null)

  const options = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  )

  // Restore the remembered identity after mount (deferred to avoid a synchronous
  // setState in the effect body, and to keep SSR/first paint stable).
  useEffect(() => {
    let raf = 0
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && players.some((p) => p.slug === saved)) {
        raf = requestAnimationFrame(() => setSlug(saved))
      }
    } catch {
      // localStorage unavailable — fall back to the prompt state.
    }
    return () => cancelAnimationFrame(raf)
  }, [players])

  function choose(value: string) {
    setSlug(value || null)
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore write failures (private mode, etc.).
    }
  }

  const player = players.find((p) => p.slug === slug) ?? null

  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="eyebrow text-foreground">Player Spotlight</h2>
        <div className="relative shrink-0">
          <select
            value={slug ?? ''}
            onChange={(e) => choose(e.target.value)}
            aria-label="Select which player you are"
            className="cursor-pointer appearance-none rounded-md border border-border bg-background py-1 pr-7 pl-2.5 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">I am…</option>
            {options.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
      </header>

      <div className="flex flex-1 flex-col p-4">
        {player ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <PlayerAvatar name={player.name} size="xl" />
            <h3 className="mt-4 font-display text-xl font-bold tracking-tight">{player.name}</h3>
            {player.handle && (
              <p className="mt-0.5 max-w-full truncate text-sm text-muted-foreground">@{player.handle}</p>
            )}
            <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
              <Tile label="Season Titles" value={player.seasonTitles} gold={player.seasonTitles > 0} />
              <Tile label="Cup Titles" value={player.cupTitles} gold={player.cupTitles > 0} />
              <Tile
                label="All-Time Rank"
                value={player.allTimeRank ? `#${player.allTimeRank}` : '—'}
                gold={player.allTimeRank === 1}
              />
              <Tile label="Time Zone" value={player.timezone} />
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <UserCircle2 className="size-12 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-display text-base font-semibold">Who are you?</p>
              <p className="mx-auto mt-1 max-w-[15rem] text-sm text-muted-foreground">
                Pick your name above to see your stats. We&apos;ll remember it on this device.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
