/**
 * Emit a CommonJS marker into the Next.js server output so the (CommonJS) page
 * bundles are resolved as CommonJS even though the project root is
 * `"type": "module"` (required by the Payload CLI).
 *
 * Why: Vercel runs each App Router server function through a CommonJS launcher
 * (`___next_launcher.cjs`) that `require()`s `.next/server/app/.../page.js`. Those
 * bundles are CommonJS code, but with a root `"type": "module"` Node resolves
 * every `.js` as ESM and `require()` throws `ERR_REQUIRE_ESM`. Next writes
 * `.next/package.json` = `{"type":"commonjs"}`, but Vercel's Lambda file layout
 * doesn't apply it (it is not the nearest package.json to the page bundle).
 * Writing `.next/server/package.json` places the CommonJS marker directly beside
 * the server bundles, so Node treats them as CommonJS on Vercel.
 * See Next.js discussion #91663.
 *
 * Idempotent; safe locally (the bundles are CommonJS regardless).
 */
import { writeFileSync, existsSync } from 'node:fs'

const SERVER_DIR = '.next/server'

if (!existsSync(SERVER_DIR)) {
  console.error('✗ .next/server not found — run `next build` before this step.')
  process.exit(1)
}

writeFileSync(`${SERVER_DIR}/package.json`, JSON.stringify({ type: 'commonjs' }) + '\n')
console.log('✓ Wrote .next/server/package.json {"type":"commonjs"} (Vercel CJS launcher compatibility)')
