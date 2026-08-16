/**
 * Run an arbitrary command with package.json temporarily switched to `"type": "module"`.
 *
 * Anything that loads `payload` outside Next.js (seed scripts, one-off maintenance tasks) hits the
 * same problem the Payload CLI does: package.json deliberately has NO `"type"` field so Next emits
 * CommonJS bundles for Vercel's launcher (see scripts/deploy-migrate.mjs), but Payload's node entry
 * and the config's top-level await require an ES module graph. Without the flip you get
 * ERR_REQUIRE_ASYNC_MODULE, or `Cannot destructure property 'loadEnvConfig'`.
 *
 * package.json is always restored verbatim, including on failure or Ctrl-C.
 *
 * Usage:
 *   node scripts/run-with-esm.mjs npx tsx scripts/seed-site-content.mts
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/run-with-esm.mjs <command> [...args]')
  process.exit(1)
}

const pkgUrl = new URL('../package.json', import.meta.url)
const original = readFileSync(pkgUrl, 'utf8')
const restore = () => writeFileSync(pkgUrl, original)

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restore()
    process.exit(1)
  })
}

const pkg = JSON.parse(original)
pkg.type = 'module'
writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + '\n')

let code = 0
try {
  const res = spawnSync(args[0], args.slice(1), { stdio: 'inherit', shell: true, env: process.env })
  code = res.status ?? 1
} finally {
  restore()
}
process.exit(code)
