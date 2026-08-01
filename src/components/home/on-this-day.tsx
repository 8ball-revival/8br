'use client'

import { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'

import { PlayerAvatar } from '@/components/home/primitives'
import { cn } from '@/lib/utils'
import type { OnThisDayItem } from '@/lib/home/fixtures'

export function OnThisDay({ items }: { items: OnThisDayItem[] }) {
  const [i, setI] = useState(0)

  useEffect(() => {
    if (items.length < 2) return
    const id = setInterval(() => setI((v) => (v + 1) % items.length), 6000)
    return () => clearInterval(id)
  }, [items.length])

  const item = items[i]
  if (!item) return null

  return (
    <div className="flex h-full flex-col justify-between rounded-lg border border-gold/20 bg-gradient-to-br from-gold/[0.06] to-card p-4">
      <div>
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-gold" />
          <h3 className="eyebrow text-gold">On This Day</h3>
        </div>
        <div className="mt-3 flex items-start gap-3">
          <PlayerAvatar name={item.player} size="lg" />
          <div className="min-w-0">
            <p className="tabular text-sm font-semibold text-foreground">{item.date}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.text}</p>
          </div>
        </div>
      </div>

      {items.length > 1 && (
        <div className="mt-4 flex items-center gap-1.5">
          {items.map((it, idx) => (
            <button
              key={it.id}
              type="button"
              aria-label={`Show event ${idx + 1}`}
              aria-current={idx === i}
              onClick={() => setI(idx)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                idx === i ? 'w-5 bg-gold' : 'w-1.5 bg-border hover:bg-muted-foreground',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
