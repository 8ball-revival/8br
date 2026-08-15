import { postgresAdapter } from '@payloadcms/db-postgres'
import { resendAdapter } from '@payloadcms/email-resend'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { News } from './collections/News'
import { Rules } from './collections/Rules'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Public site origin (also used for canonical/OG URLs). Optional in dev.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL

export default buildConfig({
  // In production, set NEXT_PUBLIC_SITE_URL so admin cookies / CORS / CSRF use the
  // real origin. Omitted in dev → Payload infers from the request.
  ...(siteUrl ? { serverURL: siteUrl, cors: [siteUrl], csrf: [siteUrl] } : {}),
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, News, Rules],
  editor: lexicalEditor(),
  // Transactional email (password-reset links). Enabled once RESEND_API_KEY is set;
  // without it Payload falls back to its console-logging adapter, so dev still works and
  // a first deploy without the key still builds. RESEND_FROM_EMAIL must be a verified
  // Resend sender/domain in production.
  ...(process.env.RESEND_API_KEY
    ? {
        email: resendAdapter({
          defaultFromAddress: process.env.RESEND_FROM_EMAIL || 'noreply@cueverse.net',
          defaultFromName: 'World Cue Championships',
          apiKey: process.env.RESEND_API_KEY,
        }),
      }
    : {}),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    // Payload owns a SEPARATE Postgres schema so it never collides with the
    // Prisma-owned competition/records tables in the default "public" schema.
    schemaName: 'payload',
    // Production runs the committed migrations (src/migrations, applied by `payload migrate` in
    // scripts/deploy-migrate.mjs at build time). `push` stays on only in dev for fast iteration.
    // The migration set was regenerated from the current config (20260815_191908_init) after the
    // original stale/broken initial migration was removed.
    push: process.env.NODE_ENV !== 'production',
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
  }),
  sharp,
  plugins: [
    // Media storage. On Vercel the filesystem is read-only/ephemeral, so uploads
    // go to Vercel Blob. Enabled automatically once BLOB_READ_WRITE_TOKEN exists
    // (set for you when you create a Vercel Blob store); a no-op otherwise, so a
    // first deploy without Blob still builds and runs.
    vercelBlobStorage({
      enabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      collections: { media: true },
      token: process.env.BLOB_READ_WRITE_TOKEN || '',
    }),
  ],
})
