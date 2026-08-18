/**
 * Clipboard image handling for the article editor.
 *
 * Pure functions over strings and clipboard data, deliberately free of React and of the DOM beyond the
 * clipboard types themselves — which is what lets the placeholder bookkeeping be tested directly
 * rather than through a rendered textarea.
 *
 * The problem this solves: an upload takes a second or two, and the author keeps typing. So the
 * insertion point cannot be remembered as a character offset — by the time the upload finishes the
 * text around it has moved. Instead a unique placeholder token is written into the body immediately,
 * and when the upload resolves the token is found by SEARCH and swapped for the real reference. The
 * author can type, delete, or paste again in the meantime and every image still lands where it was put.
 */

/** What the editor accepts from a clipboard. Mirrors the server's allow-list. */
export const PASTEABLE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export interface PendingUpload {
  /** Token written into the body, unique per upload. */
  token: string
  /** What the author sees while it uploads. */
  label: string
  name: string
  size: number
  type: string
}

/**
 * A placeholder that survives being typed around.
 *
 * Written as a fenced-looking line so it is visible and obviously temporary, and carries an id so two
 * simultaneous uploads cannot be confused for one another. `⏳` is deliberate: an author who abandons
 * the tab mid-upload is left with something that plainly reads as unfinished rather than with broken
 * image syntax.
 */
export function placeholderToken(id: string): string {
  return `[⏳ uploading image ${id}…]`
}

let counter = 0
/** A short id for one upload. Monotonic within a session, so tokens never collide. */
export function nextUploadId(): string {
  counter += 1
  return `${counter}-${Math.random().toString(36).slice(2, 7)}`
}

/** Images found on a clipboard, in the order the clipboard offered them. */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []

  // `items` is the richer view and is what carries a screenshot or an Apple #images GIF; `files` is
  // the fallback for clipboards that only expose the simpler shape.
  if (data.items && data.items.length > 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file && (PASTEABLE_TYPES as readonly string[]).includes(file.type)) out.push(file)
    }
  }
  if (out.length === 0 && data.files && data.files.length > 0) {
    for (const file of Array.from(data.files)) {
      if ((PASTEABLE_TYPES as readonly string[]).includes(file.type)) out.push(file)
    }
  }
  return out
}

/**
 * Does this clipboard carry an image we should intercept?
 *
 * False when the clipboard also has meaningful text and no image file — copying a paragraph from a
 * web page often includes an `text/html` flavour, and hijacking that paste would be maddening.
 */
export function clipboardHasImage(data: DataTransfer | null): boolean {
  return imagesFromClipboard(data).length > 0
}

// --------------------------------------------------------------------------- text surgery

export interface InsertResult {
  text: string
  /** Where the caret should sit afterwards — just past what was inserted. */
  caret: number
}

/**
 * Insert text at a selection, replacing whatever it covered.
 *
 * Blank lines are added around a block insertion when the surrounding text needs them, so a pasted
 * image becomes its own paragraph rather than being glued to the end of a sentence — the body parser
 * treats an image as a block, and a reference sitting mid-line would not become one.
 */
export function insertAtSelection(
  text: string,
  start: number,
  end: number,
  insertion: string,
  { asBlock = false } = {},
): InsertResult {
  const before = text.slice(0, start)
  const after = text.slice(end)

  let payload = insertion
  if (asBlock) {
    const needsLeading = before.length > 0 && !before.endsWith('\n\n')
    const needsTrailing = after.length > 0 && !after.startsWith('\n\n')
    payload = `${needsLeading ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}${insertion}${
      needsTrailing ? (after.startsWith('\n') ? '\n' : '\n\n') : ''}`
  }

  return { text: before + payload + after, caret: before.length + payload.length }
}

/**
 * Swap a placeholder for its finished media reference.
 *
 * Returns the text unchanged when the token is absent, which is the case that matters: the author may
 * have deleted the placeholder while the upload was in flight, and an upload finishing must never
 * re-insert an image they removed.
 */
export function replaceToken(text: string, token: string, replacement: string): string {
  if (!text.includes(token)) return text
  return text.split(token).join(replacement)
}

/** The body reference for a stored image. The `media:` form the parser already understands. */
export function mediaReference(filename: string, alt: string): string {
  // Brackets and parens would break the reference; a caption is not worth a malformed body.
  const safeAlt = alt.replace(/[[\]()\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `![${safeAlt}](media:${filename})`
}

/**
 * What to leave behind when an upload fails.
 *
 * Not broken image syntax, and not silence. A visible, plainly temporary note the author can delete —
 * and because the token is gone, a retry inserts a fresh placeholder rather than fighting this one.
 */
export function failureNote(id: string, reason: string): string {
  const clean = reason.replace(/[\n\r]+/g, ' ').slice(0, 160)
  return `[⚠ image ${id} failed to upload — ${clean}]`
}

/** Every `media:` filename referenced by a body, in the order they appear. */
export function inlineMediaFilenames(body: string): string[] {
  const out: string[] = []
  const pattern = /!\[[^\]]*\]\(media:([^)\s]+)\)/g
  for (const match of body.matchAll(pattern)) {
    const name = match[1]
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}
