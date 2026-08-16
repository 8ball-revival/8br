/**
 * Run any `payload` CLI command locally.
 *
 * The Payload CLI `require()`s the config, which uses top-level await and therefore must load as
 * an ES module — but package.json deliberately has NO `"type"` field so Next emits CommonJS
 * bundles that Vercel's launcher can `require()` (see scripts/deploy-migrate.mjs for the full
 * reasoning). Without the flip below, every payload CLI command dies with
 * ERR_REQUIRE_ASYNC_MODULE.
 *
 * This applies the same transient flip deploy-migrate.mjs uses for `payload migrate`, but for an
 * arbitrary command, and always restores package.json verbatim — including on failure or Ctrl-C.
 *
 * Usage:
 *   node scripts/payload-cli.mjs migrate:status
 *   node scripts/payload-cli.mjs migrate:create --name add_site_content_globals
 *   node scripts/payload-cli.mjs migrate
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/payload-cli.mjs <payload-command> [...args]')
  process.exit(1)
}

const pkgUrl = new URL('../package.json', import.meta.url)
const original = readFileSync(pkgUrl, 'utf8')

function restore() {
  writeFileSync(pkgUrl, original)
}

// Restore package.json even if the process is interrupted, so a Ctrl-C can never leave the repo
// with `"type": "module"` committed by accident.
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
  execSync(`npx payload ${args.join(' ')}`, { stdio: 'inherit', env: process.env })
} catch (err) {
  code = typeof err?.status === 'number' ? err.status : 1
} finally {
  restore()
}
process.exit(code)
