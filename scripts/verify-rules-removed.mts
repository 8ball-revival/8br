/**
 * The competition Rules feature is gone — source, route, collection, navigation and schema — while
 * the legal pages it sat beside are untouched.
 *
 * Written as a removal test: it fails if any part of Rules comes back, and equally if Terms,
 * Privacy or Contact are lost along with it.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-rules-removed.mts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '../src/lib/prisma.ts'
import { APPROVED_LOCAL_DATABASES } from '../src/lib/db-guard.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}

/** Every .ts/.tsx under src, so "no references remain" means the whole tree, not a sampled few. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) sourceFiles(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

console.log('--- The files are gone ---')
{
  for (const p of [
    'src/app/(frontend)/rules',
    'src/app/(frontend)/rules/page.tsx',
    'src/collections/Rules.ts',
    'src/components/rules',
    'src/lib/rules',
    'src/lib/rules/handbook.ts',
  ]) check(`${p} no longer exists`, !existsSync(p))
}

console.log('')
console.log('--- Nothing in the source tree still reaches for it ---')
{
  const files = sourceFiles('src')
  const offenders: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    // Functional references only: a route, an import of a deleted module, or the handbook data.
    const linksToRoute = /['"`]\/rules(['"`#?])/.test(src)
    const importsDeleted = /from ['"][^'"]*(collections\/Rules|components\/rules|lib\/rules)/.test(src)
    const usesHandbook = /\bHANDBOOK\b|\bHandbookBody\b|\bHandbookSection\b/.test(src)
    if (linksToRoute || importsDeleted || usesHandbook) offenders.push(f)
  }
  check('no source file links to /rules or imports a deleted Rules module',
    offenders.length === 0, offenders.join(', '))

  const nav = readFileSync('src/lib/nav.ts', 'utf8')
  check('Rules is gone from the navigation', !/Rules/.test(nav) && !/\/rules/.test(nav))
  const config = readFileSync('src/payload.config.ts', 'utf8')
  check('the Payload collection is unregistered', !/Rules/.test(config))
  const sitemap = readFileSync('src/app/sitemap.ts', 'utf8')
  check('the sitemap no longer advertises it', !/\/rules/.test(sitemap))
  const types = readFileSync('src/payload-types.ts', 'utf8')
  check('the generated types carry no Rule collection',
    !/interface Rule\b/.test(types) && !/relationTo: 'rules'/.test(types))
}

console.log('')
console.log('--- Nothing routes to it ---')
{
  // A route exists in Next only if its directory does; there must also be no redirect standing in
  // for it, which would leave /rules resolving to something.
  check('there is no /rules route directory', !existsSync('src/app/(frontend)/rules'))
  const cfg = existsSync('next.config.ts') ? readFileSync('next.config.ts', 'utf8')
    : existsSync('next.config.mjs') ? readFileSync('next.config.mjs', 'utf8') : ''
  check('no redirect or rewrite quietly keeps /rules alive', !/\/rules/.test(cfg))
}

console.log('')
console.log('--- The legal pages beside it are untouched ---')
{
  for (const [label, p] of [
    ['Terms of Service', 'src/app/(frontend)/terms/page.tsx'],
    ['Privacy Policy', 'src/app/(frontend)/privacy/page.tsx'],
    ['Contact', 'src/app/(frontend)/contact/page.tsx'],
  ] as const) check(`${label} still exists`, existsSync(p))

  // The footer renders FOOTER_LINKS from nav.ts rather than hardcoding them, so that is where the
  // legal links have to survive.
  const nav2 = readFileSync('src/lib/nav.ts', 'utf8')
  check('the footer links still offer Terms, Privacy and Contact',
    /'\/terms'/.test(nav2) && /'\/privacy'/.test(nav2) && /'\/contact'/.test(nav2))
  const footer = readFileSync('src/components/site-footer.tsx', 'utf8')
  check('neither the footer nor its link list offers Rules',
    !/["'`]\/rules/.test(footer) && !/["'`]\/rules/.test(nav2))
}

console.log('')
console.log('--- The database no longer holds the feature ---')
try {
  const [conn] = await prisma.$queryRaw<{ db: string; port: string }[]>`
    SELECT current_database() AS db, current_setting('port') AS port`
  // Any approved local database on the contained cluster is fine. Development runs on fixtures and
  // the suite may be pointed at a disposable clone of them; pinning one name would fail for no
  // reason. What matters is that this is the contained local cluster and not a remote one. The list
  // is imported rather than restated, so it cannot drift from the guard that enforces it.
  const APPROVED = [...APPROVED_LOCAL_DATABASES]
  check('running against an approved local database on the contained cluster',
    APPROVED.includes(conn.db) && conn.port === '55432', `${conn.db}:${conn.port}`)

  const tables = await prisma.$queryRaw<{ s: string; t: string }[]>`
    SELECT table_schema AS s, table_name AS t FROM information_schema.tables
    WHERE table_name ILIKE '%rule%' AND table_schema IN ('public','payload')`
  check('no Rules table remains', tables.length === 0, JSON.stringify(tables))

  const cols = await prisma.$queryRaw<{ t: string; c: string }[]>`
    SELECT table_name AS t, column_name AS c FROM information_schema.columns
    WHERE column_name ILIKE '%rule%' AND table_schema IN ('public','payload')`
  check('no Rules column remains, including the shared rels table and Competition.rulesRef',
    cols.length === 0, JSON.stringify(cols))

  // Scoped to our own schemas: pg_catalog carries its own rule-related indexes that are nothing to
  // do with this feature.
  const fks = await prisma.$queryRaw<{ n: string }[]>`
    SELECT c.conname AS n FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname IN ('public','payload') AND c.conname ILIKE '%rule%'`
  check('no Rules constraint remains', fks.length === 0, JSON.stringify(fks))

  const idx = await prisma.$queryRaw<{ i: string }[]>`
    SELECT indexname AS i FROM pg_indexes WHERE schemaname IN ('public','payload') AND indexname ILIKE '%rule%'`
  check('no Rules index remains', idx.length === 0, JSON.stringify(idx))

  // The shared table Rules borrowed a column from must still be there for every other collection.
  const shared = await prisma.$queryRaw<{ t: string }[]>`
    SELECT table_name AS t FROM information_schema.tables
    WHERE table_schema='payload' AND table_name='payload_locked_documents_rels'`
  check('the shared locked-documents table itself is preserved', shared.length === 1)

  // Competitions, Seasons and accounts are none of Rules' business.
  check('Seasons are untouched', (await prisma.season.count()) > 0)
  /*
   * "The 2005 8BR Season 1 still exists, with its sixteen playoff seeds" used to be asserted here.
   * It is a statement about the RECORD, not about removing Rules, and only production can answer it
   * — which is what made this suite impossible to run without a copy of the live database.
   *
   * It lives in scripts/audit/audit-production.mts now. What belongs here is the question this suite
   * is actually asking: that tearing Rules out did not take the competition data with it.
   */
  check('Seasons still hold their entrants', (await prisma.seasonEntrant.count()) > 0)
  check('...and their playoff brackets', (await prisma.seasonPlayoffMatch.count()) > 0)
} catch (e) {
  fail++
  console.error(e)
}

console.log('')
console.log('--- A forward migration records the removal ---')
{
  const dir = 'src/migrations'
  const removal = readdirSync(dir).find((f) => /remove_rules\.ts$/.test(f))
  check('a Payload removal migration exists', !!removal, removal ?? 'none')
  if (removal) {
    const sql = readFileSync(join(dir, removal), 'utf8')
    check('it drops both Rules tables',
      /DROP TABLE IF EXISTS "payload"\."rules"/.test(sql) && /DROP TABLE IF EXISTS "payload"\."_rules_v"/.test(sql))
    check('it drops only the Rules column from the shared rels table, not the table',
      /DROP COLUMN IF EXISTS "rules_id"/.test(sql) && !/DROP TABLE[^;]*payload_locked_documents_rels/.test(sql))
    check('it is registered in the migration index',
      readFileSync(join(dir, 'index.ts'), 'utf8').includes('remove_rules'))
  }
  const prismaDir = 'prisma/migrations'
  const pr = readdirSync(prismaDir).find((f) => /remove_rules_feature$/.test(f))
  check('a Prisma removal migration exists for Competition.rulesRef', !!pr, pr ?? 'none')
  if (pr) {
    check('it drops the column and nothing else',
      /DROP COLUMN IF EXISTS "rulesRef"/.test(readFileSync(join(prismaDir, pr, 'migration.sql'), 'utf8')))
  }
  // History must remain buildable from scratch.
  check('the original Payload init migration is still present',
    readdirSync(dir).some((f) => /_init\.ts$/.test(f)))
  check('the original Prisma init migration is still present',
    readdirSync(prismaDir).some((f) => /_init$/.test(f)))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
