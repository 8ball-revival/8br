#!/usr/bin/env node
/**
 * Deployment preflight: is this environment configured to run 8 Ball Registry in production?
 *
 * Reports on NAMES and SHAPES, never values. Nothing here prints a secret, a fragment of one, or a
 * length precise enough to narrow one down — a checker that leaks what it is checking is worse than
 * no checker, because it gets pasted into chat logs and issue trackers.
 *
 * The distinction that matters is required versus optional. A missing GIPHY key costs the GIF picker
 * and nothing else, so it is a note. A missing Blob token means uploads land on a filesystem that
 * Vercel discards between deployments, and every image a member pastes disappears — so that is a
 * failure, and the deploy should not proceed.
 *
 *   node scripts/preflight-env.mjs              check the current environment as production
 *   node scripts/preflight-env.mjs --env local  check it as local development instead
 */

const args = new Set(process.argv.slice(2))
const target = args.has('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'production'
const isProduction = target !== 'local'

const problems = []
const warnings = []
const notes = []

const present = (name) => typeof process.env[name] === 'string' && process.env[name].trim().length > 0

/** A coarse bucket, so a report can say "looks unset" without describing the value. */
const shape = (name) => {
  const v = process.env[name] ?? ''
  if (!v.trim()) return 'missing'
  if (v.length < 16) return 'set (short)'
  return 'set'
}

/** Values that mean somebody copied an example file and did not finish. */
const PLACEHOLDER = /^(changeme|placeholder|your[-_]?|xxx+|todo|example|test|secret|password|<.*>)/i

function requireVar(name, why) {
  if (!present(name)) {
    problems.push(`${name} is not set — ${why}`)
    return false
  }
  if (PLACEHOLDER.test(process.env[name].trim())) {
    problems.push(`${name} still looks like a placeholder value — ${why}`)
    return false
  }
  return true
}

console.log(`\n8 Ball Registry — environment preflight (${isProduction ? 'production' : 'local development'})\n`)

// ── database ────────────────────────────────────────────────────────────────────────────────────
if (requireVar('DATABASE_URL', 'the application cannot reach its database')) {
  const url = process.env.DATABASE_URL
  if (isProduction && /localhost|127\.0\.0\.1|::1/.test(url)) {
    problems.push('DATABASE_URL points at localhost, which cannot be reached from the deployed site')
  }
}
// Prisma migrations need a direct (unpooled) connection; a pooler rejects the advisory locks they take.
if (isProduction) requireVar('DIRECT_URL', 'Prisma migrations need an unpooled connection')

// ── authentication ──────────────────────────────────────────────────────────────────────────────
if (requireVar('PAYLOAD_SECRET', 'sessions and Payload crypto depend on it')) {
  if (isProduction && process.env.PAYLOAD_SECRET.trim().length < 32) {
    problems.push('PAYLOAD_SECRET is too short for production — use at least 32 random characters')
  }
}

// ── public URL ──────────────────────────────────────────────────────────────────────────────────
const EXPECTED_HOST = '8br.gg'
// src/lib/site.ts falls back to http://localhost:3000, which is right for development and wrong for
// production — so this is required only where the fallback would be wrong.
const siteUrlOk = isProduction
  ? requireVar('NEXT_PUBLIC_SITE_URL', 'canonical URLs, the sitemap, CORS and secure cookies derive from it')
  : present('NEXT_PUBLIC_SITE_URL')
if (!isProduction && !siteUrlOk) {
  notes.push('NEXT_PUBLIC_SITE_URL not set — development falls back to http://localhost:3000')
}
if (siteUrlOk) {
  const raw = process.env.NEXT_PUBLIC_SITE_URL.trim()
  let host = null
  try { host = new URL(raw).host } catch { problems.push('NEXT_PUBLIC_SITE_URL is not a valid URL') }

  if (host) {
    if (isProduction) {
      if (/^localhost|^127\.|^0\.0\.0\.0/.test(host)) {
        problems.push('NEXT_PUBLIC_SITE_URL points at localhost — canonical URLs and cookies would be wrong in production')
      } else if (host !== EXPECTED_HOST && host !== `www.${EXPECTED_HOST}`) {
        // Not fatal: a staging deploy legitimately runs on another host. But it must be deliberate.
        warnings.push(`NEXT_PUBLIC_SITE_URL host is "${host}", not "${EXPECTED_HOST}" — correct only if this is staging`)
      }
      if (!raw.startsWith('https://')) {
        problems.push('NEXT_PUBLIC_SITE_URL must use https in production, or secure cookies will not be set')
      }
    }
  }
}

// ── scheduled work ──────────────────────────────────────────────────────────────────────────────
if (isProduction) {
  requireVar('CRON_SECRET', 'the daily CueVerse refresh endpoint would be open to anyone')
}

// Two different jobs, two different secrets: if one leaks, the other must not also be compromised.
if (present('CRON_SECRET') && present('PAYLOAD_SECRET')
  && process.env.CRON_SECRET === process.env.PAYLOAD_SECRET) {
  problems.push('CRON_SECRET and PAYLOAD_SECRET are identical — give them separate values')
}

// ── media storage ───────────────────────────────────────────────────────────────────────────────
if (isProduction) {
  if (!requireVar('BLOB_READ_WRITE_TOKEN', 'uploads would be written to a filesystem Vercel discards between deploys')) {
    problems.push('  → without Blob, every pasted image and uploaded file is lost on the next deployment')
  }
} else if (!present('BLOB_READ_WRITE_TOKEN')) {
  notes.push('BLOB_READ_WRITE_TOKEN not set — local uploads go to <repo>/media, which is correct for development')
}

// ── optional ────────────────────────────────────────────────────────────────────────────────────
if (present('GIPHY_API_KEY')) {
  notes.push('GIPHY_API_KEY is set — the GIF picker is enabled')
} else {
  // Explicitly NOT a failure. The picker says so in the UI and everything else still works.
  notes.push('GIPHY_API_KEY not set — the GIF picker will show as unconfigured; pasting and dragging GIFs still works')
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────
const table = [
  ['DATABASE_URL', true], ['DIRECT_URL', isProduction], ['PAYLOAD_SECRET', true],
  ['NEXT_PUBLIC_SITE_URL', isProduction], ['CRON_SECRET', isProduction], ['BLOB_READ_WRITE_TOKEN', isProduction],
  ['GIPHY_API_KEY', false],
]
const width = Math.max(...table.map(([n]) => n.length))
for (const [name, required] of table) {
  const status = shape(name)
  const mark = status === 'missing' ? (required ? 'MISSING' : 'not set') : status
  console.log(`  ${name.padEnd(width)}  ${required ? 'required' : 'optional'}  ${mark}`)
}

if (notes.length) {
  console.log('\nNotes')
  for (const n of notes) console.log(`  · ${n}`)
}
if (warnings.length) {
  console.log('\nWarnings')
  for (const w of warnings) console.log(`  ! ${w}`)
}
if (problems.length) {
  console.log('\nProblems')
  for (const p of problems) console.log(`  ✗ ${p}`)
  console.log(`\nPREFLIGHT FAILED — ${problems.length} problem${problems.length === 1 ? '' : 's'} to fix before deploying.\n`)
  process.exitCode = 1
} else {
  console.log(`\nPREFLIGHT PASSED — ${isProduction ? 'this environment is configured for production.' : 'local development configuration is fine.'}\n`)
}
