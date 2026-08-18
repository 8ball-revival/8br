'use server'

import { currentEditorialActor } from '@/lib/editorial/permissions'
import { MediaError } from './validate'
import {
  searchGiphy, importGiphy, giphyConfigured, giphyById, giphyIdFromLink,
  type GiphyResult,
} from './giphy'

/**
 * GIPHY, from the editor.
 *
 * Server Actions rather than a route handler so the API key stays on the server: the browser asks for
 * results and gets results, and never sees the credential that fetched them.
 *
 * Every action authorises on the editorial actor — the same rule that decides who may write an
 * article. Searching GIPHY makes an outbound request on this server's behalf, so it is not something
 * an anonymous visitor gets to trigger.
 */

export interface GiphySearchResult {
  ok?: boolean
  /** Absent when GIPHY is not configured; the picker explains rather than failing. */
  configured: boolean
  results?: GiphyResult[]
  error?: string
}

export async function searchGiphyAction(query: string, offset = 0): Promise<GiphySearchResult> {
  const actor = await currentEditorialActor()
  if (!actor) return { configured: false, error: 'Sign in with an active account to search GIFs.' }
  if (!giphyConfigured()) return { configured: false }

  try {
    return { ok: true, configured: true, results: await searchGiphy(query, offset) }
  } catch (err) {
    // A GIPHY failure must never look like an editor failure — the author keeps writing either way.
    const message = err instanceof MediaError ? err.message : 'GIFs could not be loaded right now.'
    console.warn('[giphy] search failed:', message)
    return { configured: true, error: message }
  }
}

export interface GiphyPickResult {
  ok?: boolean
  filename?: string
  alt?: string
  error?: string
}

/** Store a chosen GIF as our own media and hand back its reference. */
export async function pickGiphyAction(downloadUrl: string, title: string): Promise<GiphyPickResult> {
  const actor = await currentEditorialActor()
  if (!actor) return { error: 'Sign in with an active account to add a GIF.' }

  try {
    const stored = await importGiphy({
      downloadUrl,
      title: title || 'GIF',
      uploaderPlayerId: actor.playerId,
    })
    return { ok: true, filename: stored.filename, alt: title || 'GIF' }
  } catch (err) {
    const message = err instanceof MediaError ? err.message : 'That GIF could not be added.'
    return { error: message }
  }
}

/**
 * Resolve a pasted GIPHY link into a stored GIF.
 *
 * Returns `{}` for anything that is not a GIPHY link, which the caller reads as "leave this paste
 * alone" — pasting an ordinary URL into an article must still just insert the URL.
 */
export async function resolveGiphyLinkAction(url: string): Promise<GiphyPickResult> {
  const actor = await currentEditorialActor()
  if (!actor) return {}

  const id = giphyIdFromLink(url)
  if (!id) return {}
  if (!giphyConfigured()) return {}

  try {
    const gif = await giphyById(id)
    if (!gif) return {}
    const stored = await importGiphy({
      downloadUrl: gif.downloadUrl,
      title: gif.title,
      uploaderPlayerId: actor.playerId,
    })
    return { ok: true, filename: stored.filename, alt: gif.title }
  } catch {
    // A link we could not resolve is not an error the author needs to see: the plain URL stands.
    return {}
  }
}

/** Whether the picker should offer itself at all. Read on the server, passed to the editor. */
export async function giphyAvailableAction(): Promise<boolean> {
  return giphyConfigured()
}
