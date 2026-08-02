'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

import { Container } from '@/components/ui/container'
import { cn } from '@/lib/utils'

/**
 * Sticky, horizontally-scrollable year selector for the seasons archive. Each year
 * is a real link (?year=YYYY) so it's server-rendered per year and keyboard
 * accessible; the active year is centered in view.
 */
export function YearSlider({ years, selected }: { years: number[]; selected: number }) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-year="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selected])

  return (
    <div className="border-b border-border">
      <Container>
        <nav ref={ref} aria-label="Select season year" className="-mx-1 flex gap-1 overflow-x-auto py-2">
          {years.map((y) => (
            <Link
              key={y}
              href={`/seasons?year=${y}`}
              data-year={y}
              scroll={false}
              aria-current={y === selected ? 'true' : undefined}
              className={cn(
                'tabular rounded-md px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                y === selected
                  ? 'bg-gold/15 text-gold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {y}
            </Link>
          ))}
        </nav>
      </Container>
    </div>
  )
}
