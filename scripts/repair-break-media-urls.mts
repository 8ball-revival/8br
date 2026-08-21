/**
 * Repair Break post media pointing at the upload endpoint instead of the serving one.
 *
 * `migrate-articles-to-break` built cover URLs as `/api/news/media?file=<key>`. That route only
 * accepts POST — it is where the editor sends a pasted image — so a GET for it answers 405 and the
 * cover rendered as a broken image. The file itself was always fine; only the URL was wrong.
 *
 * The correct shape is `/api/media/file/<key>`, which is what `lib/media/service` writes for every
 * upload made through the app.
 *
 * Each row is checked against the running dev server before it is rewritten, so a row whose file is
 * genuinely missing is reported rather than quietly given a different broken URL. `bytes` is filled
 * in from the response for the same reason it was wrong: the import never knew the size.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/repair-break-media-urls.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const ORIGIN = process.env.REPAIR_ORIGIN ?? 'http://localhost:3000'
const BAD = '/api/news/media?file='

const rows = await prisma.$queryRaw<{ id: number; storageKey: string; url: string; bytes: number }[]>`
  SELECT id, "storageKey", url, bytes FROM "public"."break_post_media"
   WHERE url LIKE ${BAD + '%'} ORDER BY id`

console.log(`rows with the upload-endpoint URL: ${rows.length}`)
if (rows.length === 0) {
  console.log('nothing to repair')
  await prisma.$disconnect()
  process.exit(0)
}

let fixed = 0
let skipped = 0
for (const r of rows) {
  const target = `/api/media/file/${encodeURIComponent(r.storageKey)}`
  let ok = false
  let size = 0
  try {
    const res = await fetch(ORIGIN + target)
    ok = res.ok
    size = Number(res.headers.get('content-length') ?? 0)
  } catch (e) {
    console.log(`  ! could not reach ${ORIGIN} — is the dev server running? ${e instanceof Error ? e.message : e}`)
    break
  }
  if (!ok) {
    skipped++
    console.log(`  ✗ media ${r.id}: ${target} does not serve — left alone, the file is missing`)
    continue
  }
  await prisma.$executeRaw`
    UPDATE "public"."break_post_media"
       SET url = ${target}, bytes = ${size > 0 ? size : r.bytes}
     WHERE id = ${r.id}`
  fixed++
  console.log(`  ✓ media ${r.id}: → ${target} (${size.toLocaleString()} bytes)`)
}

console.log(`\nrepaired ${fixed}, left alone ${skipped}`)
await prisma.$disconnect()
