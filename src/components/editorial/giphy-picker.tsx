'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'

import { searchGiphyAction, pickGiphyAction } from '@/lib/media/giphy-actions'

/**
 * The GIF picker.
 *
 * Search is debounced, results are keyboard navigable, and every state a network-backed grid can be in
 * is drawn explicitly: loading, empty, error, and more-to-load. Nothing here holds up the article
 * text — the picker lives beside the textarea and a GIPHY failure closes over itself.
 *
 * When the server has no GIPHY key the picker says so rather than appearing broken. That is the
 * development case: an editor missing a credential should explain what is missing, not fail silently.
 */

interface Result {
  id: string
  title: string
  previewUrl: string
  downloadUrl: string
  width: number
  height: number
}

const DEBOUNCE_MS = 350

export function GiphyPicker({
  enabled, onPick, onClose,
}: {
  enabled: boolean
  /** Called with a stored filename once the chosen GIF is in our own media. */
  onPick: (filename: string, alt: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (q: string, nextOffset: number, append: boolean) => {
    setLoading(true)
    setError(null)
    const res = await searchGiphyAction(q, nextOffset)
    setLoading(false)
    setConfigured(res.configured)
    if (res.error) { setError(res.error); return }
    const incoming = res.results ?? []
    setResults((prev) => (append ? [...prev, ...incoming] : incoming))
    setOffset(nextOffset + incoming.length)
  }, [])

  // Debounced search. Everything happens inside the timer, including the first load, so opening the
  // picker does not fire a request and then immediately fire a second one for an empty query.
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(query, 0, false) }, query ? DEBOUNCE_MS : 0)
    return () => window.clearTimeout(timer)
  }, [query, load])

  const choose = async (result: Result) => {
    setPicking(result.id)
    const res = await pickGiphyAction(result.downloadUrl, result.title)
    setPicking(null)
    if (res.error || !res.filename) { setError(res.error ?? 'That GIF could not be added.'); return }
    onPick(res.filename, res.alt ?? result.title)
    onClose()
  }

  /** Arrow keys move through the grid; Escape closes it. */
  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { onClose(); return }
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return

    const tiles = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-gif-tile]') ?? [])
    const index = tiles.findIndex((t) => t === document.activeElement)
    if (index < 0) { tiles[0]?.focus(); event.preventDefault(); return }

    // The grid is four across at its widest; up and down move by a row.
    const step = event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowLeft' ? -1
        : event.key === 'ArrowDown' ? 4 : -4
    const next = tiles[Math.min(tiles.length - 1, Math.max(0, index + step))]
    if (next) { next.focus(); event.preventDefault() }
  }

  if (!configured) {
    return (
      <div className="rounded-none border border-border bg-card/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">GIF search is not configured</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Set <code className="rounded bg-muted px-1 py-0.5">GIPHY_API_KEY</code> in the server
              environment to enable it. Pasting or dragging a GIF straight into the body works either way.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close GIF search"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-none border border-border bg-card/40 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="giphy-search" className="sr-only">Search GIFs</label>
          <input
            id="giphy-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
            placeholder="Search GIFs…"
            autoFocus
            className="w-full rounded-none border border-input bg-card py-1.5 pl-8 pr-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF search"
          className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded border border-destructive/40 bg-destructive/[0.06] px-2.5 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <div
        ref={gridRef}
        onKeyDown={onGridKeyDown}
        role="group"
        aria-label="GIF results"
        className="mt-2 max-h-64 overflow-y-auto"
      >
        {loading && results.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />Loading GIFs…
          </p>
        ) : results.length === 0 && !error ? (
          <p className="py-6 text-xs text-muted-foreground">
            {query ? `Nothing matched “${query}”.` : 'No GIFs to show.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                data-gif-tile
                disabled={picking != null}
                onClick={() => void choose(r)}
                className="group relative aspect-square overflow-hidden rounded border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
              >
                {/* GIPHY's own preview asset, shown only inside the picker. The chosen GIF is
                    downloaded and stored locally, so nothing published depends on their host. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- external preview thumbnail */}
                <img
                  src={r.previewUrl}
                  alt={r.title}
                  loading="lazy"
                  className="size-full object-cover transition-opacity group-hover:opacity-80"
                />
                {picking === r.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-background/70">
                    <Loader2 className="size-4 motion-safe:animate-spin text-brand" aria-hidden />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(query, offset, true)}
              className="rounded-none border border-border px-3 py-1 text-xs hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {/* Required attribution wherever GIPHY results appear. */}
      <p className="mt-2 text-[0.65rem] text-muted-foreground">
        Powered by{' '}
        <a
          href="https://giphy.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          GIPHY
        </a>
      </p>
    </div>
  )
}
