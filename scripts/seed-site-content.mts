// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

/**
 * Seed the admin-managed site content with the approved launch wording and images.
 *
 * Idempotent: media files are matched by filename and reused rather than re-uploaded, and the
 * globals are simply written to their approved state. Safe to re-run at any time — in particular
 * to RESTORE the approved wording after manual draft/publish testing.
 *
 * Images are read from the project's own `public/assets/branding` copies, so this never depends on
 * any path outside the repository.
 *
 * Usage:
 *   npx tsx --tsconfig scripts/tsconfig.verify.json scripts/seed-site-content.mts
 *
 * Target DB = whatever DATABASE_URL points at. Intended for the contained local cluster.
 */
import path from 'path'
import { fileURLToPath } from 'url'

// Next.js loads .env for the app and Prisma loads it for its own scripts, but a bare tsx process
// gets neither — and Payload needs PAYLOAD_SECRET + DATABASE_URL at init. Load it explicitly.
//
// ONLY `.env`. `.env.local` is deliberately NOT loaded: it carries BLOB_READ_WRITE_TOKEN, which
// switches Payload's media storage to a real Vercel Blob store. A local seed must write to the
// contained project directory, never to cloud storage.
try {
  process.loadEnvFile('.env')
} catch {
  /* absent file is fine */
}

const { getPayload } = await import('payload')
const config = (await import('../src/payload.config.ts')).default

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '..')

const { APPROVED_SITE_CONTENT: APPROVED } = await import('../src/lib/site-content/defaults.ts')

const LOGO = { file: APPROVED.logoFile, alt: APPROVED.logoUploadAlt }
const BANNER = { file: APPROVED.bannerFile, alt: APPROVED.bannerAlt }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureMedia(p: any, relPath: string, alt: string): Promise<number | string> {
  const filename = path.basename(relPath)
  const existing = await p.find({
    collection: 'media',
    where: { filename: { equals: filename } },
    limit: 1,
    depth: 0,
  })
  if (existing.docs.length > 0) {
    console.log(`  · media "${filename}" already present (id ${existing.docs[0].id}) — reusing`)
    return existing.docs[0].id
  }
  const created = await p.create({
    collection: 'media',
    data: { alt },
    filePath: path.join(repoRoot, relPath),
  })
  console.log(`  ✓ uploaded "${filename}" (id ${created.id})`)
  return created.id
}

/**
 * Drop every media doc and detach it from the globals. Needed when the storage backend changes
 * (e.g. rows written to Vercel Blob must be re-uploaded to the local disk store), because the
 * database rows survive while the bytes behind them do not.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resetMedia(p: any) {
  console.log('Resetting media (--reset-media):')
  await p.updateGlobal({ slug: 'site-branding', data: { logo: null } })
  await p.updateGlobal({ slug: 'homepage-hero', data: { bannerImage: null } })
  const docs = await p.find({ collection: 'media', limit: 500, depth: 0 })
  for (const d of docs.docs) {
    await p.delete({ collection: 'media', id: d.id })
    console.log(`  · deleted media ${d.id} (${d.filename})`)
  }
}

async function main() {
  const p = await getPayload({ config })

  if (process.argv.includes('--reset-media')) await resetMedia(p)

  console.log('Media:')
  const logoId = await ensureMedia(p, LOGO.file, LOGO.alt)
  const bannerId = await ensureMedia(p, BANNER.file, BANNER.alt)

  console.log('Globals:')
  await p.updateGlobal({
    slug: 'site-branding',
    data: {
      siteName: APPROVED.siteName,
      logo: logoId,
      // Decorative: the wordmark beside it already announces the site name.
      logoAlt: APPROVED.logoAlt,
      _status: 'published',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  })
  console.log('  ✓ site-branding published')

  await p.updateGlobal({
    slug: 'homepage-hero',
    data: {
      bannerImage: bannerId,
      bannerAlt: BANNER.alt,
      welcomeLine: APPROVED.welcomeLine,
      headlineLine1: APPROVED.headlineLine1,
      headlineLine2: APPROVED.headlineLine2,
      description: APPROVED.description,
      supportingSentence: APPROVED.supportingSentence,
      primaryButtonLabel: APPROVED.primaryButtonLabel,
      primaryButtonHref: APPROVED.primaryButtonHref,
      secondaryButtonLabel: APPROVED.secondaryButtonLabel,
      secondaryButtonHref: APPROVED.secondaryButtonHref,
      _status: 'published',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  })
  console.log('  ✓ homepage-hero published')

  console.log('\nDone. Published site content matches the approved wording.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
