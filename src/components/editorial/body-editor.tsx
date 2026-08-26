'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Sparkles } from 'lucide-react'

import {
  clipboardHasImage, imagesFromClipboard, insertAtSelection, replaceToken,
  placeholderToken, nextUploadId, mediaReference, failureNote,
} from '@/lib/editorial/paste-media'
import { GiphyPicker } from './giphy-picker'

/**
 * The article body field, with clipboard image support.
 *
 * Pasting an image writes a visible placeholder at the caret immediately, uploads in the background,
 * then finds that placeholder by SEARCH and swaps it for the finished `media:` reference. Searching
 * rather than remembering a character offset is the whole trick: an upload takes a second or two and
 * the author keeps typing, so an offset captured at paste time points somewhere else by the time the
 * upload lands. With a token, every image arrives where it was put no matter what was typed around it.
 *
 * If the author deletes the placeholder mid-upload, the swap finds nothing and does nothing — an
 * upload finishing must never re-insert an image somebody removed.
 *
 * The Markdown source stays the source of truth, so every existing article and every existing
 * `media:` reference keeps working untouched.
 */

export interface BodyEditorProps {
  value: string
  onChange: (next: string) => void
  /** Called whenever media is added, so the caller can offer it as the featured image. */
  onMediaAdded?: (filename: string) => void
  id?: string
  rows?: number
  placeholder?: string
  giphyEnabled?: boolean
}

interface Upload {
  id: string
  token: string
  name: string
  state: 'uploading' | 'failed'
  error?: string
  retry?: () => void
}

export function BodyEditor({
  value, onChange, onMediaAdded, id = 'body', rows = 22,
  placeholder = 'Write the article…',
  giphyEnabled = false,
}: BodyEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // The newest body text, so an upload that resolves late edits the CURRENT value rather than the one
  // captured when it started. A ref because the upload closure must not hold a stale snapshot, and
  // written in an effect rather than during render — a ref assigned mid-render is read before React
  // has committed the change it belongs to.
  const latest = useRef(value)
  useEffect(() => { latest.current = value }, [value])

  const apply = useCallback((next: string) => {
    latest.current = next
    onChange(next)
  }, [onChange])

  /** Upload one file, holding its place with a token until it resolves. */
  const uploadFile = useCallback(async (file: File, token: string, uploadId: string) => {
    const attempt = async (): Promise<void> => {
      setUploads((u) => u.map((x) => (x.id === uploadId ? { ...x, state: 'uploading', error: undefined } : x)))
      try {
        const body = new FormData()
        body.append('file', file)
        body.append('alt', file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 120))

        const res = await fetch('/api/news/media', { method: 'POST', body, credentials: 'include' })
        const data = (await res.json().catch(() => ({}))) as { filename?: string; error?: string }
        if (!res.ok || !data.filename) throw new Error(data.error ?? `Upload failed (${res.status})`)

        apply(replaceToken(latest.current, token, mediaReference(data.filename, file.name)))
        setUploads((u) => u.filter((x) => x.id !== uploadId))
        onMediaAdded?.(data.filename)
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Upload failed'
        // The placeholder becomes a visible failure note, so the body never holds broken syntax and
        // the author can see exactly which image did not make it.
        apply(replaceToken(latest.current, token, failureNote(uploadId, reason)))
        setUploads((u) => u.map((x) => (x.id === uploadId
          ? { ...x, state: 'failed', error: reason, retry: () => {
            // Retry re-inserts a fresh placeholder at the failure note, then tries again.
            const note = failureNote(uploadId, reason)
            apply(replaceToken(latest.current, note, token))
            void attempt()
          } }
          : x)))
      }
    }
    await attempt()
  }, [apply, onMediaAdded])

  /** Take a set of files, place their tokens at the caret, and start the uploads. */
  const acceptFiles = useCallback((files: File[]) => {
    if (files.length === 0) return
    const el = textareaRef.current
    const start = el?.selectionStart ?? latest.current.length
    const end = el?.selectionEnd ?? start

    let text = latest.current
    let caret = start
    const started: { file: File; token: string; id: string }[] = []

    for (const [index, file] of files.entries()) {
      const uploadId = nextUploadId()
      const token = placeholderToken(uploadId)
      // The first insertion replaces the selection; the rest append after the previous token.
      const result = insertAtSelection(text, index === 0 ? start : caret, index === 0 ? end : caret, token, { asBlock: true })
      text = result.text
      caret = result.caret
      started.push({ file, token, id: uploadId })
    }

    apply(text)
    setUploads((u) => [
      ...u,
      ...started.map(({ file, token, id: uploadId }) => ({
        id: uploadId, token, name: file.name || 'pasted image', state: 'uploading' as const,
      })),
    ])

    // Restore the caret past everything inserted, so typing continues where the author expects.
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (node) { node.selectionStart = caret; node.selectionEnd = caret; node.focus() }
    })

    for (const { file, token, id: uploadId } of started) void uploadFile(file, token, uploadId)
  }, [apply, uploadFile])

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Only intercept when there is genuinely an image. Copying text from a page often carries an HTML
    // flavour too, and hijacking that paste would be maddening.
    if (!clipboardHasImage(event.clipboardData)) return
    event.preventDefault()
    acceptFiles(imagesFromClipboard(event.clipboardData))
  }

  const onDrop = (event: React.DragEvent<HTMLTextAreaElement>) => {
    setDragging(false)
    if (!clipboardHasImage(event.dataTransfer)) return
    event.preventDefault()
    acceptFiles(imagesFromClipboard(event.dataTransfer))
  }

  /** Insert an already-hosted image (a GIPHY pick) without an upload step. */
  const insertHosted = (filename: string, alt: string) => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? latest.current.length
    const end = el?.selectionEnd ?? start
    const result = insertAtSelection(latest.current, start, end, mediaReference(filename, alt), { asBlock: true })
    apply(result.text)
    onMediaAdded?.(filename)
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (node) { node.selectionStart = result.caret; node.selectionEnd = result.caret; node.focus() }
    })
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => document.getElementById(`${id}-file`)?.click()}
          className="inline-flex items-center gap-1.5 rounded-none border border-border px-2.5 py-1.5 text-xs hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <ImagePlus className="size-3.5" aria-hidden />Image
        </button>
        <input
          id={`${id}-file`}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            acceptFiles(files)
          }}
        />

        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          aria-expanded={pickerOpen}
          className="inline-flex items-center gap-1.5 rounded-none border border-border px-2.5 py-1.5 text-xs hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <Sparkles className="size-3.5" aria-hidden />GIF
        </button>

        <span className="text-xs text-muted-foreground">
          Paste or drag an image straight in.
        </span>
      </div>

      {pickerOpen && (
        <div className="mb-2">
          <GiphyPicker
            enabled={giphyEnabled}
            onPick={insertHosted}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      )}

      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(e) => apply(e.target.value)}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => { if (clipboardHasImage(e.dataTransfer)) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={() => setDragging(false)}
        rows={rows}
        placeholder={placeholder}
        className={[
          'w-full resize-y rounded-md border bg-card px-3 py-2 font-mono text-sm leading-relaxed outline-none',
          'focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25',
          dragging ? 'border-brand ring-2 ring-brand/25' : 'border-input',
        ].join(' ')}
      />

      {uploads.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-live="polite">
          {uploads.map((u) => (
            <li
              key={u.id}
              className={`flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                u.state === 'failed'
                  ? 'border-destructive/40 bg-destructive/[0.06] text-destructive'
                  : 'border-border bg-card/40 text-muted-foreground'
              }`}
            >
              {u.state === 'uploading' ? (
                <>
                  <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />
                  <span className="truncate">Uploading {u.name}…</span>
                </>
              ) : (
                <>
                  <span className="truncate">{u.name} — {u.error}</span>
                  <button
                    type="button"
                    onClick={u.retry}
                    className="rounded border border-current px-1.5 py-0.5 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Remove the note from the body as well as the row, so nothing is left behind.
                      apply(replaceToken(latest.current, failureNote(u.id, u.error ?? ''), ''))
                      setUploads((list) => list.filter((x) => x.id !== u.id))
                    }}
                    className="rounded border border-current px-1.5 py-0.5 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
