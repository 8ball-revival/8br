import 'server-only'

import { storePastedMedia } from './service'
import { MediaError } from './validate'

/**
 * GIPHY search.
 *
 * The key is read from the environment and never leaves the server: the picker calls a Server Action,
 * the action calls GIPHY, and the browser only ever sees the results. A key shipped to the client
 * would be a key given away.
 *
 * Chosen GIFs are DOWNLOADED and stored in our own media system rather than hotlinked. That keeps an
 * article self-contained — it renders the same in a year whether or not that GIF is still on GIPHY —
 * and means the same validation and size ceilings apply to a picked GIF as to a pasted one.
 */

const GIPHY_SEARCH = 'https://api.giphy.com/v1/gifs/search'
const GIPHY_TRENDING = 'https://api.giphy.com/v1/gifs/trending'

/** Per GIPHY's terms, their mark must be shown wherever their results are. */
export const GIPHY_ATTRIBUTION = 'Powered by GIPHY'
export const GIPHY_URL = 'https://giphy.com/'

export const PAGE_SIZE = 24
/** GIPHY is a nice-to-have; it must never hold up the editor. */
const TIMEOUT_MS = 6000

export interface GiphyResult {
  id: string
  title: string
  /** Small looping preview for the grid. */
  previewUrl: string
  /** The full asset that gets downloaded on selection. */
  downloadUrl: string
  width: number
  height: number
}

export function giphyConfigured(): boolean {
  return Boolean(process.env.GIPHY_API_KEY)
}

/** Text is passed to GIPHY as a query parameter, so it is bounded and stripped of control characters. */
function cleanQuery(input: string): string {
  return String(input ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 80)
}

interface GiphyImage { url?: string; width?: string; height?: string }
interface GiphyItem {
  id?: string
  title?: string
  images?: { fixed_width?: GiphyImage; fixed_height_small?: GiphyImage; original?: GiphyImage; downsized?: GiphyImage }
}

/**
 * Turn GIPHY's payload into our own shape, discarding anything malformed.
 *
 * A row without a usable id or URL is dropped rather than rendered as a broken tile — the same
 * "refuse it rather than half-accept it" rule the CueVerse import follows.
 */
function parseResults(body: unknown): GiphyResult[] {
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) return []

  const out: GiphyResult[] = []
  for (const raw of data) {
    const item = raw as GiphyItem
    const id = typeof item.id === 'string' ? item.id.replace(/[^A-Za-z0-9_-]/g, '') : ''
    if (!id) continue

    const preview = item.images?.fixed_width ?? item.images?.fixed_height_small
    const full = item.images?.downsized ?? item.images?.original

    const previewUrl = preview?.url
    const downloadUrl = full?.url
    // Only GIPHY's own media hosts. This is what stops a crafted payload from pointing the server's
    // downloader at an arbitrary address.
    if (!isGiphyMediaUrl(previewUrl) || !isGiphyMediaUrl(downloadUrl)) continue

    out.push({
      id,
      title: (item.title ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 120) || 'GIF',
      previewUrl: previewUrl!,
      downloadUrl: downloadUrl!,
      width: Number(preview?.width ?? 0) || 200,
      height: Number(preview?.height ?? 0) || 200,
    })
  }
  return out
}

/**
 * Is this one of GIPHY's media hosts?
 *
 * An allow-list on the HOSTNAME, parsed with `URL` rather than matched as a substring — a check like
 * `url.includes('giphy.com')` would happily accept `https://evil.test/?x=giphy.com`. This is the SSRF
 * boundary: the server only ever downloads from these hosts.
 */
export function isGiphyMediaUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return parsed.hostname === 'media.giphy.com'
      || parsed.hostname.endsWith('.giphy.com')
  } catch {
    return false
  }
}

/** A GIPHY page or short link an author might paste, reduced to its GIF id. */
export function giphyIdFromLink(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (!url.hostname.endsWith('giphy.com') && url.hostname !== 'gph.is') return null
    // .../gifs/some-slug-<id>  or  .../media/<id>/giphy.gif  or  /gifs/<id>
    const segments = url.pathname.split('/').filter(Boolean)
    for (const segment of [...segments].reverse()) {
      const tail = segment.split('-').pop() ?? segment
      if (/^[A-Za-z0-9]{6,}$/.test(tail)) return tail
    }
    return null
  } catch {
    return null
  }
}

async function giphyFetch(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new MediaError(`GIPHY returned ${res.status}.`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Search, or trending when the query is empty. Offset drives the picker's "load more". */
export async function searchGiphy(query: string, offset = 0): Promise<GiphyResult[]> {
  const key = process.env.GIPHY_API_KEY
  if (!key) throw new MediaError('GIPHY is not configured on this server.')

  const q = cleanQuery(query)
  const params = new URLSearchParams({
    api_key: key,
    limit: String(PAGE_SIZE),
    offset: String(Math.max(0, Math.min(offset, 500))),
    rating: 'pg-13',
    bundle: 'messaging_non_clips',
  })
  if (q) params.set('q', q)

  return parseResults(await giphyFetch(`${q ? GIPHY_SEARCH : GIPHY_TRENDING}?${params}`))
}

/** One GIF by id, for a pasted GIPHY link. */
export async function giphyById(id: string): Promise<GiphyResult | null> {
  const key = process.env.GIPHY_API_KEY
  if (!key) throw new MediaError('GIPHY is not configured on this server.')
  const clean = id.replace(/[^A-Za-z0-9_-]/g, '')
  if (!clean) return null

  const body = await giphyFetch(`https://api.giphy.com/v1/gifs/${clean}?api_key=${encodeURIComponent(key)}`)
  // The single-GIF endpoint returns an object where search returns an array; reuse the same parser.
  const results = parseResults({ data: [(body as { data?: unknown }).data] })
  return results[0] ?? null
}

/**
 * Download a chosen GIF and store it as our own media.
 *
 * The URL is re-checked against the host allow-list here as well as at parse time. That is not
 * redundant: this function is reachable from a Server Action, so its argument arrives from the client
 * and must be treated as a request rather than as something we produced.
 */
export async function importGiphy({
  downloadUrl, title, uploaderPlayerId,
}: { downloadUrl: string; title: string; uploaderPlayerId: string }) {
  if (!isGiphyMediaUrl(downloadUrl)) throw new MediaError('That is not a GIPHY media address.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  let bytes: Buffer
  try {
    const res = await fetch(downloadUrl, { signal: controller.signal, redirect: 'error', cache: 'no-store' })
    if (!res.ok) throw new MediaError(`GIPHY returned ${res.status} for that GIF.`)
    bytes = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    if (err instanceof MediaError) throw err
    throw new MediaError('That GIF could not be downloaded.')
  } finally {
    clearTimeout(timer)
  }

  // Straight into the ordinary pipeline: same signature check, same ceilings, same rate limit, same
  // animation-preserving path a pasted GIF takes.
  return storePastedMedia({
    bytes,
    filename: `giphy-${title.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40) || 'gif'}.gif`,
    alt: title,
    uploaderPlayerId,
  })
}
