// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

/**
 * Move every existing article into The Break as a published Post.
 *
 * ── The property that matters ────────────────────────────────────────────────────────────────────
 * Nothing is rewritten. The body is copied as-is — the same JSON document, not re-serialised, not
 * re-sanitised, not truncated — and the report proves it by comparing a SHA-256 of the stored body
 * on each side. Titles, slugs, authors and publication dates are carried across unchanged, and the
 * old URLs keep working through the slug history.
 *
 * ── Reversible by construction ───────────────────────────────────────────────────────────────────
 * The article tables are not touched at all. Each new post records `legacyArticleId`, so the two can
 * be compared at any time and the posts can be deleted and remade without the source having moved.
 * That is the compatibility period: both systems hold the same content, one of them serves it.
 *
 * Idempotent. An article that already has a post is skipped, so a re-run after a partial failure
 * finishes the job rather than duplicating it.
 *
 * Default is a DRY RUN. Writing requires --apply.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/migrate-articles-to-break.mts
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/migrate-articles-to-break.mts --apply
 */
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { decideCategory } from '../src/lib/break/legacy-map.ts'
import { documentToPlainText, sanitizeDocument } from '../src/lib/editorial/richtext.ts'

assertLocalDatabase('migrate-articles-to-break')

const APPLY = process.argv.includes('--apply')
const REPORT_DIR = 'verification/the-break'
const REPORT = `${REPORT_DIR}/migration-report.json`

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

interface Row {
  articleId: number
  title: string
  slug: string
  category: string
  categoryReason: string
  author: string
  handle: string | null
  playerId: string | null
  publishedAt: string | null
  bodyHash: string
  bodyBytes: number
  coverMedia: string | null
  comments: number
  views: number
  postId?: number
  postBodyHash?: string
  match?: boolean
}

async function main() {
  const categories = new Map(
    (await prisma.breakCategory.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]),
  )
  if (categories.size === 0) throw new Error('No Break categories exist — run the migration SQL first.')

  const articles = await prisma.article.findMany({
    include: {
      category: { select: { slug: true } },
      comments: { orderBy: { id: 'asc' } },
      slugHistory: true,
    },
    orderBy: { id: 'asc' },
  })

  console.log(`${articles.length} article(s) to consider.\n`)
  const rows: Row[] = []
  let created = 0, skipped = 0, commentsMoved = 0

  for (const a of articles) {
    const existing = await prisma.breakPost.findUnique({
      where: { legacyArticleId: a.id }, select: { id: true },
    })

    const decision = decideCategory(a.category?.slug ?? null, a.title)
    const row: Row = {
      articleId: a.id,
      title: a.title,
      slug: a.slug,
      category: decision.slug,
      categoryReason: decision.reason,
      author: a.authorNameSnapshot,
      handle: a.authorHandleSnapshot,
      playerId: a.authorPlayerId,
      publishedAt: (a.publishedAt ?? a.publishAt)?.toISOString() ?? null,
      bodyHash: sha(a.body),
      bodyBytes: JSON.stringify(a.body).length,
      coverMedia: a.coverMediaId,
      comments: a.comments.length,
      views: a.viewCount,
    }

    if (existing) {
      const post = await prisma.breakPost.findUniqueOrThrow({
        where: { id: existing.id }, select: { body: true },
      })
      row.postId = existing.id
      row.postBodyHash = sha(post.body)
      row.match = row.postBodyHash === row.bodyHash
      rows.push(row)
      skipped++
      console.log(`  #${a.id} "${a.title}" — already migrated as post ${existing.id}${row.match ? '' : '  BODY DIFFERS'}`)
      continue
    }

    console.log(`  #${a.id} "${a.title}"`)
    console.log(`      → ${decision.slug}  (${decision.reason})`)
    console.log(`      body ${row.bodyBytes} bytes, sha ${row.bodyHash.slice(0, 16)}…`)
    if (a.coverMediaId) console.log(`      cover ${a.coverMediaId}`)

    if (!APPLY) { rows.push(row); continue }

    /*
     * `state` maps rather than copies.
     *
     * Only a genuinely published article becomes a published post. A draft stays a draft, and an
     * archived or deleted one keeps that: publishing something during a migration because the
     * mapping was careless is not recoverable by the author.
     */
    const state = a.state === 'PUBLISHED' && (a.publishAt == null || a.publishAt <= new Date())
      ? 'PUBLISHED' as const
      : a.state === 'DRAFT' ? 'DRAFT' as const : 'DRAFT' as const
    const deletedAt = a.deletedAt ?? a.archivedAt ?? null

    const post = await prisma.$transaction(async (tx) => {
      const p = await tx.breakPost.create({
        data: {
          legacyArticleId: a.id,
          type: a.coverMediaId ? 'IMAGE' : 'TEXT',
          state,
          authorPlayerId: a.authorPlayerId,
          authorNameSnapshot: a.authorNameSnapshot,
          authorHandleSnapshot: a.authorHandleSnapshot,
          title: a.title,
          slug: a.slug,
          slugKey: a.slugKey,
          // Verbatim. Not re-sanitised: it was sanitised when it was written, and running it through
          // again risks a newer, stricter rule quietly dropping part of an existing article.
          body: a.body,
          bodyText: plainTextOf(a.body),
          categoryId: categories.get(decision.slug) ?? null,
          official: a.official,
          pinned: a.pinned,
          pinOrder: a.pinOrder,
          locked: a.commentsLocked,
          commentsEnabled: a.commentsEnabled,
          viewCount: a.viewCount,
          commentCount: a.comments.filter((c) => !c.deletedAt && !c.hiddenAt).length,
          publishedAt: a.publishedAt ?? a.publishAt ?? a.createdAt,
          // Only claim an edit where the source recorded one.
          editedAt: a.updatedAt > (a.publishedAt ?? a.createdAt) ? a.updatedAt : null,
          deletedAt,
          createdAt: a.createdAt,
        },
        select: { id: true },
      })

      // The cover image becomes the post's media, so the card has a thumbnail and the post a header.
      if (a.coverMediaId) {
        await tx.breakPostMedia.create({
          data: {
            postId: p.id,
            kind: 'IMAGE',
            status: 'READY',
            // The route that SERVES an uploaded file, not the one that accepts an upload.
            // `/api/news/media` is POST-only, so the URL built from it answered 405 and every
            // migrated cover rendered as a broken image.
            url: `/api/media/file/${encodeURIComponent(a.coverMediaId)}`,
            storageKey: a.coverMediaId,
            mimeType: guessMime(a.coverMediaId),
            alt: a.coverAlt ?? a.title,
          },
        })
      }

      // Old URLs. Every slug the article has ever had points at the new post.
      const seen = new Set<string>()
      for (const h of a.slugHistory) {
        if (seen.has(h.slugKey)) continue
        seen.add(h.slugKey)
        await tx.breakPostSlug.create({
          data: { postId: p.id, slug: h.slug, slugKey: h.slugKey },
        }).catch(() => { /* a slug already claimed by another post keeps its first owner */ })
      }

      /*
       * The author's own +1.
       *
       * Published content starts at +1 from its author, and it is a REAL vote row that the author can
       * remove — not a number added to the score. Migrated posts follow the same rule so the two
       * cannot be told apart afterwards.
       */
      if (state === 'PUBLISHED' && a.authorPlayerId) {
        await tx.breakPostVote.create({
          data: { postId: p.id, playerId: a.authorPlayerId, value: 1 },
        })
        await tx.breakPost.update({
          where: { id: p.id }, data: { score: 1, upvotes: 1 },
        })
      }

      // Comments, keeping their thread shape. The legacy system allowed one level of replies.
      const idMap = new Map<number, { id: number; path: string; depth: number }>()
      for (const c of a.comments) {
        const parent = c.parentId ? idMap.get(c.parentId) : null
        const depth = parent ? parent.depth + 1 : 0
        const made = await tx.breakComment.create({
          data: {
            postId: p.id,
            parentId: parent?.id ?? null,
            path: 'pending',
            depth,
            authorPlayerId: c.authorPlayerId,
            authorNameSnapshot: c.authorNameSnapshot,
            body: { v: 1, blocks: [{ t: 'p', c: [{ t: 'text', v: c.body }] }] },
            bodyText: c.body,
            editedAt: c.editedAt,
            deletedAt: c.deletedAt,
            removedAt: c.hiddenAt,
            removedByPlayerId: c.hiddenByPlayerId,
            createdAt: c.createdAt,
          },
          select: { id: true },
        })
        const path = parent ? `${parent.path}.${String(made.id).padStart(10, '0')}` : String(made.id).padStart(10, '0')
        await tx.breakComment.update({ where: { id: made.id }, data: { path } })
        idMap.set(c.id, { id: made.id, path, depth })
        commentsMoved++
        if (parent) {
          await tx.breakComment.update({
            where: { id: parent.id }, data: { replyCount: { increment: 1 } },
          })
        }
      }

      return p
    }, { timeout: 120_000 })

    const back = await prisma.breakPost.findUniqueOrThrow({ where: { id: post.id }, select: { body: true } })
    row.postId = post.id
    row.postBodyHash = sha(back.body)
    row.match = row.postBodyHash === row.bodyHash
    rows.push(row)
    created++
    console.log(`      created post ${post.id}  body ${row.match ? 'IDENTICAL' : 'DIFFERS — investigate'}`)
  }

  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(REPORT, JSON.stringify({
    ranAt: new Date().toISOString(),
    applied: APPLY,
    articles: articles.length,
    created,
    skipped,
    commentsMoved,
    bodiesIdentical: rows.filter((r) => r.match === true).length,
    bodiesDiffering: rows.filter((r) => r.match === false).length,
    rows,
  }, null, 2))

  console.log(`\n${APPLY ? 'Applied' : 'DRY RUN'}: ${created} created, ${skipped} already present, ${commentsMoved} comments moved.`)
  console.log(`Report → ${REPORT}`)
  if (!APPLY) console.log('\nRe-run with --apply to write.')
}

/** Flatten a stored body to plain text for the search index, tolerating an unexpected shape. */
function plainTextOf(body: unknown): string {
  try {
    return documentToPlainText(sanitizeDocument(body)).slice(0, 100_000)
  } catch {
    return ''
  }
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  return ext === 'png' ? 'image/png'
    : ext === 'gif' ? 'image/gif'
    : ext === 'webp' ? 'image/webp'
    : 'image/jpeg'
}

let code = 0
try {
  await main()
} catch (e) {
  code = 1
  console.log('\nFAILED: ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await prisma.$disconnect()
}
process.exit(code)
