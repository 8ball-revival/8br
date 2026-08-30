import 'server-only'
import { getPayload } from 'payload'
import config from '@payload-config'

/**
 * Resolving a media id to something renderable.
 *
 * Goes through Payload's own Media collection rather than a second table, so an image chosen in the
 * builder is the same image the rest of the site uses, with the same storage adapter behind it. A
 * builder that grew its own upload path would be a second place for files to live and a second place
 * for them to be orphaned.
 *
 * A missing or deleted item resolves to `null` and the module renders a placeholder. Deleting a
 * picture from the library must not be able to take a page down.
 */

export interface ResolvedMedia {
  id: number
  url: string
  width: number | null
  height: number | null
  alt: string | null
}

export async function mediaUrl(id: number | null | undefined): Promise<ResolvedMedia | null> {
  if (!id || !Number.isInteger(id) || id <= 0) return null
  try {
    const payload = await getPayload({ config })
    const doc = await payload.findByID({ collection: 'media', id, depth: 0 })
    if (!doc?.url) return null
    return {
      id,
      url: doc.url,
      width: typeof doc.width === 'number' ? doc.width : null,
      height: typeof doc.height === 'number' ? doc.height : null,
      alt: typeof doc.alt === 'string' ? doc.alt : null,
    }
  } catch {
    // A media lookup failing is a missing picture, not a broken page.
    return null
  }
}

/** The library, for the inspector's picker. */
export async function listMedia(limit = 200): Promise<ResolvedMedia[]> {
  try {
    const payload = await getPayload({ config })
    const res = await payload.find({ collection: 'media', limit, depth: 0, sort: '-createdAt' })
    return res.docs
      .filter((d) => typeof d.url === 'string' && d.url)
      .map((d) => ({
        id: Number(d.id),
        url: d.url as string,
        width: typeof d.width === 'number' ? d.width : null,
        height: typeof d.height === 'number' ? d.height : null,
        alt: typeof d.alt === 'string' ? d.alt : null,
      }))
  } catch {
    return []
  }
}
