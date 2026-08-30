'use client'

/**
 * Choosing a picture from the existing media library.
 *
 * The list is fetched once per editing session and cached in module scope. A picker that re-fetched
 * on every open would issue a request each time an administrator expanded a panel — the library is
 * small, changes rarely, and is the same for every field on the page.
 */

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ImageOff, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { listMediaAction } from '@/lib/site-builder/media-actions'

interface Item { id: number; url: string; alt: string | null }

let cache: Item[] | null = null
let inFlight: Promise<Item[]> | null = null

async function loadLibrary(): Promise<Item[]> {
  if (cache) return cache
  // Concurrent callers share one request. Four media fields opening at once should not be four
  // round trips for the same list.
  if (!inFlight) {
    inFlight = listMediaAction().then((r) => {
      cache = r.ok ? r.data : []
      inFlight = null
      return cache
    })
  }
  return inFlight
}

export function MediaPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    void loadLibrary().then((list) => { if (alive) setItems(list) })
    return () => { alive = false }
  }, [open])

  const selected = items?.find((i) => i.id === value) ?? null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex-1 border border-border px-2 py-1.5 text-left text-xs text-foreground hover:border-[var(--hot-red)]"
        >
          {value ? (selected?.alt || `Image #${value}`) : 'Choose an image…'}
        </button>
        {value != null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Remove image"
            className="border border-border p-1.5 text-muted-foreground hover:text-[var(--hot-red)]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div className="max-h-56 overflow-y-auto border border-border p-1.5">
          {items === null && <p className="p-2 text-[11px] text-muted-foreground">Loading the library…</p>}
          {items?.length === 0 && (
            <p className="flex items-center gap-1.5 p-2 text-[11px] text-muted-foreground">
              <ImageOff className="size-3.5" aria-hidden />
              There are no images in the media library yet. Upload one in the admin area first.
            </p>
          )}
          {items && items.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { onChange(item.id); setOpen(false) }}
                  className={cn(
                    'relative aspect-square overflow-hidden border',
                    value === item.id ? 'border-[var(--hot-red)]' : 'border-border hover:border-[var(--line-strong)]',
                  )}
                  title={item.alt ?? `Image ${item.id}`}
                >
                  <Image src={item.url} alt={item.alt ?? ''} fill sizes="120px" className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
