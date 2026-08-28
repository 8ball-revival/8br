'use client'

/**
 * The custom background image — held in the visitor's own browser, and nowhere else.
 *
 * ── What this deliberately is not ────────────────────────────────────────────────────────────────
 * There is no upload. No fetch, no FormData, no Vercel Blob, no account, no database row. The file
 * a reader chooses is decoded in their tab, re-encoded in their tab, and written to IndexedDB in
 * their tab. Nothing about it is transmitted, so nothing about it can be seen by us, by another
 * reader, or by a server log — which is the only honest way to offer "put your own picture behind
 * the site" without also collecting people's pictures. `Stored in this browser only` is a
 * description of the implementation, not a promise about how we treat what we received.
 *
 * ── Why the image is decoded and re-encoded rather than stored as chosen ─────────────────────────
 * A JPEG off a phone carries EXIF: GPS coordinates, a camera serial, a timestamp. Storing the file
 * verbatim keeps all of it. Drawing the decoded pixels to a canvas and encoding the canvas produces
 * an image with the same appearance and no metadata at all — the exposure data goes, and so does the
 * location the photograph was taken. That matters even for a local store: browser storage is
 * readable by anything else that can run script on this origin, and it survives on a shared machine.
 *
 * ── Why IndexedDB rather than localStorage ───────────────────────────────────────────────────────
 * localStorage holds strings, so an image has to become base64 — a third larger, synchronous to read
 * and write, and against a quota measured in single-digit megabytes that the ordinary settings also
 * live in. A blown quota there would take the display settings down with the picture. IndexedDB
 * stores the Blob as binary, asynchronously, in its own space.
 */

const DB_NAME = '8br-display'
const DB_VERSION = 1
const STORE = 'backgrounds'
const RECORD_ID = 'custom'

/** What a chosen file may be. SVG is absent on purpose — see `rejectionFor`. */
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',')

/** 12 MB of source file. Enough for a full-frame photograph, far short of anything pathological. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024
/** Beyond this the file is refused rather than resized: nothing legitimate is 10,000px wide. */
export const MAX_SOURCE_EDGE = 10_000
/** What is actually kept. A background is stretched behind a page; more pixels buy nothing. */
export const MAX_STORED_EDGE = 2560

export interface StoredBackground {
  blob: Blob
  width: number
  height: number
  bytes: number
  /** The original file name, kept only so the panel can show what is set. */
  name: string
}

/**
 * Why a file cannot be used, or null if it can.
 *
 * ── SVG ─────────────────────────────────────────────────────────────────────────────────────────
 * An SVG is a document, not a picture: it can carry <script>, <foreignObject> and external
 * references, and rendering one from untrusted input in the page's own origin is a way to run code.
 * It is refused by type here AND absent from the file input's accept list, because a file picker's
 * accept attribute is a convenience rather than a control — a drag-and-drop or a renamed file
 * reaches this function regardless.
 */
export function rejectionFor(file: File): string | null {
  if (file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name)) {
    return 'SVG files are not accepted. Choose a PNG, JPEG or WebP image.'
  }
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return 'That file type is not supported. Choose a PNG, JPEG or WebP image.'
  }
  if (file.size > MAX_FILE_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`
  }
  return null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  }).finally(() => db.close()))
}

/**
 * Decode, bound, strip and encode — the whole of what "uploading" means here.
 *
 * `createImageBitmap` decodes off the main thread, so a large photograph does not freeze the panel
 * while it is read. The bitmap is closed explicitly afterwards: it holds decoded pixel memory, and
 * on a phone a handful of leaked full-resolution bitmaps is the difference between a working tab and
 * a reloaded one.
 */
export async function prepareBackground(file: File): Promise<StoredBackground> {
  const rejection = rejectionFor(file)
  if (rejection) throw new Error(rejection)

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That image could not be read. It may be damaged or in an unsupported format.')
  }

  try {
    if (bitmap.width > MAX_SOURCE_EDGE || bitmap.height > MAX_SOURCE_EDGE) {
      throw new Error(`That image is ${bitmap.width}×${bitmap.height}. The limit is ${MAX_SOURCE_EDGE}px on a side.`)
    }

    const scale = Math.min(1, MAX_STORED_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser could not process the image.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)

    /*
     * WebP at 0.85. A background sits behind content at reduced opacity and is usually blurred or
     * darkened as well, so the last few percent of fidelity is invisible and the storage is not.
     */
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
    if (!blob) throw new Error('This browser could not process the image.')

    return { blob, width, height, bytes: blob.size, name: file.name }
  } finally {
    bitmap.close()
  }
}

/**
 * The event that says "the stored image changed".
 *
 * IndexedDB has no change notification, and the image has exactly one publisher — `DisplayRuntime`,
 * which turns it into an object URL for the whole document. Without a signal, that publisher would
 * have to poll, or the panel would have to publish a second URL of its own, and two owners of one
 * Blob URL is how a revoked URL ends up still referenced by a stylesheet.
 */
export const BACKGROUND_CHANGED = '8br-display-background'

const announce = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BACKGROUND_CHANGED))
}

export async function saveBackground(record: StoredBackground): Promise<void> {
  await tx('readwrite', (store) => store.put(record, RECORD_ID))
  announce()
}

export async function loadBackground(): Promise<StoredBackground | null> {
  try {
    const record = await tx<StoredBackground | undefined>('readonly', (store) => store.get(RECORD_ID))
    return record?.blob instanceof Blob ? record : null
  } catch {
    /* No IndexedDB (private mode, a locked-down browser): there is simply no custom background. */
    return null
  }
}

/** One action, and the image is gone from the machine. Called by Remove, and by Reset Defaults. */
export async function clearBackground(): Promise<void> {
  try { await tx('readwrite', (store) => store.delete(RECORD_ID)) } catch { /* nothing stored */ }
  announce()
}
