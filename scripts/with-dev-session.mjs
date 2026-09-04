/**
 * Run a verification suite as a signed-in reader.
 *
 * The site is private, so a suite that drives a browser or fetches a page is an anonymous visitor
 * and photographs the private-access page instead of whatever it meant to check. This mints one
 * real session, puts it in `PRIVACY_COOKIE` for the child process, runs the command, and revokes the
 * session afterwards — including when the command fails or is interrupted.
 *
 *   node scripts/with-dev-session.mjs node scripts/verify-glass-finish.mjs
 *
 * Suites that deliberately test the LOGGED-OUT experience must not be run through this.
 */
import { spawn } from 'node:child_process'

import { mintDevSession, revokeDevSessions } from './lib/dev-session.mjs'

const argv = process.argv.slice(2).filter((a) => a !== '--')
if (!argv.length) {
  console.error('usage: node scripts/with-dev-session.mjs <command> [args...]')
  process.exit(2)
}

let code = 1
try {
  const session = await mintDevSession()
  console.log(`[with-dev-session] signed in as ${session.email}`)
  code = await new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: 'inherit',
      env: { ...process.env, PRIVACY_COOKIE: session.cookie },
      shell: process.platform === 'win32',
    })
    child.on('close', (c) => resolve(c ?? 1))
    child.on('error', (err) => { console.error(String(err)); resolve(1) })
  })
} finally {
  const removed = await revokeDevSessions()
  console.log(`[with-dev-session] revoked ${removed} session(s)`)
}
process.exit(code)
