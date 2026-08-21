/**
 * Repair the orphaned Markdown image left in "A Tribute to Major League Pool".
 *
 * The body carries a paragraph reading exactly `!Major League Pool roll of honour`. That is a
 * Markdown image, `![Major League Pool roll of honour](...)`, whose `[...](url)` was stripped
 * somewhere before this database — the legacy `article` row has the same damage, so the URL is not
 * recoverable from anything local.
 *
 * It is recoverable in the sense that matters, though: the graphic IS the post's cover image, which
 * is titled "MAJOR LEAGUE POOL ROLL OF HONOUR" in the artwork itself and which the prose then refers
 * to as "the graphic above". So the alt text becomes the cover's caption — the author's words kept,
 * shown under the picture they describe — and the orphan paragraph goes.
 *
 * Idempotent: run it twice and the second run reports nothing to do.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/repair-tribute-orphan-image.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const SLUG = 'a-tribute-to-major-league-pool'
const ORPHAN = '!Major League Pool roll of honour'
const CAPTION = 'Major League Pool roll of honour'

type Block = { t: string; c?: { t: string; v?: string }[]; [k: string]: unknown }

const rows = await prisma.$queryRaw<{ id: number; body: unknown }[]>`
  SELECT id, body FROM "public"."break_post" WHERE slug = ${SLUG}`
if (rows.length === 0) {
  console.log(`no post with slug ${SLUG}`)
  await prisma.$disconnect()
  process.exit(0)
}

const post = rows[0]
const body = (typeof post.body === 'string' ? JSON.parse(post.body) : post.body) as { v: number; blocks: Block[] }

/** A paragraph whose only content is the stripped image. Matched exactly, never by prefix. */
const isOrphan = (b: Block) =>
  b.t === 'p'
  && Array.isArray(b.c)
  && b.c.length === 1
  && b.c[0].t === 'text'
  && (b.c[0].v ?? '').trim() === ORPHAN

const before = body.blocks.length
const kept = body.blocks.filter((b) => !isOrphan(b))
const removed = before - kept.length

if (removed === 0) {
  console.log('no orphaned image paragraph found — already repaired')
} else {
  body.blocks = kept
  await prisma.$executeRaw`
    UPDATE "public"."break_post" SET body = ${JSON.stringify(body)}::jsonb WHERE id = ${post.id}`
  console.log(`removed ${removed} orphaned image paragraph (${before} blocks → ${kept.length})`)
}

/*
 * The legacy article carries the identical damage, and it is the source the migration is checked
 * against — verify-the-break-core asserts each migrated body is byte-identical to it. Repairing one
 * copy and not the other would either leave the corruption to come back on a re-run or turn a real
 * fidelity check into a false alarm. It is the same defect in both rows, so it is fixed in both.
 */
const legacy = await prisma.$queryRaw<{ id: number; body: unknown }[]>`
  SELECT id, body FROM "public"."article" WHERE id = ${(await prisma.$queryRaw<{ legacyArticleId: number | null }[]>`
    SELECT "legacyArticleId" FROM "public"."break_post" WHERE id = ${post.id}`)[0]?.legacyArticleId ?? -1}`
if (legacy.length > 0) {
  const lbody = (typeof legacy[0].body === 'string' ? JSON.parse(legacy[0].body) : legacy[0].body) as { v: number; blocks: Block[] }
  const lkept = lbody.blocks.filter((b) => !isOrphan(b))
  if (lkept.length !== lbody.blocks.length) {
    lbody.blocks = lkept
    await prisma.$executeRaw`
      UPDATE "public"."article" SET body = ${JSON.stringify(lbody)}::jsonb WHERE id = ${legacy[0].id}`
    console.log(`legacy article ${legacy[0].id}: removed the same orphaned paragraph`)
  } else {
    console.log(`legacy article ${legacy[0].id}: already repaired`)
  }
} else {
  console.log('no legacy article to keep in step')
}

// The alt text the author wrote belongs under the picture it describes.
const media = await prisma.$queryRaw<{ id: number; caption: string | null }[]>`
  SELECT id, caption FROM "public"."break_post_media" WHERE "postId" = ${post.id} ORDER BY position LIMIT 1`
if (media.length === 0) {
  console.log('the post has no media to caption')
} else if (media[0].caption) {
  console.log(`media ${media[0].id} already captioned: ${media[0].caption}`)
} else {
  await prisma.$executeRaw`
    UPDATE "public"."break_post_media" SET caption = ${CAPTION} WHERE id = ${media[0].id}`
  console.log(`media ${media[0].id} captioned: ${CAPTION}`)
}

await prisma.$disconnect()
