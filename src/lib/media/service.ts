import 'server-only'
import { getPayload } from 'payload'
import config from '@payload-config'

import { prisma } from '@/lib/prisma'
import { cleanText } from '@/lib/editorial/richtext'
import { validateImage, safeFilename, MediaError, type ValidatedMedia } from './validate'

/**
 * Storing media pasted into an article.
 *
 * Files go through Payload's media collection, which is what already handles storage for the rest of
 * the site — Vercel Blob in production, a local directory in development, and always served from
 * `/api/media/file/<filename>`. So a pasted image lands in exactly the same place as a competition
 * banner, and nothing downstream needs to know it arrived by clipboard.
 *
 * Payload's own media rules are staff-only. That is right for the admin UI and wrong here: any author
 * may illustrate their own draft. So authorisation happens in THIS layer, on the editorial actor, and
 * the write to Payload uses `overrideAccess` because the decision has already been made — by us,
 * deliberately, one function above.
 */

/** Uploads allowed per author, per window. Generous for writing; bounded against a script. */
export const RATE_LIMIT = {
  perMinute: Number(process.env.MEDIA_RATE_PER_MINUTE ?? 12),
  perDay: Number(process.env.MEDIA_RATE_PER_DAY ?? 200),
}

export interface StoredMedia {
  /** The Payload filename, which is what an article body references. */
  filename: string
  /** Public URL, always through Payload's own file route. */
  url: string
  width: number | null
  height: number | null
  animated: boolean
  mimeType: string
  bytes: number
}

/**
 * How many uploads this author has made recently.
 *
 * Counted in the database rather than a per-process map: a counter that resets on restart is not a
 * limit, and this application runs more than one instance.
 */
async function assertWithinRateLimit(playerId: string): Promise<void> {
  const now = Date.now()
  const [lastMinute, lastDay] = await Promise.all([
    prisma.mediaUpload.count({
      where: { uploaderPlayerId: playerId, createdAt: { gte: new Date(now - 60_000) } },
    }),
    prisma.mediaUpload.count({
      where: { uploaderPlayerId: playerId, createdAt: { gte: new Date(now - 86_400_000) } },
    }),
  ])

  if (lastMinute >= RATE_LIMIT.perMinute) {
    throw new MediaError('You are uploading very quickly. Wait a moment and try again.')
  }
  if (lastDay >= RATE_LIMIT.perDay) {
    throw new MediaError('You have reached the daily upload limit. Try again tomorrow.')
  }
}

/**
 * Validate, process and store one pasted image.
 *
 * `alt` is cleaned rather than trusted: it is author text that ends up in an attribute, and while the
 * renderer escapes it, storing control characters or a thousand-character string serves nobody.
 */
export async function storePastedMedia({
  bytes,
  filename,
  alt,
  uploaderPlayerId,
}: {
  bytes: Buffer
  filename?: string | null
  alt?: string | null
  uploaderPlayerId: string
}): Promise<StoredMedia> {
  await assertWithinRateLimit(uploaderPlayerId)

  const media: ValidatedMedia = await validateImage(bytes)
  const storedName = safeFilename(filename, media.mimeType)

  const altText = cleanText(alt ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    // Payload requires alt; a pasted screenshot rarely has one, and a truthful generic beats a blank.
    || 'Image pasted into an article'

  const payload = await getPayload({ config: await config })

  let created: { filename?: string | null }
  try {
    created = await payload.create({
      collection: 'media',
      data: { alt: altText },
      file: {
        data: media.buffer,
        mimetype: media.mimeType,
        name: storedName,
        size: media.buffer.length,
      },
      // The authorisation decision was made above, on the editorial actor. Payload's own media rules
      // are staff-only, which is correct for its admin UI and not the rule that applies here.
      overrideAccess: true,
    })
  } catch (err) {
    console.error('[media] payload create failed', err)
    throw new MediaError('That image could not be stored. Try again.')
  }

  const finalName = created.filename ?? storedName

  // Provenance. Written after the file exists, so a failed store leaves no row claiming otherwise.
  await prisma.mediaUpload.create({
    data: {
      filename: finalName,
      uploaderPlayerId,
      mimeType: media.mimeType,
      bytes: media.buffer.length,
      width: media.width,
      height: media.height,
    },
  })

  return {
    filename: finalName,
    url: `/api/media/file/${finalName}`,
    width: media.width,
    height: media.height,
    animated: media.animated,
    mimeType: media.mimeType,
    bytes: media.buffer.length,
  }
}

// --------------------------------------------------------------------------- orphan safety

/**
 * Is this file still referenced by any article or page?
 *
 * Checked against live bodies, pending edits, covers and standalone pages. An orphan sweep must ask
 * this and believe the answer: deleting a file that a draft still points at would break an article
 * nobody had finished writing.
 */
export async function isMediaReferenced(filename: string): Promise<boolean> {
  const needle = `media:${filename}`

  const [cover, inBody, inPending, inPage] = await Promise.all([
    prisma.article.count({ where: { coverMediaId: filename } }),
    // The body is a JSON node tree; its serialised form contains the reference either way.
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "public"."article"
       WHERE "body"::text LIKE ${'%' + filename + '%'}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "public"."article"
       WHERE "pendingBody" IS NOT NULL AND "pendingBody"::text LIKE ${'%' + filename + '%'}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "public"."editorial_page"
       WHERE "body"::text LIKE ${'%' + filename + '%'}`,
  ])

  void needle
  return cover > 0
    || Number(inBody[0]?.n ?? 0) > 0
    || Number(inPending[0]?.n ?? 0) > 0
    || Number(inPage[0]?.n ?? 0) > 0
}

/**
 * Files uploaded through the editor that nothing references any more.
 *
 * Returns candidates; it does not delete. A grace period keeps a file that was pasted minutes ago and
 * has not been saved yet — an author who pastes an image and then goes to make tea should not come
 * back to a broken draft.
 */
export async function findOrphanedMedia({ graceHours = 48 } = {}): Promise<string[]> {
  const uploads = await prisma.mediaUpload.findMany({
    where: { createdAt: { lt: new Date(Date.now() - graceHours * 3_600_000) } },
    select: { filename: true },
    orderBy: { createdAt: 'asc' },
    take: 500,
  })

  const orphans: string[] = []
  for (const u of uploads) {
    if (!(await isMediaReferenced(u.filename))) orphans.push(u.filename)
  }
  return orphans
}
