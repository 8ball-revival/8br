import path from 'path'
import { fileURLToPath } from 'url'
import type { CollectionConfig } from 'payload'

import { staffOnly } from './access'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Uploaded media (logos, banners, editorial images).
 *
 * STORAGE. Two modes, chosen by whether BLOB_READ_WRITE_TOKEN is set (see payload.config.ts):
 *   - production / Vercel → Vercel Blob, because the serverless filesystem is ephemeral and
 *     anything written to disk is lost on the next deploy.
 *   - local development    → this `staticDir`, inside the project at `<repo>/media`, which is
 *     git-ignored. Pinned explicitly rather than left to Payload's cwd-relative default so the
 *     location does not shift depending on where a script is run from.
 *
 * Files are always SERVED through Payload's own route (`/api/media/file/<filename>`) regardless of
 * which backend holds the bytes, so nothing downstream needs to know the difference.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    // Public: media is referenced by public pages.
    read: () => true,
    // Uploading/replacing/removing site imagery is a staff action.
    create: staffOnly,
    update: staffOnly,
    delete: staffOnly,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: {
    staticDir: path.resolve(dirname, '../../media'),
  },
}
