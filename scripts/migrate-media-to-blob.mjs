#!/usr/bin/env node
/**
 * Move locally stored media into Vercel Blob, once, before the first production deploy.
 *
 * ── Why no database rewrite happens here ────────────────────────────────────────────────────────
 * This application stores FILENAMES, never URLs. `Article.coverMediaId`, every `media:` reference in
 * an article body, and every page image are filenames, and they are all served through Payload's own
 * route at `/api/media/file/<filename>`, whichever backend actually holds the bytes.
 *
 * So there is nothing to remap. Uploading a file to Blob under the SAME filename is the entire
 * migration, and every existing reference keeps resolving with no edit to any row. A utility that
 * rewrote stored values into blob.vercel-storage.com URLs would be actively harmful: it would pin
 * content to one backend and break the moment the store moved.
 *
 * The manifest below therefore records what was transferred for auditing, not a mapping the
 * application needs.
 *
 *   npm run media:migrate -- --dry-run     report what would happen, touch nothing
 *   npm run media:migrate                  perform the transfer
 *
 * Safe to run repeatedly: a file already in Blob with a matching size is skipped. Local files are
 * never deleted, by this or anything it calls.
 */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const DRY_RUN = process.argv.includes('--dry-run')
const MEDIA_DIR = path.resolve(process.cwd(), 'media')
const OUT_DIR = path.resolve(process.cwd(), 'exports')

const counts = { discovered: 0, uploaded: 0, skipped: 0, missing: 0, failed: 0 }
const manifest = []
const problems = []

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

console.log(`\nMedia migration → Vercel Blob${DRY_RUN ? '  (DRY RUN — nothing will be written)' : ''}\n`)

// The token gates the real work but never the inspection, so a dry run is useful before anyone has
// created the store. Its VALUE is never printed, compared in a message, or written to the manifest.
const hasToken = typeof process.env.BLOB_READ_WRITE_TOKEN === 'string'
  && process.env.BLOB_READ_WRITE_TOKEN.trim().length > 0

if (!hasToken && !DRY_RUN) {
  console.log('  BLOB_READ_WRITE_TOKEN is not set. Create the Blob store and set it, or use --dry-run.\n')
  process.exitCode = 1
} else {
  const prisma = new PrismaClient()
  let blob = null
  // Imported whenever a token exists, including for a dry run: consulting the store is a read, and
  // without it a dry run would claim it was going to upload files that are already present.
  if (hasToken) blob = await import('@vercel/blob')

  try {
    // Payload's media collection is the authority on which files the application knows about. A file
    // sitting in the directory with no row is not referenced by anything and is not migrated.
    const rows = await prisma.$queryRawUnsafe(
      `SELECT filename, filesize, mime_type FROM payload.media WHERE filename IS NOT NULL ORDER BY filename`,
    )
    counts.discovered = rows.length
    console.log(`  ${rows.length} media record${rows.length === 1 ? '' : 's'} in the database\n`)

    // What is already in Blob, so a repeat run skips rather than re-uploads.
    let existing = new Map()
    if (blob) {
      const listed = await blob.list({ token: process.env.BLOB_READ_WRITE_TOKEN })
      existing = new Map(listed.blobs.map((b) => [b.pathname, b]))
    }

    for (const row of rows) {
      const name = row.filename
      const local = path.join(MEDIA_DIR, name)

      let bytes
      try {
        bytes = await readFile(local)
      } catch {
        // A database row whose file is gone is a real problem: that image is already broken on the
        // site, and silently skipping it would hide that.
        counts.missing += 1
        problems.push(`MISSING LOCALLY: ${name} — the database references it but <repo>/media has no such file`)
        continue
      }

      const digest = sha256(bytes)
      const already = existing.get(name)

      if (already && Number(already.size) === bytes.length) {
        counts.skipped += 1
        manifest.push({ filename: name, action: 'skipped', bytes: bytes.length, sha256: digest, reason: 'already in Blob with a matching size' })
        console.log(`  skip     ${name}  (already present, ${bytes.length} bytes)`)
        continue
      }

      if (DRY_RUN) {
        counts.uploaded += 1
        manifest.push({ filename: name, action: 'would-upload', bytes: bytes.length, sha256: digest, contentType: row.mime_type ?? null })
        console.log(`  upload   ${name}  (${bytes.length} bytes, ${row.mime_type ?? 'unknown type'})`)
        continue
      }

      try {
        // The pathname IS the filename — that is what makes this idempotent and what keeps every
        // existing reference working. addRandomSuffix would break both.
        const put = await blob.put(name, bytes, {
          access: 'public',
          addRandomSuffix: false,
          contentType: row.mime_type ?? undefined,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        })

        // Verify what landed rather than trusting the call returned.
        const check = await fetch(put.url, { method: 'HEAD' })
        const remoteSize = Number(check.headers.get('content-length') ?? '0')
        if (remoteSize !== bytes.length) {
          counts.failed += 1
          problems.push(`SIZE MISMATCH: ${name} — sent ${bytes.length} bytes, stored ${remoteSize}`)
          continue
        }

        counts.uploaded += 1
        manifest.push({ filename: name, action: 'uploaded', bytes: bytes.length, sha256: digest, verifiedSize: remoteSize })
        console.log(`  uploaded ${name}  (${bytes.length} bytes, verified)`)
      } catch (err) {
        counts.failed += 1
        problems.push(`FAILED: ${name} — ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Files on disk with no database row. Reported, never uploaded and never deleted.
    let orphans = []
    try {
      const onDisk = await readdir(MEDIA_DIR)
      const known = new Set(rows.map((r) => r.filename))
      for (const f of onDisk) {
        const s = await stat(path.join(MEDIA_DIR, f))
        if (s.isFile() && !known.has(f)) orphans.push(f)
      }
    } catch { /* no media directory at all is fine */ }

    console.log('\n  ─────────────────────────────────────────')
    console.log(`  discovered ${counts.discovered}`)
    console.log(`  ${DRY_RUN ? 'would upload' : 'uploaded'}   ${counts.uploaded}`)
    console.log(`  skipped    ${counts.skipped}`)
    console.log(`  missing    ${counts.missing}`)
    console.log(`  failed     ${counts.failed}`)
    if (orphans.length) console.log(`  on disk with no database row: ${orphans.length} (left alone)`)

    if (problems.length) {
      console.log('\n  Problems')
      for (const p of problems) console.log(`    ✗ ${p}`)
    }

    // The manifest is an audit record. No token, no URL bearing a token, no secret of any kind.
    await mkdir(OUT_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const out = path.join(OUT_DIR, `media-migration-${DRY_RUN ? 'dryrun-' : ''}${stamp}.json`)
    await writeFile(out, JSON.stringify({
      ranAt: new Date().toISOString(),
      dryRun: DRY_RUN,
      note: 'Filenames are stable and the application resolves media by filename through '
        + '/api/media/file/<filename>, so no database value needs rewriting after this transfer.',
      counts,
      orphansOnDisk: orphans,
      problems,
      files: manifest,
    }, null, 2))
    console.log(`\n  manifest: ${path.relative(process.cwd(), out)}`)

    console.log(counts.failed > 0 || counts.missing > 0
      ? '\n  FINISHED WITH PROBLEMS — see above.\n'
      : `\n  ${DRY_RUN ? 'Dry run complete. Local files untouched.' : 'Migration complete. Local files preserved.'}\n`)

    if (counts.failed > 0 || counts.missing > 0) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}
