/**
 * Swap the Achievements tab for Players in the PUBLISHED navigation.
 *
 * ── Why a script and not just the code default ──────────────────────────────────────────────────
 * The header renders the navigation stored by the site builder, falling back to `factoryNav()` only
 * when nothing is published. Both have to change: the factory so a fresh install is right, and the
 * published document so THIS site is. Changing only the code leaves the tab exactly where it was,
 * which is what happened the first time.
 *
 * ── What it does and does not touch ─────────────────────────────────────────────────────────────
 * It edits one item in place — the entry pointing at /achievements becomes Players pointing at
 * /players — and leaves every other item, its order, and the rest of the document alone. A new
 * revision is published rather than the old one being rewritten, so the previous navigation stays
 * in history and can be restored from the site builder like any other.
 *
 * Idempotent: run it twice and the second run reports nothing to do.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/swap-nav-achievements-to-players.mts
 */
import { prisma } from '../src/lib/prisma.ts'

const FROM_HREF = '/achievements'
const TO = { label: 'Players', href: '/players' }

const page = await prisma.sitePage.findUnique({
  where: { key: 'nav' },
  select: { id: true, title: true, publishedRevisionId: true },
})
if (!page) {
  console.log('No published navigation — the factory default already carries Players. Nothing to do.')
  process.exit(0)
}

/*
  The LIVE revision, not the highest-numbered one.

  `SitePage.publishedRevisionId` is an explicit pointer at whichever revision is serving; a newer
  PUBLISHED row is not live until that pointer moves. Reading the newest instead produced a correct
  new revision that nothing rendered, which looked exactly like a caching problem and was not.
*/
const latest = page.publishedRevisionId
  ? await prisma.sitePageRevision.findUnique({
      where: { id: page.publishedRevisionId },
      select: { id: true, number: true, document: true },
    })
  : await prisma.sitePageRevision.findFirst({
      where: { pageId: page.id, state: 'PUBLISHED' },
      orderBy: { number: 'desc' },
      select: { id: true, number: true, document: true },
    })
if (!latest) {
  console.log('The navigation page has no published revision. Nothing to do.')
  process.exit(0)
}

const doc = JSON.parse(JSON.stringify(latest.document)) as {
  sections: { modules: { type: string; config: Record<string, unknown> }[] }[]
}

let changed = 0
for (const section of doc.sections ?? []) {
  for (const mod of section.modules ?? []) {
    if (mod.type !== 'global.navigation') continue
    const items = mod.config?.items
    if (!Array.isArray(items)) continue
    for (const item of items as Record<string, unknown>[]) {
      /*
        `destination` is the stored field; `href` is what `toLink` derives from it for rendering.
        Matching on the rendered shape found nothing and reported success — the stored document has
        its own vocabulary and this has to speak it.
      */
      if (item.destination !== FROM_HREF && item.customHref !== FROM_HREF) continue
      if (item.destination === FROM_HREF) item.destination = TO.href
      if (item.customHref === FROM_HREF) item.customHref = TO.href
      item.label = TO.label
      if (typeof item.mobileLabel === 'string' && item.mobileLabel) item.mobileLabel = TO.label
      changed++
    }
  }
}

if (changed === 0) {
  console.log('No Achievements item in the published navigation. Nothing to do.')
  process.exit(0)
}

const highest = await prisma.sitePageRevision.findFirst({
  where: { pageId: page.id },
  orderBy: { number: 'desc' },
  select: { number: true },
})

const created = await prisma.sitePageRevision.create({
  data: {
    pageId: page.id,
    number: (highest?.number ?? latest.number) + 1,
    document: doc,
    state: 'PUBLISHED',
    summary: 'Navigation: Achievements tab replaced by Players',
  },
  select: { id: true, number: true },
})

// Publishing IS moving this pointer. The revision alone is history, not what the site serves.
await prisma.sitePage.update({
  where: { id: page.id },
  data: { publishedRevisionId: created.id },
})

console.log(`Updated ${changed} item(s). Published revision ${created.number} (was ${latest.number}).`)
console.log('The published layout is cached; a deploy or a restart picks it up.')
await prisma.$disconnect()
