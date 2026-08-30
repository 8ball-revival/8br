'use server'

/**
 * The media library, for the picker.
 *
 * Separate from `actions.ts` because that module is imported by the editor bundle and this one
 * reaches into Payload — keeping them apart stops Payload's server-only surface being pulled into
 * the same import graph as the editor's client components.
 *
 * Capability-checked like every other action. The library is not secret, but an unauthenticated
 * endpoint enumerating every uploaded file is an inventory of the site's assets that nobody asked
 * to publish.
 */

import { requireCapability } from '@/lib/competition/staff-auth'
import { listMedia } from './media'

export async function listMediaAction(): Promise<
  { ok: true; data: { id: number; url: string; alt: string | null }[] } | { ok: false; error: string }
> {
  try {
    await requireCapability('manage_site_builder')
    const items = await listMedia()
    return { ok: true, data: items.map((m) => ({ id: m.id, url: m.url, alt: m.alt })) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not read the media library.' }
  }
}
