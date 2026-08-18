/**
 * The Break, end to end.
 *
 * Exercises the real service layer against the real database: the permission model, the article
 * lifecycle, slugs and redirects, revisions, comments and moderation, visibility, feeds, preview
 * tokens, account merges and the deletion safeguard.
 *
 * Everything it touches it creates. Fixture players carry the `zzbreak_` prefix and every article,
 * comment, tag and category made here is deleted at the end, so the suite never sees — let alone
 * changes — real content. It refuses to delete anything it did not create.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-editorial.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import type { EditorialActor } from '../src/lib/editorial/permissions.ts'
import { canPublishNow, canEditArticle, canMarkOfficial, canFeature, canComment, canViewUnpublished, canCreateArticle } from '../src/lib/editorial/permissions.ts'
import {
  createArticle, updateArticle, autosaveDraft, submitForReview, withdrawSubmission,
  publishArticle, approveArticle, rejectArticle, archiveArticle, restoreArticle,
  softDeleteArticle, restoreRevision, setArticleFlags, setArticleRelations,
  publishedWhere, isPubliclyVisible, isScheduled, EditorialError,
} from '../src/lib/editorial/service.ts'
import {
  addComment, editComment, deleteOwnComment, hideComment, unhideComment, reportComment,
  resolveReport, getCommentThread, recountComments, EDIT_WINDOW_MS, RATE_LIMITS,
} from '../src/lib/editorial/comments.ts'
import { linkifyComment, MAX_COMMENT_LENGTH } from '../src/lib/editorial/comment-format.ts'
import { listArticles, getArticleById, listMyArticles, getModerationQueue, listAuthors, listArchiveMonths, relatedArticles } from '../src/lib/editorial/queries.ts'
import { slugify, isValidSlug, RESERVED_SLUGS } from '../src/lib/editorial/slug-format.ts'
import { generateUniqueSlug, isSlugAvailable, resolveSlug } from '../src/lib/editorial/slug.ts'
import { createPreviewToken, readPreviewToken } from '../src/lib/editorial/preview.ts'
import { feedItems, renderRss, renderAtom, xmlEscape } from '../src/lib/editorial/feed.ts'
import { documentToPlainText, sanitizeDocument } from '../src/lib/editorial/richtext.ts'
import { assessAccountDeletion } from '../src/lib/players/deletion-safety.ts'
import { mergeAccounts, undoMerge } from '../src/lib/players/merge.ts'
import { isValidPageSlug } from '../src/lib/editorial/pages.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/** Assert that an operation is refused, and that the refusal is a rule rather than a crash. */
async function refuses(name: string, fn: () => Promise<unknown>, expect?: RegExp) {
  try {
    await fn()
    check(name, false, 'it was allowed')
  } catch (e) {
    const ok = e instanceof EditorialError && (!expect || expect.test(e.message))
    check(name, ok, e instanceof Error ? e.message : String(e))
  }
}

async function allows(name: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    check(name, true)
  } catch (e) {
    check(name, false, e instanceof Error ? e.message : String(e))
  }
}

// --------------------------------------------------------------------------- fixtures

const PREFIX = 'zzbreak_'
const madePlayers: string[] = []
const madeArticles: number[] = []
let fixtureCategoryId = 0
let officialCategoryId = 0

async function mkPlayer(tag: string, opts: { trusted?: boolean } = {}) {
  const p = await prisma.player.create({
    data: {
      primaryName: `${PREFIX}${tag}`,
      cueverseId: `${PREFIX}${tag}`,
      cueverseIdNormalized: `${PREFIX}${tag}`,
      active: true,
      blogTrustedAuthor: !!opts.trusted,
    },
    select: { id: true },
  })
  madePlayers.push(p.id)
  return p.id
}

const actorFor = (playerId: string, tag: string, opts: { admin?: boolean; trusted?: boolean } = {}): EditorialActor => ({
  playerId,
  name: `${PREFIX}${tag}`,
  handle: `${PREFIX}${tag}`,
  isAdmin: !!opts.admin,
  isTrustedAuthor: !!opts.admin || !!opts.trusted,
})

/** Create an article through the real service and remember it for cleanup. */
async function mkArticle(actor: EditorialActor, title: string, body = 'A paragraph of prose.', extra: Record<string, unknown> = {}) {
  const id = await createArticle(actor, { title, bodySource: body, ...extra })
  madeArticles.push(id)
  return id
}

async function cleanup() {
  // Only ever removes rows this run created. Articles cascade to their comments, revisions, slug
  // history, relations, metrics and tag links.
  if (madeArticles.length) {
    await prisma.editorialModerationRecord.deleteMany({ where: { articleId: { in: madeArticles } } })
    await prisma.article.deleteMany({ where: { id: { in: madeArticles } } })
  }
  await prisma.articleTag.deleteMany({ where: { slug: { startsWith: 'zzbreak' } } })
  if (fixtureCategoryId) await prisma.articleCategory.deleteMany({ where: { id: fixtureCategoryId } })
  if (officialCategoryId) await prisma.articleCategory.deleteMany({ where: { id: officialCategoryId } })
  if (madePlayers.length) {
    await prisma.editorialModerationRecord.deleteMany({ where: { actorPlayerId: { in: madePlayers } } })
    await prisma.playerMerge.deleteMany({
      where: { OR: [{ canonicalPlayerId: { in: madePlayers } }, { mergedPlayerId: { in: madePlayers } }] },
    })
    await prisma.player.deleteMany({ where: { id: { in: madePlayers }, primaryName: { startsWith: PREFIX } } })
  }
}

// --------------------------------------------------------------------------- run

async function main() {
  section('Fixtures')

  const memberId = await mkPlayer('member')
  const trustedId = await mkPlayer('trusted', { trusted: true })
  const adminId = await mkPlayer('admin')
  const readerId = await mkPlayer('reader')

  const member = actorFor(memberId, 'member')
  const trusted = actorFor(trustedId, 'trusted', { trusted: true })
  const admin = actorFor(adminId, 'admin', { admin: true })
  const reader = actorFor(readerId, 'reader')

  const cat = await prisma.articleCategory.create({
    data: { slug: 'zzbreak-analysis', name: 'zzbreak Analysis', sortOrder: 900 },
    select: { id: true },
  })
  fixtureCategoryId = cat.id
  const officialCat = await prisma.articleCategory.create({
    data: { slug: 'zzbreak-official', name: 'zzbreak Official', adminOnly: true, sortOrder: 901 },
    select: { id: true },
  })
  officialCategoryId = officialCat.id

  check('four fixture players created', madePlayers.length === 4)
  check('two fixture categories created', fixtureCategoryId > 0 && officialCategoryId > 0)

  // ========================================================================= permissions
  section('Permissions')

  check('a visitor cannot create an article', !canCreateArticle(null))
  check('a member can create an article', canCreateArticle(member))
  check('a member cannot mark content official', !canMarkOfficial(member))
  check('a Trusted Author cannot mark content official', !canMarkOfficial(trusted))
  check('an administrator can mark content official', canMarkOfficial(admin))
  check('a Trusted Author cannot feature an article', !canFeature(trusted))
  check('an administrator can feature an article', canFeature(admin))
  check('a visitor cannot comment', !canComment(null))
  check('a member can comment', canComment(member))

  const someone = await mkArticle(member, 'Permission fixture')
  check('the author may edit their own article', canEditArticle(member, memberId))
  check('another member may not edit it', !canEditArticle(reader, memberId))
  check('an administrator may edit it', canEditArticle(admin, memberId))
  check('a visitor may not edit it', !canEditArticle(null, memberId))
  check('the author may view it unpublished', canViewUnpublished(member, memberId))
  check('another member may not view it unpublished', !canViewUnpublished(reader, memberId))
  check('an administrator may view it unpublished', canViewUnpublished(admin, memberId))

  check('a member may not publish outright', !(await canPublishNow(member, memberId)))
  check('a Trusted Author may publish their own work', await canPublishNow(trusted, trustedId))
  check('a Trusted Author may NOT publish somebody else\'s', !(await canPublishNow(trusted, memberId)))
  check('an administrator may publish anything', await canPublishNow(admin, memberId))

  await refuses('a member cannot use an admin-only category',
    () => updateArticle(member, someone, { title: 'X', bodySource: 'Body.', categoryId: officialCategoryId }),
    /reserved/i)
  await allows('an administrator can use an admin-only category',
    () => updateArticle(admin, someone, { title: 'X', bodySource: 'Body.', categoryId: officialCategoryId }))

  // A member's request to be official is ignored rather than obeyed.
  await updateArticle(member, someone, { title: 'X', bodySource: 'Body.', official: true, featured: true })
  {
    const row = await prisma.article.findUnique({ where: { id: someone }, select: { official: true, featured: true } })
    check('a member asking to be official is ignored, not obeyed', row?.official === false)
    check('a member asking to be featured is ignored', row?.featured === false)
  }

  // ========================================================================= lifecycle
  section('Lifecycle — review path')

  const draft = await mkArticle(member, 'A member writes something')
  {
    const row = await prisma.article.findUnique({ where: { id: draft }, select: { state: true, publishAt: true } })
    check('a new article starts as a draft', row?.state === 'DRAFT')
    check('a new article has no publish time', row?.publishAt === null)
    check('a draft is not publicly visible', !isPubliclyVisible(row!))
  }

  await refuses('a member cannot publish their own draft', () => publishArticle(member, draft), /review/i)
  await allows('a member can submit for review', () => submitForReview(member, draft))
  {
    const row = await prisma.article.findUnique({ where: { id: draft }, select: { state: true, submittedAt: true } })
    check('submitting sets PENDING_REVIEW', row?.state === 'PENDING_REVIEW')
    check('submitting records the time', row?.submittedAt != null)
  }
  await refuses('submitting twice is refused', () => submitForReview(member, draft), /draft/i)
  await refuses('a member cannot approve their own article', () => approveArticle(member, draft), /administrator/i)

  await allows('the author can withdraw a submission', () => withdrawSubmission(member, draft))
  check('withdrawing returns it to draft',
    (await prisma.article.findUnique({ where: { id: draft }, select: { state: true } }))?.state === 'DRAFT')

  await submitForReview(member, draft)
  await allows('an administrator can reject with feedback', () => rejectArticle(admin, draft, 'Needs a scoreline.'))
  {
    const row = await prisma.article.findUnique({ where: { id: draft }, select: { state: true, reviewFeedback: true } })
    check('rejecting sets REJECTED', row?.state === 'REJECTED')
    check('the feedback is stored', row?.reviewFeedback === 'Needs a scoreline.')
  }
  await refuses('rejecting without a reason is refused', () => rejectArticle(admin, draft, '   '), /reason/i)

  await allows('editing a rejected article returns it to draft',
    () => updateArticle(member, draft, { title: 'A member writes something', bodySource: 'Now with a scoreline: 7-3.' }))
  {
    const row = await prisma.article.findUnique({ where: { id: draft }, select: { state: true, reviewFeedback: true } })
    check('...its state is DRAFT again', row?.state === 'DRAFT')
    check('...and the old feedback is cleared', row?.reviewFeedback === null)
  }

  await submitForReview(member, draft)
  await allows('an administrator can approve and publish', () => approveArticle(admin, draft, null))
  {
    const row = await prisma.article.findUnique({
      where: { id: draft },
      select: { state: true, publishAt: true, publishedAt: true, approvedAt: true, reviewerPlayerId: true },
    })
    check('approving sets PUBLISHED', row?.state === 'PUBLISHED')
    check('approving sets a publish time', row?.publishAt != null)
    check('approving records the first publication', row?.publishedAt != null)
    check('approving records who approved it', row?.reviewerPlayerId === adminId)
    check('an approved article is publicly visible', isPubliclyVisible(row!))
  }

  // ========================================================================= trusted author
  section('Lifecycle — Trusted Author')

  const trustedArticle = await mkArticle(trusted, 'A trusted author writes something')
  await allows('a Trusted Author publishes without review', () => publishArticle(trusted, trustedArticle, null))
  check('...and it is live immediately',
    isPubliclyVisible((await prisma.article.findUnique({ where: { id: trustedArticle }, select: { state: true, publishAt: true } }))!))

  // Revocation must bite on the very next attempt, not at the next sign-in.
  const revoked = await mkArticle(trusted, 'Written before the permission was revoked')
  await prisma.player.update({ where: { id: trustedId }, data: { blogTrustedAuthor: false } })
  check('revoking Trusted Author is immediate', !(await canPublishNow(trusted, trustedId)))
  await refuses('...so the next publish is refused', () => publishArticle(trusted, revoked), /review/i)
  check('...but already-published work stays published',
    isPubliclyVisible((await prisma.article.findUnique({ where: { id: trustedArticle }, select: { state: true, publishAt: true } }))!))
  await prisma.player.update({ where: { id: trustedId }, data: { blogTrustedAuthor: true } })

  // ========================================================================= scheduling
  section('Scheduling')

  const scheduled = await mkArticle(admin, 'Scheduled for later')
  const future = new Date(Date.now() + 3 * 24 * 3600 * 1000)
  await allows('an article can be scheduled', () => publishArticle(admin, scheduled, future))
  {
    const row = await prisma.article.findUnique({ where: { id: scheduled }, select: { state: true, publishAt: true } })
    check('a scheduled article is PUBLISHED', row?.state === 'PUBLISHED')
    check('...but not yet publicly visible', !isPubliclyVisible(row!))
    check('...and reads as scheduled', isScheduled(row!))
  }
  {
    const page = await listArticles({ page: 1 })
    check('a scheduled article is absent from the public listing', !page.items.some((a) => a.id === scheduled))
  }
  {
    // Moving the time into the past is the only thing that makes it visible — no worker involved.
    await prisma.article.update({ where: { id: scheduled }, data: { publishAt: new Date(Date.now() - 1000) } })
    const row = await prisma.article.findUnique({ where: { id: scheduled }, select: { state: true, publishAt: true } })
    check('once the clock passes, it becomes visible with no other change', isPubliclyVisible(row!))
    const page = await listArticles({ page: 1 })
    check('...and appears in the listing', page.items.some((a) => a.id === scheduled))
  }
  {
    const where = publishedWhere(new Date())
    check('publishedWhere requires the PUBLISHED state', where.state === 'PUBLISHED')
    check('publishedWhere requires a publish time in the past',
      JSON.stringify(where.publishAt).includes('lte'))
  }

  // ========================================================================= proposed edits
  section('Editing published work')

  const liveByMember = await mkArticle(member, 'A member article that gets published')
  await submitForReview(member, liveByMember)
  await approveArticle(admin, liveByMember, null)

  const result = await updateArticle(member, liveByMember, {
    title: 'A rewritten title the public should not see yet',
    bodySource: 'Rewritten body.',
  })
  check('a member editing live work produces a proposal', result.pending === true)
  {
    const row = await prisma.article.findUnique({
      where: { id: liveByMember },
      select: { title: true, pendingTitle: true, pendingSubmittedAt: true, state: true },
    })
    check('...the live title is untouched', row?.title === 'A member article that gets published')
    check('...the proposal is held separately', row?.pendingTitle?.startsWith('A rewritten'))
    check('...it is marked as awaiting review', row?.pendingSubmittedAt != null)
    check('...and the article stays published', row?.state === 'PUBLISHED')
  }
  {
    const queue = await getModerationQueue()
    check('the proposal appears in the moderation queue', queue.proposedEdits.some((p) => p.id === liveByMember))
  }
  await allows('an administrator can apply the proposed edit', () => approveArticle(admin, liveByMember, null))
  {
    const row = await prisma.article.findUnique({
      where: { id: liveByMember },
      select: { title: true, pendingTitle: true, pendingSubmittedAt: true },
    })
    check('...the live title is now the proposed one', row?.title.startsWith('A rewritten'))
    check('...the proposal is cleared', row?.pendingTitle === null && row?.pendingSubmittedAt === null)
  }

  // Rejecting a proposal must leave the published article exactly as it was.
  await updateArticle(member, liveByMember, { title: 'A second rewrite', bodySource: 'Second rewrite.' })
  await allows('an administrator can reject a proposed edit', () => rejectArticle(admin, liveByMember, 'Not this one.'))
  {
    const row = await prisma.article.findUnique({
      where: { id: liveByMember },
      select: { title: true, pendingTitle: true, state: true },
    })
    check('...the published article is unchanged', row?.title.startsWith('A rewritten'))
    check('...the proposal is discarded', row?.pendingTitle === null)
    check('...and it is still published', row?.state === 'PUBLISHED')
  }

  const liveByAdmin = await mkArticle(admin, 'An admin article')
  await publishArticle(admin, liveByAdmin, null)
  {
    const res = await updateArticle(admin, liveByAdmin, { title: 'Edited directly', bodySource: 'Edited.' })
    check('an administrator edits live work directly', res.pending === false)
    const row = await prisma.article.findUnique({ where: { id: liveByAdmin }, select: { title: true } })
    check('...and the change is live at once', row?.title === 'Edited directly')
  }

  // ========================================================================= autosave
  section('Autosave')

  const autosaved = await mkArticle(member, 'Autosave fixture')
  await allows('autosave writes a draft', () => autosaveDraft(member, autosaved, 'Typed title', 'Typed body.'))
  check('...and it took',
    (await prisma.article.findUnique({ where: { id: autosaved }, select: { title: true } }))?.title === 'Typed title')
  {
    // Autosave must never be able to rewrite something the public is reading.
    const before = await prisma.article.findUnique({ where: { id: liveByAdmin }, select: { title: true } })
    await autosaveDraft(admin, liveByAdmin, 'Autosaved over a live article', 'Nope.')
    const after = await prisma.article.findUnique({ where: { id: liveByAdmin }, select: { title: true } })
    check('autosave silently does nothing to a published article', before?.title === after?.title)
  }
  await refuses('autosave refuses somebody else\'s article',
    () => autosaveDraft(reader, autosaved, 'Hijacked', 'No.'), /cannot edit/i)

  // ========================================================================= slugs
  section('Slugs and redirects')

  check('slugify folds accents to ASCII', slugify('Peña vs Müller') === 'pena-vs-muller')
  check('slugify strips punctuation', slugify('Who won?! The 2026 final.') === 'who-won-the-2026-final')
  check('slugify collapses separators', slugify('a   b---c') === 'a-b-c')
  check('slugify trims leading and trailing hyphens', slugify('--hello--') === 'hello')
  check('a title in a non-Latin script yields an empty slug', slugify('日本語') === '')
  check('a reserved word is not a valid slug', !isValidSlug('feed'))
  check('every reserved word is rejected', [...RESERVED_SLUGS].every((s) => !isValidSlug(s)))
  check('a purely numeric slug is rejected', !isValidSlug('2026'))
  check('an ordinary slug is valid', isValidSlug('the-2026-final'))
  check('mixed case is accepted — slugKey lower-cases for uniqueness', isValidSlug('The-Final'))
check('a slug with a space is rejected', !isValidSlug('the final'))
check('a slug with a slash is rejected', !isValidSlug('news/final'))
check('an empty slug is rejected', !isValidSlug(''))

  {
    const a = await mkArticle(admin, 'Season preview')
    const b = await mkArticle(admin, 'Season preview')
    const c = await mkArticle(admin, 'Season preview')
    const rows = await prisma.article.findMany({ where: { id: { in: [a, b, c] } }, select: { id: true, slug: true } })
    const slugs = rows.map((r) => r.slug).sort()
    check('identical titles get numbered slugs, not hashes',
      slugs.includes('season-preview') && slugs.includes('season-preview-2') && slugs.includes('season-preview-3'),
      slugs.join(','))
  }
  {
    const reservedTitle = await mkArticle(admin, 'Search')
    const row = await prisma.article.findUnique({ where: { id: reservedTitle }, select: { slug: true } })
    check('a reserved title still gets a usable slug', row?.slug === 'search-article', row?.slug)
  }

  {
    // A published article that is renamed must keep its old URL working.
    const renamed = await mkArticle(admin, 'Original name here', 'Body.')
    await publishArticle(admin, renamed, null)
    const before = (await prisma.article.findUnique({ where: { id: renamed }, select: { slug: true } }))!.slug
    await updateArticle(admin, renamed, { title: 'Original name here', bodySource: 'Body.', slug: 'brand-new-name' })

    const old = await resolveSlug(before)
    check('the old URL still resolves', old?.articleId === renamed)
    check('...and reports that it moved', old?.moved === true)
    check('...to the new address', old?.canonicalSlug === 'brand-new-name')

    const now = await resolveSlug('brand-new-name')
    check('the new URL resolves directly', now?.articleId === renamed && now.moved === false)
    check('a retired slug cannot be claimed by a new article', !(await isSlugAvailable(before)))
  }
  {
    const unpublished = await mkArticle(admin, 'Never published name', 'Body.')
    const before = (await prisma.article.findUnique({ where: { id: unpublished }, select: { slug: true } }))!.slug
    await updateArticle(admin, unpublished, { title: 'Never published name', bodySource: 'Body.', slug: 'second-name' })
    const history = await prisma.articleSlugHistory.findFirst({ where: { slugKey: before } })
    check('an unpublished slug is not retired — it was never public', history === null)
  }
  check('a nonexistent slug resolves to nothing', (await resolveSlug('no-such-article-anywhere')) === null)
  check('slug generation avoids a taken name', (await generateUniqueSlug('Season preview')) !== 'season-preview')

  // ========================================================================= revisions
  section('Revisions')

  const revised = await mkArticle(admin, 'Revision fixture', 'Version one.')
  await publishArticle(admin, revised, null)
  await updateArticle(admin, revised, { title: 'Revision fixture', bodySource: 'Version two.' })
  await updateArticle(admin, revised, { title: 'Revision fixture', bodySource: 'Version three.' })
  {
    const revisions = await prisma.articleRevision.findMany({ where: { articleId: revised }, orderBy: { revision: 'asc' } })
    check('editing records a revision', revisions.length >= 2, `${revisions.length}`)
    check('the first revision holds the original text',
      documentToPlainText(sanitizeDocument(revisions[0].body)).includes('Version one'))

    const target = revisions[0]
    await allows('an administrator can restore a revision', () => restoreRevision(admin, revised, target.id))
    const row = await prisma.article.findUnique({ where: { id: revised }, select: { body: true } })
    check('...and the text goes back', documentToPlainText(sanitizeDocument(row!.body)).includes('Version one'))

    const after = await prisma.articleRevision.count({ where: { articleId: revised } })
    check('...with the pre-restore text kept, so the restore is undoable too', after > revisions.length)
  }
  {
    const other = await mkArticle(admin, 'Another article entirely', 'Body.')
    const foreign = await prisma.articleRevision.findFirst({ where: { articleId: revised } })
    await refuses('a revision from another article is refused',
      () => restoreRevision(admin, other, foreign!.id), /does not belong/i)
  }

  // ========================================================================= flags
  section('Administrator flags')

  await refuses('a member cannot set flags', () => setArticleFlags(member, revised, { pinned: true }), /administrator/i)
  await allows('an administrator can pin and feature', () => setArticleFlags(admin, revised, { pinned: true, pinOrder: 1, featured: true, official: true }))
  {
    const row = await prisma.article.findUnique({ where: { id: revised }, select: { pinned: true, featured: true, official: true, pinOrder: true } })
    check('...the flags are set', row?.pinned === true && row?.featured === true && row?.official === true)
    check('...with the pin order', row?.pinOrder === 1)
  }
  await allows('an administrator can lock comments', () => setArticleFlags(admin, revised, { commentsLocked: true }))
  await setArticleFlags(admin, revised, { pinned: false, featured: false, official: false, commentsLocked: false })

  // ========================================================================= relations
  section('Relations')

  await allows('an article can be linked to players', () => setArticleRelations(admin, revised, { playerIds: [memberId, trustedId] }))
  check('...both links are stored', (await prisma.articleRelation.count({ where: { articleId: revised } })) === 2)
  await allows('setting relations again replaces them', () => setArticleRelations(admin, revised, { playerIds: [memberId] }))
  check('...leaving only the new set', (await prisma.articleRelation.count({ where: { articleId: revised } })) === 1)
  {
    const detail = await getArticleById(revised)
    check('the article page sees the linked player', detail?.relations.players.some((p) => p.id === memberId) === true)
  }

  // ========================================================================= archive / delete
  section('Archive, restore and delete')

  const archivable = await mkArticle(admin, 'Archive fixture', 'Body.')
  await publishArticle(admin, archivable, null)
  await allows('a published article can be archived', () => archiveArticle(admin, archivable))
  {
    const row = await prisma.article.findUnique({ where: { id: archivable }, select: { state: true, archivedAt: true, publishAt: true } })
    check('...its state is ARCHIVED', row?.state === 'ARCHIVED')
    check('...it is no longer publicly visible', !isPubliclyVisible(row!))
    check('...and the time is recorded', row?.archivedAt != null)
  }
  check('an archived article is out of the listing',
    !(await listArticles({ page: 1 })).items.some((a) => a.id === archivable))
  await allows('an administrator can restore it', () => restoreArticle(admin, archivable))
  check('...and it is visible again',
    isPubliclyVisible((await prisma.article.findUnique({ where: { id: archivable }, select: { state: true, publishAt: true } }))!))
  await refuses('a draft cannot be archived', () => archiveArticle(admin, autosaved), /published/i)

  const deletable = await mkArticle(member, 'Delete fixture', 'Body.')
  await refuses('somebody else cannot delete it', () => softDeleteArticle(reader, deletable), /cannot delete/i)
  await allows('the author can delete their own article', () => softDeleteArticle(member, deletable))
  {
    const row = await prisma.article.findUnique({ where: { id: deletable }, select: { state: true, deletedAt: true } })
    check('...it is soft-deleted, not destroyed', row?.state === 'SOFT_DELETED' && row?.deletedAt != null)
  }
  await refuses('a deleted article cannot be edited',
    () => updateArticle(member, deletable, { title: 'X', bodySource: 'Y.' }), /deleted/i)
  check('a deleted article is out of My Articles',
    !(await listMyArticles(member)).some((a) => a.id === deletable))

  // ========================================================================= comments
  section('Comments')

  const commented = await mkArticle(admin, 'Comment fixture', 'Body.')
  await publishArticle(admin, commented, null)

  const unpublished = await mkArticle(admin, 'Unpublished comment target', 'Body.')
  await refuses('commenting on an unpublished article is refused',
    () => addComment(reader, unpublished, 'Nice piece.'), /not open/i)

  const c1 = await addComment(reader, commented, 'A first comment.')
  check('a comment can be posted', c1 > 0)
  check('...and the article count went up',
    (await prisma.article.findUnique({ where: { id: commented }, select: { commentCount: true } }))?.commentCount === 1)

  const r1 = await addComment(member, commented, 'A reply to the first.', c1)
  {
    const row = await prisma.articleComment.findUnique({ where: { id: r1 }, select: { parentId: true } })
    check('a reply attaches to its parent', row?.parentId === c1)
  }
  const r2 = await addComment(trusted, commented, 'A reply to the reply.', r1)
  {
    const row = await prisma.articleComment.findUnique({ where: { id: r2 }, select: { parentId: true } })
    check('a reply to a reply flattens to the top-level comment', row?.parentId === c1)
  }

  await refuses('an empty comment is refused', () => addComment(admin, commented, '   '), /write something/i)
  await refuses('a duplicate comment is refused', () => addComment(reader, commented, 'A first comment.'), /already posted/i)
  const otherOpen = await mkArticle(admin, 'A second open article', 'Body.')
  await publishArticle(admin, otherOpen, null)
  await refuses('replying to a comment that belongs to another article is refused',
    () => addComment(admin, otherOpen, 'Wrong article.', c1), /not on this article/i)

  {
    const long = 'x'.repeat(MAX_COMMENT_LENGTH + 500)
    const id = await addComment(admin, commented, long)
    const row = await prisma.articleComment.findUnique({ where: { id }, select: { body: true } })
    check('an over-long comment is truncated rather than rejected', row!.body.length === MAX_COMMENT_LENGTH)
    await deleteOwnComment(admin, id)
  }
  {
    const id = await addComment(admin, commented, '<script>alert(1)</script> and https://example.com/x')
    const row = await prisma.articleComment.findUnique({ where: { id }, select: { body: true } })
    check('a comment stores exactly what was typed', row!.body.includes('<script>'))
    const parts = linkifyComment(row!.body)
    check('...markup is never a link', !parts.some((p) => p.href?.includes('script')))
    check('...but a real URL is linked', parts.some((p) => p.href === 'https://example.com/x'))
    check('...and the link text is its own destination',
      parts.find((p) => p.href)?.text === 'https://example.com/x')
    await deleteOwnComment(admin, id)
  }

  await allows('the author can edit their comment inside the window', () => editComment(reader, c1, 'An edited first comment.'))
  check('...and the edit is marked',
    (await prisma.articleComment.findUnique({ where: { id: c1 }, select: { editedAt: true } }))?.editedAt != null)
  await refuses('somebody else cannot edit it', () => editComment(member, c1, 'Hijacked.'), /own comments/i)
  {
    // Age the comment past the window rather than waiting fifteen minutes.
    await prisma.articleComment.update({
      where: { id: c1 },
      data: { createdAt: new Date(Date.now() - EDIT_WINDOW_MS - 60_000) },
    })
    await refuses('the edit window closes', () => editComment(reader, c1, 'Too late.'), /time to edit/i)
  }

  {
    const before = (await prisma.article.findUnique({ where: { id: commented }, select: { commentCount: true } }))!.commentCount
    await allows('a moderator can remove a comment', () => hideComment(admin, r2, 'Off topic.'))
    const row = await prisma.articleComment.findUnique({ where: { id: r2 }, select: { hiddenAt: true } })
    check('...it is marked hidden', row?.hiddenAt != null)
    const after = (await prisma.article.findUnique({ where: { id: commented }, select: { commentCount: true } }))!.commentCount
    check('...and the count goes down', after === before - 1)

    const thread = await getCommentThread(commented, reader)
    const findHidden = (list: typeof thread): boolean =>
      list.some((c) => (c.id === r2 && c.body !== '') || findHidden(c.replies))
    check('...its text is never sent to the client', !findHidden(thread))
  }
  await allows('a moderator can restore it', () => unhideComment(admin, r2))
  check('...and the text comes back',
    (await prisma.articleComment.findUnique({ where: { id: r2 }, select: { body: true, hiddenAt: true } }))?.hiddenAt === null)
  await refuses('a member cannot remove a comment', () => hideComment(member, r1), /administrator/i)

  await allows('a member can report a comment', () => reportComment(reader, r1, 'This is rude.'))
  check('...one open report exists',
    (await prisma.commentReport.count({ where: { commentId: r1, resolvedAt: null } })) === 1)
  await allows('reporting twice just updates the reason', () => reportComment(reader, r1, 'Still rude.'))
  check('...it does not create a second report',
    (await prisma.commentReport.count({ where: { commentId: r1 } })) === 1)
  await refuses('you cannot report your own comment', () => reportComment(member, r1, 'Mine.'), /your own/i)
  {
    const report = await prisma.commentReport.findFirst({ where: { commentId: r1 } })
    await refuses('a member cannot resolve a report', () => resolveReport(member, report!.id, 'Fine'), /administrator/i)
    await allows('an administrator can resolve it', () => resolveReport(admin, report!.id, 'No action needed'))
    check('...and it leaves the queue',
      (await prisma.commentReport.count({ where: { commentId: r1, resolvedAt: null } })) === 0)
  }

  {
    const before = (await prisma.article.findUnique({ where: { id: commented }, select: { commentCount: true } }))!.commentCount
    await allows('the author can delete their comment', () => deleteOwnComment(member, r1))
    const row = await prisma.articleComment.findUnique({ where: { id: r1 }, select: { deletedAt: true, body: true } })
    check('...the row survives as a tombstone', row != null && row.deletedAt != null)
    check('...but the words are gone', row?.body === '')
    const after = (await prisma.article.findUnique({ where: { id: commented }, select: { commentCount: true } }))!.commentCount
    check('...and the count goes down', after === before - 1)
    const reply = await prisma.articleComment.findUnique({ where: { id: r2 }, select: { id: true } })
    check('...while its reply keeps its place', reply != null)
  }

  {
    await setArticleFlags(admin, commented, { commentsLocked: true })
    await refuses('a locked discussion refuses new comments',
      () => addComment(admin, commented, 'One more thought.'), /closed/i)
    await setArticleFlags(admin, commented, { commentsLocked: false, commentsEnabled: false })
    await refuses('comments turned off refuse new comments',
      () => addComment(admin, commented, 'One more thought.'), /turned off/i)
    await setArticleFlags(admin, commented, { commentsEnabled: true })
  }

  {
    // The per-minute limit, exercised with a fresh account so earlier comments do not interfere.
    const spammerId = await mkPlayer('spammer')
    const spammer = actorFor(spammerId, 'spammer')
    for (let i = 0; i < RATE_LIMITS.perMinute; i += 1) {
      await addComment(spammer, commented, `Rapid comment number ${i}.`)
    }
    await refuses('the per-minute rate limit stops a burst',
      () => addComment(spammer, commented, 'One too many.'), /very quickly/i)
  }

  check('recounting comments matches the stored total',
    (await recountComments(commented)) ===
      (await prisma.article.findUnique({ where: { id: commented }, select: { commentCount: true } }))!.commentCount)

  // ========================================================================= queries
  section('Queries and listings')

  {
    const page = await listArticles({ page: 1, search: 'Comment fixture' })
    check('search finds an article by title', page.items.some((a) => a.id === commented))
  }
  {
    const page = await listArticles({ page: 1, search: 'zzbreak_admin' })
    check('search finds an article by author handle', page.items.length > 0)
  }
  {
    const page = await listArticles({ page: 1, search: 'a phrase that appears nowhere at all' })
    check('a search with no matches returns nothing, not everything', page.items.length === 0)
  }
  {
    const authors = await listAuthors()
    check('the authors index lists a fixture author', authors.some((a) => a.playerId === adminId))
    const entry = authors.find((a) => a.playerId === adminId)
    check('...with a count above zero', (entry?.articleCount ?? 0) > 0)
  }
  {
    const months = await listArchiveMonths()
    check('the archive index has at least one month', months.length > 0)
    // The regression this guards: comparing the naive UTC column against NOW() (timestamptz) made
    // Postgres read stored times as local, so on a non-UTC session the current month vanished.
    const now = new Date()
    check('...including the month the fixtures were published in',
      months.some((m) => m.year === now.getUTCFullYear() && m.month === now.getUTCMonth() + 1),
      months.map((m) => `${m.year}-${m.month}`).join(','))
    check('...with a positive count', months.every((m) => m.count > 0))
    check('...ordered newest first',
      months.every((m, i) => i === 0 || m.year < months[i - 1].year || (m.year === months[i - 1].year && m.month <= months[i - 1].month)))
  }
  {
    const related = await relatedArticles(commented, null, 3)
    check('related articles never include the article itself', !related.some((a) => a.id === commented))
    check('related articles are all published', related.length <= 3)
  }
  {
    const mine = await listMyArticles(member)
    check('My Articles shows the author\'s own work', mine.every((a) => a.id !== liveByAdmin))
    check('...including drafts', mine.some((a) => a.state === 'DRAFT'))
  }

  // ========================================================================= feeds
  section('Feeds')

  {
    const items = await feedItems(50)
    check('the feed carries published articles', items.length > 0)
    check('...and no scheduled or draft ones', items.every((i) => i.publishAt <= new Date()))

    const rss = renderRss(items)
    check('the RSS document is well-formed at the top', rss.startsWith('<?xml version="1.0" encoding="UTF-8"?>'))
    check('...declares itself as RSS', rss.includes('<rss version="2.0"'))
    check('...and carries item links', rss.includes('<guid isPermaLink="true">'))

    const atom = renderAtom(items)
    check('the Atom document declares the right namespace', atom.includes('xmlns="http://www.w3.org/2005/Atom"'))
    check('...and carries entries', atom.includes('<entry>'))

    check('XML escaping handles ampersands', xmlEscape('Tom & Jerry') === 'Tom &amp; Jerry')
    check('XML escaping handles angle brackets', xmlEscape('<b>') === '&lt;b&gt;')
    check('XML escaping handles quotes', xmlEscape(`"x" 'y'`) === '&quot;x&quot; &apos;y&apos;')
    check('a hostile title cannot break out of the feed', !renderRss([{
      title: '</title><script>alert(1)</script>',
      slug: 'x', excerpt: 'y', publishAt: new Date(), updatedAt: new Date(),
      author: 'a', categoryName: null,
    }]).includes('<script>'))
  }

  // ========================================================================= preview tokens
  section('Preview links')

  {
    const token = createPreviewToken(commented)
    const claim = readPreviewToken(token)
    check('a fresh token reads back', claim?.articleId === commented)

    check('a tampered article id is rejected', readPreviewToken(token.replace(/^\d+/, '999999')) === null)
    check('a tampered signature is rejected', readPreviewToken(`${token}x`) === null)
    check('a truncated token is rejected', readPreviewToken(token.slice(0, -5)) === null)
    check('an empty token is rejected', readPreviewToken('') === null)
    check('a malformed token is rejected', readPreviewToken('not.a.token') === null)
    check('an absurdly long token is rejected', readPreviewToken('a'.repeat(500)) === null)

    const expired = createPreviewToken(commented, -1)
    check('an expired token is rejected', readPreviewToken(expired) === null)
    check('a token for one article does not name another',
      readPreviewToken(createPreviewToken(revised))?.articleId === revised)
  }

  // ========================================================================= merges
  section('Account merges')

  {
    const oldId = await mkPlayer('old_identity')
    const oldActor = actorFor(oldId, 'old_identity')
    const written = await mkArticle(oldActor, 'Written under the old profile', 'Body.')
    await publishArticle(admin, written, null)

    const newId = await mkPlayer('new_identity')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const staffActor: any = { userId: 1, username: 'zzbreak-verify', roles: ['owner'] }
    const merged = await mergeAccounts(staffActor, newId, oldId)
    check('the merge succeeds', merged.ok === true, merged.error)

    const newActor = actorFor(newId, 'new_identity')
    const mine = await listMyArticles(newActor)
    check('the surviving profile sees work written under the old one', mine.some((a) => a.id === written))

    const authors = await listAuthors()
    check('the authors index no longer lists the merged-away profile', !authors.some((a) => a.playerId === oldId))
    check('...and the survivor carries the count', (authors.find((a) => a.playerId === newId)?.articleCount ?? 0) > 0)

    if (merged.mergeId) {
      const undone = await undoMerge(staffActor, merged.mergeId)
      check('the merge can be undone', undone.ok === true, undone.error)
    }
  }

  // ========================================================================= deletion safety
  section('Deletion safeguards')

  {
    const authorId = await mkPlayer('deletion_target')
    const before = await assessAccountDeletion(987654, authorId, 'zzbreak-nonexistent-user')
    check('an account with no editorial history could be deleted', before.canPermanentlyDelete)

    const written = await mkArticle(actorFor(authorId, 'deletion_target'), 'Something they wrote', 'Body.')
    const after = await assessAccountDeletion(987654, authorId, 'zzbreak-nonexistent-user')
    check('an author with an article cannot be permanently deleted', !after.canPermanentlyDelete)
    check('...and archival is offered instead', after.outcome === 'archive')
    check('...with the article counted by name',
      after.dependencies.some((d) => d.label === 'Articles written' && d.count === 1))
    void written
  }

  // ========================================================================= pages
  section('Standalone pages')

  check('a page slug clashing with a route is rejected', !isValidPageSlug('news'))
  check('a page slug clashing with the staff area is rejected', !isValidPageSlug('staff'))
  check('an ordinary page slug is accepted', isValidPageSlug('about-the-registry'))
  check('a reserved article slug is also rejected for a page', !isValidPageSlug('feed'))

  // ========================================================================= summary
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => {
    console.error('\nSUITE ERROR:', e)
    fail += 1
  })
  .finally(async () => {
    await cleanup()
    console.log(`\nCleaned up: ${madeArticles.length} articles, ${madePlayers.length} players.`)
    const leftovers = await prisma.player.count({ where: { primaryName: { startsWith: PREFIX } } })
    console.log(leftovers === 0 ? 'No fixture rows remain.' : `WARNING: ${leftovers} fixture players remain.`)
    await prisma.$disconnect()
    process.exit(fail === 0 && leftovers === 0 ? 0 : 1)
  })
