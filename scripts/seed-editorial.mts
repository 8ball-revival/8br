// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

/**
 * Seed the editorial categories and the homepage settings singleton.
 *
 * Idempotent: safe to run repeatedly, and it never overwrites an administrator's later edits to a
 * category's name, description or order — it only fills in what is missing.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/seed-editorial.mts
 */
import { prisma } from '../src/lib/prisma.ts'

const CATEGORIES = [
  { slug: 'official-news', name: 'Official News', adminOnly: true, sortOrder: 10,
    description: 'Announcements from 8 Ball Registry.' },
  { slug: 'predictions', name: 'Predictions', adminOnly: false, sortOrder: 20,
    description: 'Calls on upcoming matches, Seasons and Tournaments.' },
  { slug: 'analysis', name: 'Analysis', adminOnly: false, sortOrder: 30,
    description: 'A closer look at form, matchups and results.' },
  { slug: 'history', name: 'History', adminOnly: false, sortOrder: 40,
    description: 'Looking back at past competition.' },
  { slug: 'community', name: 'Community', adminOnly: false, sortOrder: 50,
    description: 'Stories and writing from the community.' },
]

const [conn] = await prisma.$queryRaw<{ db: string; port: string }[]>`
  SELECT current_database() AS db, current_setting('port') AS port`
if (conn.db !== '8br_dev' || conn.port !== '55432') { console.error('WRONG DATABASE', conn); process.exit(1) }

let created = 0
for (const c of CATEGORIES) {
  const existing = await prisma.articleCategory.findUnique({ where: { slug: c.slug }, select: { id: true } })
  if (existing) continue
  await prisma.articleCategory.create({ data: c })
  created += 1
}

await prisma.editorialSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } })

console.log(`categories created: ${created} (of ${CATEGORIES.length})`)
console.log('categories now:', (await prisma.articleCategory.findMany({ orderBy: { sortOrder: 'asc' }, select: { slug: true, adminOnly: true } })))
console.log('settings row:', await prisma.editorialSettings.findUnique({ where: { id: 1 }, select: { id: true, showFeatured: true } }))
await prisma.$disconnect()
