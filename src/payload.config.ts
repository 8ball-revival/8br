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
import { SiteBranding } from './globals/SiteBranding'
import { HomepageHero } from './globals/HomepageHero'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Public site origin (also used for canonical/OG URLs). Optional in dev.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL

// Every origin the app is legitimately served from MUST be allowed for Payload cookie auth
// (CORS + CSRF). Otherwise authenticated POSTs (Next.js Server Actions) fail the CSRF origin
// check, Payload silently drops the session cookie, and the request resolves as anonymous —
// surfacing as "Forbidden: staff access required" even for a valid Owner. On Vercel the app is
// reachable at its *.vercel.app URLs in addition to the custom domain, so trust both:
// VERCEL_PROJECT_PRODUCTION_URL is the stable production alias (e.g. cueverse-8br.vercel.app);
// VERCEL_URL is the per-deployment host (covers preview deployments).
const withProto = (h?: string) => (h ? (h.startsWith('http') ? h : `https://${h}`) : undefined)
const allowedOrigins = Array.from(
  new Set(
    [
      siteUrl,
      withProto(process.env.VERCEL_PROJECT_PRODUCTION_URL),
      withProto(process.env.VERCEL_URL),
    ].filter(Boolean) as string[],
  ),
)

export default buildConfig({
  // serverURL is the canonical site origin when set (else the Vercel production URL). cors/csrf
  // allow EVERY origin the app is served from so authenticated Server Actions work on the
  // temporary *.vercel.app URL, preview deployments, AND the custom domain after DNS cutover.
  ...(allowedOrigins.length
    ? { serverURL: siteUrl || allowedOrigins[0], cors: allowedOrigins, csrf: allowedOrigins }
    : {}),
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Users, Media, News, Rules],
  // Admin-managed site content. Singletons with drafts enabled: the public site reads only the
  // published version, so Save Draft never changes what visitors see.
  globals: [SiteBranding, HomepageHero],
  editor: lexicalEditor(),
  // Transactional email (password-reset links). Enabled once RESEND_API_KEY is set;
  // without it Payload falls back to its console-logging adapter, so dev still works and
  // a first deploy without the key still builds. RESEND_FROM_EMAIL must be a verified
  // Resend sender/domain in production.
  ...(process.env.RESEND_API_KEY
    ? {
        email: resendAdapter({
          defaultFromAddress: process.env.RESEND_FROM_EMAIL || 'noreply@cueverse.net',
          defaultFromName: '8 Ball Registry',
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
