/**
 * Publish the homepage's new lower row: Yahoo Archives | Table Clear | Season Progress.
 *
 * ── Why a script and not just the factory layout ────────────────────────────────────────────────
 * The homepage renders the layout PUBLISHED by the site builder; `factory.ts` is only the bootstrap,
 * the recovery target and the last-resort fallback. So both have to change — the factory so a fresh
 * install is right, and the published document so THIS site is. Changing only the code leaves the
 * live page exactly as it was, which is the mistake the navigation swap made first time round.
 *
 * ── What it changes, precisely ──────────────────────────────────────────────────────────────────
 *   1. `home-record-row`  ratio 66-34 → 34-66, and its two children swap places.
 *   2. `home-break`       (the Break article card, currently the Season 2 predictions piece)
 *                         → `rankings.yahooArchives`, in the SAME narrow slot.
 *   3. `home-column-stack` (news plaques + achievement plaques) → `seasons.progress`.
 *
 * Nothing else is touched: the hero, the rankings rail, the marquee, the record feature and its
 * video, the stats bar, every section's width and every module's style all keep their stored values.
 * The record feature is not even read — its 58.7-second run, poster and holder are its own config.
 *
 * A NEW revision is published rather than the old one rewritten, so the previous homepage stays in
 * history and can be restored from the site builder like any other.
 *
 * Idempotent: run it twice and the second run reports nothing to do.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/publish-homepage-lower-row.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import '../src/components/site-builder/modules/index.ts'
import { getModule } from '../src/lib/site-builder/registry.ts'
import { defaultsFor } from '../src/lib/site-builder/fields.ts'

interface Instance {
  id: string
  type: string
  configVersion: number
  config: Record<string, unknown>
  layout: Record<string, unknown>
  style: Record<string, unknown>
  visibility: Record<string, unknown>
  reusableId: string | null
  children?: Instance[]
}

/**
 * Build an instance from the REGISTRY's defaults, exactly as the factory's `mod` helper does.
 *
 * Hand-writing a config here would be the way this drifts: a field added to the module tomorrow
 * would be missing from the published document, and the renderer would fall back to a default the
 * document does not record. Asking the registry means the published config and the module's schema
 * cannot disagree.
 */
function mod(id: string, type: string, config: Record<string, unknown> = {}): Instance {
  const def = getModule(type)
  if (!def) throw new Error(`No module registered as "${type}" — is it imported by modules/index.ts?`)
  return {
    id,
    type,
    configVersion: def.configVersion,
    config: { ...defaultsFor(def.fields), ...config },
    layout: { desktop: { span: 1, ...(def.layoutDefaults ?? {}) } },
    style: {},
    visibility: {},
    reusableId: null,
  }
}

const page = await prisma.sitePage.findUnique({
  where: { key: '/' },
  select: { id: true, publishedRevisionId: true },
})
if (!page) {
  console.log('No published homepage — the factory layout already carries the new row. Nothing to do.')
  process.exit(0)
}

/*
  The LIVE revision, not the highest-numbered one.

  `SitePage.publishedRevisionId` is an explicit pointer at whichever revision is serving; a newer
  PUBLISHED row is not live until that pointer moves. Reading the newest instead produces a correct
  new revision that nothing renders — which looks exactly like a caching problem and is not.
*/
const live = page.publishedRevisionId
  ? await prisma.sitePageRevision.findUnique({
      where: { id: page.publishedRevisionId },
      select: { id: true, number: true, document: true },
    })
  : await prisma.sitePageRevision.findFirst({
      where: { pageId: page.id, state: 'PUBLISHED' },
      orderBy: { number: 'desc' },
      select: { id: true, number: true, document: true },
    })
if (!live) {
  console.log('The homepage has no published revision. Nothing to do.')
  process.exit(0)
}

const doc = JSON.parse(JSON.stringify(live.document)) as {
  sections: { id: string; modules: Instance[] }[]
}

const changes: string[] = []

for (const section of doc.sections ?? []) {
  // ── 1 + 2. The record row: flip the ratio, swap the children, replace the article card. ──────
  for (const top of section.modules ?? []) {
    for (const child of top.children ?? []) {
      if (child.id !== 'home-record-row') continue

      if (child.config?.ratio === '66-34') {
        child.config.ratio = '34-66'
        changes.push('record row ratio 66-34 → 34-66')
      }

      const kids = child.children ?? []
      const breakIndex = kids.findIndex((k) => k.type === 'editorial.breakFeature')
      if (breakIndex >= 0) {
        /*
          Replaced in place and then moved to the front, rather than deleted and appended.

          Same slot, same narrow third — this is a position swap between two tiles, not a rebuild of
          the row. Doing it in two explicit steps keeps that visible: one line changes WHICH tile,
          the next changes WHERE the pair sit.
        */
        kids[breakIndex] = mod('home-yahoo-archives', 'rankings.yahooArchives')
        changes.push('Break article card → Yahoo Archives')
      }

      const yahooIndex = kids.findIndex((k) => k.type === 'rankings.yahooArchives')
      if (yahooIndex > 0) {
        const [tile] = kids.splice(yahooIndex, 1)
        kids.unshift(tile)
        changes.push('Yahoo Archives moved to the narrow left column')
      }
      child.children = kids
    }
  }

  // ── 3. The narrow column: news + achievements → Season Progress. ─────────────────────────────
  const stackIndex = (section.modules ?? []).findIndex((m) => m.id === 'home-column-stack')
  if (stackIndex >= 0) {
    section.modules[stackIndex] = mod('home-season-progress', 'seasons.progress')
    changes.push('news + achievements column → Season Progress')
  }
}

if (changes.length === 0) {
  console.log('The published homepage already has the new lower row. Nothing to do.')
  await prisma.$disconnect()
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
    number: (highest?.number ?? live.number) + 1,
    document: doc,
    state: 'PUBLISHED',
    summary: 'Homepage lower row: Yahoo Archives, Table Clear, Season Progress',
  },
  select: { id: true, number: true },
})

// Publishing IS moving this pointer. The revision alone is history, not what the site serves.
await prisma.sitePage.update({
  where: { id: page.id },
  data: { publishedRevisionId: created.id },
})

console.log(`Published revision ${created.number} (was ${live.number}):`)
for (const c of changes) console.log(`  · ${c}`)
console.log('The published layout is cached; a restart or a deploy picks it up.')
await prisma.$disconnect()
