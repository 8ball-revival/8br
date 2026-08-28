/**
 * The local-database guard.
 *
 * These checks are the reason the guard is trustworthy, so they are deliberately adversarial: URLs
 * that merely look local, production names on loopback, local names on Neon, and the string tricks a
 * substring check would fall for.
 */

import {
  inspectConnection, assertLocalDatabase, isVercelRuntime,
  APPROVED_LOCAL_DATABASES, FORBIDDEN_DATABASES,
} from '@/lib/db-guard'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1 } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const U = (host: string, db: string, port = 55432) => `postgresql://user:secret@${host}:${port}/${db}`

// ─────────────────────────────────────────────────── what is allowed
console.log('\nallowed')
{
  for (const db of APPROVED_LOCAL_DATABASES) {
    check(`localhost/${db}`, inspectConnection(U('127.0.0.1', db)).allowed)
    check(`the "localhost" spelling also works for ${db}`, inspectConnection(U('localhost', db)).allowed)
  }
  check('a query string does not confuse it',
    inspectConnection(`${U('127.0.0.1', '8br_dev_fixtures')}?sslmode=disable`).allowed)
}

// ─────────────────────────────────────────────────── what is refused
console.log('\nrefused')
{
  const cases: [string, string][] = [
    [U('ep-spring-sun-awpmeuv7.c-12.us-east-1.aws.neon.tech', '8br_dev_fixtures'), 'an approved NAME on the production host'],
    [U('127.0.0.1', 'neondb'), 'a production NAME on localhost'],
    [U('127.0.0.1', 'eightballregistry_launch_20260818_1458'), 'the live launch database, even locally'],
    [U('db.internal.example.com', '8br_dev'), 'an approved name on some other host'],
    [U('ep-anything.aws.neon.tech', 'neondb'), 'production outright'],
    [U('127.0.0.1', 'postgres'), 'an unapproved local database'],
    [U('127.0.0.1', ''), 'no database in the path'],
  ]
  for (const [url, label] of cases) {
    const v = inspectConnection(url)
    check(`refuses ${label}`, !v.allowed, v.reason ?? 'was allowed')
  }

  check('refuses a missing URL', !inspectConnection(undefined).allowed)
  check('refuses an empty URL', !inspectConnection('').allowed)
  check('refuses an unparseable URL', !inspectConnection('not a url').allowed)
}

// ─────────────────────────────────────────────────── the tricks a substring check would fail
console.log('\nstructural parsing, not string matching')
{
  // The classic: a production host with "localhost" appearing in the query string.
  const spoof = 'postgresql://u:p@prod.aws.neon.tech:5432/8br_dev?host=localhost&x=127.0.0.1'
  const v = inspectConnection(spoof)
  check('a production host with localhost in the query is refused', !v.allowed, v.reason ?? 'ALLOWED')

  // A hostname that merely ends in something local-looking.
  check('"notlocalhost" is not localhost', !inspectConnection(U('notlocalhost', '8br_dev')).allowed)
  check('"localhost.evil.test" is not localhost', !inspectConnection(U('localhost.evil.test', '8br_dev')).allowed)

  // A database whose name merely contains an approved one.
  check('"8br_dev_production" is not "8br_dev"',
    !inspectConnection(U('127.0.0.1', '8br_dev_production')).allowed)
}

// ─────────────────────────────────────────────────── it never leaks the password
console.log('\nno credential leaks')
{
  const url = 'postgresql://admin:sup3r-s3cret-pw@ep-x.aws.neon.tech:5432/neondb'
  const v = inspectConnection(url)
  const blob = `${v.summary} ${v.reason ?? ''}`
  check('the summary omits the password', !blob.includes('sup3r-s3cret-pw'), blob)
  check('the summary omits the username', !blob.includes('admin'), blob)
  check('...but still identifies the target usefully', v.summary.includes('neondb'))

  let thrown = ''
  try { assertLocalDatabase('seed', { DATABASE_URL: url } as NodeJS.ProcessEnv) } catch (e) { thrown = String(e) }
  check('the thrown error omits the password', !thrown.includes('sup3r-s3cret-pw'))
  check('the thrown error explains what to do', /approved local database|local database/i.test(thrown))
}

// ─────────────────────────────────────────────────── assert behaviour
console.log('\nassertLocalDatabase')
{
  let ok = true
  try { assertLocalDatabase('test', { DATABASE_URL: U('127.0.0.1', '8br_dev_fixtures') } as NodeJS.ProcessEnv) } catch { ok = false }
  check('permits an approved local database', ok)

  let threw = false
  try { assertLocalDatabase('test', { DATABASE_URL: U('127.0.0.1', 'neondb') } as NodeJS.ProcessEnv) } catch { threw = true }
  check('throws on a production database name', threw)

  threw = false
  try { assertLocalDatabase('test', {} as NodeJS.ProcessEnv) } catch { threw = true }
  check('throws when no URL is set at all — fails closed', threw)
}

// ─────────────────────────────────────────────────── it must not fire in production
console.log('\nthe deployed application is unaffected')
{
  check('Vercel production is detected', isVercelRuntime({ VERCEL: '1' } as NodeJS.ProcessEnv))
  check('Vercel preview is detected', isVercelRuntime({ VERCEL_ENV: 'preview' } as NodeJS.ProcessEnv))
  check('a developer machine is not', !isVercelRuntime({} as NodeJS.ProcessEnv))

  // The deployed app is SUPPOSED to write to production; a guard firing there would break the site.
  let ok = true
  try {
    assertLocalDatabase('runtime', { VERCEL: '1', DATABASE_URL: U('ep-x.aws.neon.tech', 'neondb') } as NodeJS.ProcessEnv)
  } catch { ok = false }
  check('on Vercel it steps aside and permits production', ok)
}

// ─────────────────────────────────────────────────── no escape hatch
console.log('\nno bypass')
{
  const src = await import('node:fs').then((fs) => fs.readFileSync('src/lib/db-guard.ts', 'utf8'))
  // Assert on behaviour rather than on prose: the guard's own comments discuss bypasses, so a text
  // search matches its documentation. What matters is which environment variables can change the
  // outcome — only the connection string and the Vercel markers may.
  const envReads = [...src.matchAll(/env\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1])
  const allowed = new Set(['DATABASE_URL', 'VERCEL', 'VERCEL_ENV'])
  const unexpected = [...new Set(envReads)].filter((v) => !allowed.has(v))
  check('no environment variable can relax the rule', unexpected.length === 0, unexpected.join(', '))

  // And prove it: a hostile environment full of plausible override names changes nothing.
  const hostile = {
    DATABASE_URL: U('ep-x.aws.neon.tech', 'neondb'),
    FORCE: '1', SKIP_GUARD: '1', ALLOW_PRODUCTION: 'true', DB_GUARD_DISABLE: '1', NODE_ENV: 'production',
  } as unknown as NodeJS.ProcessEnv
  let blocked = false
  try { assertLocalDatabase('hostile', hostile) } catch { blocked = true }
  check('override-looking variables do not unlock production', blocked)
  check('production database names are listed explicitly', FORBIDDEN_DATABASES.length >= 2)
  check('the URL is parsed, not pattern-matched', src.includes('new URL('))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
