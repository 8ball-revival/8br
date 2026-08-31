/**
 * Owner and Admin management of The Break, and the limits on it.
 *
 * The rules being protected here are the ones that are cheap to get wrong and expensive to discover:
 * that the button being hidden is not the permission, that an admin editing a post does not become
 * its author, and that a withdrawn post leaves every surface rather than most of them.
 *
 * The permission predicates are pure functions that import nothing, so they are exercised directly.
 * The service and route behaviour is exercised against the real database, on a fixture that is
 * created and removed inside this run.
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  canManageTheBreak, canManagePost, manageBasis, ownsContent, MANAGE_THE_BREAK,
  type BreakActorShape,
} from '../src/lib/break/permission-rules.ts'
import { updatePost, softDeletePost, getPostBySlug } from '../src/lib/break/posts.ts'
import {
  parseArticleBody, serializeArticleBody, sanitizeDocument, documentToPlainText,
  readingTimeMinutes, deriveExcerpt, type RichDocument,
} from '../src/lib/editorial/richtext.ts'
/* The same derivation the service uses. A hand-written slugKey looks fine and then never matches. */
import { slugKeyOf } from '../src/lib/editorial/slug-format.ts'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (s: string) => console.log(`\n--- ${s} ---`)

const OWNER: BreakActorShape = { playerId: 'p-owner', name: 'Owner', handle: 'cv_owner', isAdmin: true, isOwner: true, isTrustedAuthor: false }
const ADMIN: BreakActorShape = { playerId: 'p-admin', name: 'Admin', handle: 'cv_admin', isAdmin: true, isOwner: false, isTrustedAuthor: false }
const AUTHOR: BreakActorShape = { playerId: 'p-author', name: 'Author', handle: 'cv_author', isAdmin: false, isOwner: false, isTrustedAuthor: true }
const MEMBER: BreakActorShape = { playerId: 'p-member', name: 'Member', handle: 'cv_member', isAdmin: false, isOwner: false, isTrustedAuthor: false }

// ── 1-4, 12. The capability itself ───────────────────────────────────────────────────────────────
section('Who holds manage_the_break')
{
  check('the capability has a name worth logging', MANAGE_THE_BREAK === 'manage_the_break')
  check('the Owner holds it', canManageTheBreak(OWNER))
  check('an Admin holds it', canManageTheBreak(ADMIN))
  check('a trusted author does not', !canManageTheBreak(AUTHOR))
  check('an ordinary member does not', !canManageTheBreak(MEMBER))
  check('a signed-out visitor does not', !canManageTheBreak(null))
}

section('What it lets them do, and to whose post')
{
  check('the Owner may manage anyone’s post', canManagePost(OWNER, 'p-author'))
  check('an Admin may manage anyone’s post', canManagePost(ADMIN, 'p-author'))
  check('an author keeps their own post', canManagePost(AUTHOR, 'p-author'))
  check('a member may NOT touch someone else’s', !canManagePost(MEMBER, 'p-author'))
  check('a signed-out visitor may not', !canManagePost(null, 'p-author'))

  // The basis is what the audit trail needs to tell the two apart.
  check('an author edit is recorded as authorship', manageBasis(AUTHOR, 'p-author') === 'author')
  check('an admin edit is recorded as a capability', manageBasis(ADMIN, 'p-author') === 'capability')
  check('an Owner editing their OWN post is still authorship', manageBasis(OWNER, 'p-owner') === 'author')
  check('a member gets no basis at all', manageBasis(MEMBER, 'p-author') === null)

  // Suspension is handled upstream: a suspended account never resolves to an actor at all.
  check('a null actor owns nothing', !ownsContent(null, 'p-author'))
}

// ── 5. Forged requests ───────────────────────────────────────────────────────────────────────────
section('The server does not trust the client')
{
  const actions = readFileSync('src/lib/break/post-actions.ts', 'utf8')
  check('the actions are server actions', actions.startsWith("'use server'"))
  check('the actor is resolved from the session, never from an argument',
    /currentBreakActor\(\)/.test(actions) && !/actor: BreakActor/.test(actions))
  check('every write re-checks the capability', (actions.match(/manageBasis\(actor/g) ?? []).length >= 2)
  check('the management list applies the capability too', /canManageTheBreak\(actor\)/.test(actions))

  const posts = readFileSync('src/lib/break/posts.ts', 'utf8')
  check('the service checks again inside its own transaction',
    (posts.match(/\$transaction[\s\S]{0,600}?manageBasis\(actor/g) ?? []).length >= 2)
}

// ── 6. Attribution ───────────────────────────────────────────────────────────────────────────────
section('Editing is not authorship')
{
  const posts = readFileSync('src/lib/break/posts.ts', 'utf8')
  const actions = readFileSync('src/lib/break/post-actions.ts', 'utf8')
  const editor = readFileSync('src/components/break/post-editor.tsx', 'utf8')

  /*
   * Everything updatePost writes goes into one `data` object, so the invariant is precise: no author
   * field is ever assigned into it. Reading the existing author -- to decide permission, and to name
   * them in the audit -- is not writing one, and a looser grep fails on exactly those legitimate
   * reads, as well as on createDraft, where setting an author IS what creating a post means.
   */
  const updateBody = posts.slice(posts.indexOf('export async function updatePost'), posts.indexOf('export async function publishPost'))
  check('the update service never assigns an author', !/data\.author/i.test(updateBody))
  check('and createDraft is where an author is actually set', /authorPlayerId: actor\.playerId/.test(posts))
  check('the action strips an author if one is ever submitted', /delete safe\.authorPlayerId/.test(actions))
  check('the editor offers no author field', !/authorPlayerId|setAuthor/.test(editor))
  check('the edit page says attribution will not change',
    /Attribution does not change/.test(readFileSync('src/app/(frontend)/the-break/[slug]/edit/page.tsx', 'utf8')))
}

// ── 11. Auditing ─────────────────────────────────────────────────────────────────────────────────
section('Every management action is recorded')
{
  const audit = readFileSync('src/lib/break/audit.ts', 'utf8')
  const posts = readFileSync('src/lib/break/posts.ts', 'utf8')
  check('an edit writes an audit entry', /recordBreakAudit\(actor, \{[\s\S]{0,80}break\.post\.update/.test(posts))
  check('a delete writes one', /break\.post\.delete/.test(posts))
  check('the entry names the acting account', /actingPlayerId/.test(audit) && /actingHandle/.test(audit))
  check('and the original author, separately', /authorPlayerId: entry\.authorPlayerId/.test(audit))
  check('and which capability was used', /capability: entry\.basis === 'capability'/.test(audit))
  check('it stores field NAMES, not field contents', /changedFields: entry\.changed/.test(audit) && !/bodyText: /.test(audit))
  check('the audit is written in the same transaction as the change', /recordBreakAudit\([\s\S]{0,400}?, tx\)/.test(posts))
}

// ── 12-13. The controls, and the page around them ────────────────────────────────────────────────
section('The public page is otherwise identical')
{
  /*
   * The post page's body moved into a component when the site was rebuilt on the Site Builder.
   *
   * The route file is now a thin wrapper, so reading it for the manage gate found nothing and
   * reported that the menu was drawn unconditionally — the opposite of the truth. The gate is the
   * same expression it always was; it just lives with the markup it guards.
   */
  const page = readFileSync('src/components/system/article-detail-body.tsx', 'utf8')
  check('the menu is drawn only when the viewer may manage the post',
    /manageBasis\(actor, post\.authorPlayerId\) && \(/.test(page))
  check('it is a compact menu, not an admin banner',
    !/admin-bar|manage in|Admin Mode/i.test(page))

  const menu = readFileSync('src/components/break/post-manage-menu.tsx', 'utf8')
  check('it offers exactly Edit Post and Delete Post', /Edit Post/.test(menu) && /Delete Post/.test(menu))
  check('deleting asks first', /role="alertdialog"/.test(menu))
  check('the dialog names the post, its author and its replies',
    /\{title\}/.test(menu) && /\{authorLabel\}/.test(menu) && /\{commentCount\}/.test(menu))
  check('and says where it will disappear from',
    /disappear from The Break/.test(menu) && /search/.test(menu) && /homepage/.test(menu) && /profile/.test(menu))
  check('Cancel is offered beside it', /Cancel/.test(menu))
}

// ── 14. Identity ─────────────────────────────────────────────────────────────────────────────────
section('The CueVerse ID identifies the author')
{
  const table = readFileSync('src/components/break/manage-posts-table.tsx', 'utf8')
  check('the management list leads with the CueVerse ID', /\{p\.authorHandle \?\? '—'\}/.test(table))
  check('the preferred name is secondary, never a replacement',
    /authorName && <span className="block text-xs/.test(table))
  check('the ID column is present even when a name exists', /authorHandle/.test(table))
}

// ── 8-10. Against the real database ──────────────────────────────────────────────────────────────
section('A withdrawn post leaves every surface')
const created: number[] = []
try {
  /*
   * Two DIFFERENT people. The admin must not be the author, or every check below silently proves
   * the author path instead of the capability path — which is exactly what it did the first time.
   */
  const people = await prisma.player.findMany({
    where: { cueverseIdNormalized: { not: null } }, take: 2, select: { id: true, cueverseId: true },
  })
  const author = people[0]
  const staff = people[1]
  if (!author || !staff) {
    console.log('  – need two Players to separate author from admin; database checks skipped')
  } else {
    const admin: BreakActorShape = { ...ADMIN, playerId: staff.id }
    check('the fixture author and the acting admin are different people', author.id !== staff.id)
    const stamp = Date.now()

    const fixture = await prisma.breakPost.create({
      data: {
        type: 'TEXT', title: `fixture post ${stamp}`, slug: `fixture-post-${stamp}`, slugKey: slugKeyOf(`fixture-post-${stamp}`),
        state: 'PUBLISHED', publishedAt: new Date(), authorPlayerId: author.id,
        authorNameSnapshot: 'Fixture Author', authorHandleSnapshot: author.cueverseId ?? 'fixture',
        body: {}, bodyText: 'fixture body', score: 1, commentCount: 0,
      },
      select: { id: true, slug: true },
    })
    created.push(fixture.id)

    const bystander = await prisma.breakPost.create({
      data: {
        type: 'TEXT', title: `bystander ${stamp}`, slug: `bystander-${stamp}`, slugKey: slugKeyOf(`bystander-${stamp}`),
        state: 'PUBLISHED', publishedAt: new Date(), authorPlayerId: author.id,
        authorNameSnapshot: 'Fixture Author', authorHandleSnapshot: author.cueverseId ?? 'fixture',
        body: {}, bodyText: 'untouched', score: 3, commentCount: 0,
      },
      select: { id: true, title: true, score: true, state: true },
    })
    created.push(bystander.id)

    // An ordinary member cannot edit it, whatever they send.
    const stranger: BreakActorShape = { ...MEMBER, playerId: 'someone-else-entirely' }
    const refused = await updatePost(stranger, fixture.id, { title: 'hijacked' })
    check('a member’s edit of another author’s post is refused', !refused.ok, refused.error)
    const stillNamed = await prisma.breakPost.findUnique({ where: { id: fixture.id }, select: { title: true } })
    check('and the title is untouched', stillNamed?.title === `fixture post ${stamp}`)

    // An admin may edit it, and does not become its author.
    const edited = await updatePost(admin, fixture.id, { title: `fixture post ${stamp} (edited)` })
    check('an admin may edit any post', edited.ok, edited.error)
    const after = await prisma.breakPost.findUnique({
      where: { id: fixture.id }, select: { title: true, authorPlayerId: true, editedAt: true, score: true, commentCount: true },
    })
    check('the title changed', after?.title === `fixture post ${stamp} (edited)`)
    check('the author did NOT change', after?.authorPlayerId === author.id)
    check('the edit is marked', after?.editedAt != null)
    check('votes and replies survived the edit', after?.score === 1 && after?.commentCount === 0)

    // An edit that changes nothing writes nothing.
    const noop = await updatePost(admin, fixture.id, { title: `fixture post ${stamp} (edited)` })
    check('re-saving an unchanged post is accepted', noop.ok)

    // The audit entry.
    const entry = await prisma.auditLog.findFirst({
      where: { entity: 'BreakPost', entityId: String(fixture.id), action: 'break.post.update' },
      orderBy: { id: 'desc' },
      select: { newValue: true, oldValue: true, actorUsername: true },
    })
    check('the edit was audited', entry != null)
    const nv = (entry?.newValue ?? {}) as Record<string, unknown>
    const ov = (entry?.oldValue ?? {}) as Record<string, unknown>
    check('the entry names the capability used', nv.capability === 'manage_the_break', String(nv.capability))
    check('the entry records the original author', ov.authorPlayerId === author.id)
    check('the entry lists the changed field', Array.isArray(nv.changedFields) && (nv.changedFields as string[]).includes('title'))

    // Delete, and check it is gone from everywhere.
    const del = await softDeletePost(admin, fixture.id)
    check('an admin may delete any post', del.ok, del.error)

    const row = await prisma.breakPost.findUnique({ where: { id: fixture.id }, select: { state: true, deletedAt: true } })
    check('the post is withdrawn, not destroyed', row != null && row.state === 'DELETED' && row.deletedAt != null)

    check('it cannot be opened by a signed-out visitor', (await getPostBySlug(fixture.slug, null)) === null)
    check('nor by an ordinary member', (await getPostBySlug(fixture.slug, stranger)) === null)
    check('but staff can still reach it to review or restore', (await getPostBySlug(fixture.slug, admin)) !== null)

    const inFeed = await prisma.breakPost.count({ where: { id: fixture.id, state: 'PUBLISHED', deletedAt: null } })
    check('it no longer matches the feed/search/homepage filter', inFeed === 0)

    const delEntry = await prisma.auditLog.findFirst({
      where: { entity: 'BreakPost', entityId: String(fixture.id), action: 'break.post.delete' },
      select: { newValue: true },
    })
    check('the delete was audited', delEntry != null)

    // Nothing else moved.
    const other = await prisma.breakPost.findUnique({ where: { id: bystander.id }, select: { title: true, score: true, state: true } })
    check('an unrelated post is untouched',
      other?.title === bystander.title && other?.score === bystander.score && other?.state === bystander.state)
  }
} finally {
  // The fixture leaves nothing behind, including its audit rows.
  if (created.length) {
    await prisma.auditLog.deleteMany({ where: { entity: 'BreakPost', entityId: { in: created.map(String) } } })
    await prisma.breakPost.deleteMany({ where: { id: { in: created } } })
    console.log(`  – cleaned up ${created.length} fixture post(s) and their audit rows`)
  }
}

// -- Editing the body -----------------------------------------------------------------------------
section('The body is editable, and survives the round trip')
{
  const editor = readFileSync('src/components/break/post-editor.tsx', 'utf8')
  check('the editor uses the canonical composer', editor.includes('@/components/editorial/body-editor'))
  check('and not a second one built for admins', !editor.includes('<textarea'))
  check('the body is hydrated from the stored tree, not from bodyText',
    readFileSync('src/app/(frontend)/the-break/[slug]/edit/page.tsx', 'utf8').includes('serializeArticleBody(sanitizeDocument'))
  check('it submits a node tree, not a string', editor.includes('input.body = parseArticleBody(body)'))
  check('leaving with unsaved work warns first',
    editor.includes('beforeunload') && editor.includes('Discard your unsaved changes'))
  check('the upload pipeline comes with it', editor.includes('giphyEnabled'))

  /*
   * The round trip is what this rests on: the composer edits a serialised form, so a document that
   * did not survive serialise-then-parse would lose formatting the moment somebody opened it.
   */
  const rich: RichDocument = {
    v: 1,
    blocks: [
      { t: 'h', level: 2, c: [{ t: 'text', v: 'A heading' }] },
      { t: 'p', c: [
        { t: 'text', v: 'Plain, ' },
        { t: 'strong', c: [{ t: 'text', v: 'bold' }] },
        { t: 'text', v: ', ' },
        { t: 'em', c: [{ t: 'text', v: 'italic' }] },
        { t: 'text', v: ', ' },
        { t: 'link', href: 'https://example.com/x', c: [{ t: 'text', v: 'a link' }] },
        { t: 'br' },
        { t: 'text', v: 'after a break' },
      ] },
      { t: 'ul', items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two' }]] },
      { t: 'ol', items: [[{ t: 'text', v: 'seventh' }]], start: 7 },
      { t: 'quote', c: [{ t: 'text', v: 'Quoted.' }] },
      { t: 'code', lang: 'ts', v: 'const a = 1' },
      { t: 'hr' },
      { t: 'img', mediaId: 'media-123', alt: 'a picture', caption: 'with a caption' },
    ],
  }
  const canonical = sanitizeDocument(rich)
  const roundTripped = sanitizeDocument(parseArticleBody(serializeArticleBody(canonical)))
  check('every supported node survives an open-and-save with no changes',
    JSON.stringify(canonical) === JSON.stringify(roundTripped))

  const kinds = (d: RichDocument) => d.blocks.map((b) => b.t).join(',')
  check('and every block kind is still there', kinds(canonical) === kinds(roundTripped), kinds(roundTripped))
  const ol = roundTripped.blocks.find((b) => b.t === 'ol') as { t: 'ol'; start?: number } | undefined
  check('the ordered-list start is intact', ol?.start === 7, String(ol?.start))
  const img = roundTripped.blocks.find((b) => b.t === 'img') as unknown as { mediaId: string; caption: string | null } | undefined
  check('the media reference is intact', img?.mediaId === 'media-123' && img?.caption === 'with a caption')

  // Anything outside the vocabulary is dropped rather than carried into the database.
  const hostile = sanitizeDocument({
    v: 1,
    blocks: [
      { t: 'script', v: 'alert(1)' },
      { t: 'p', c: [{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'tap' }] }] },
      { t: 'p', c: [{ t: 'text', v: 'kept' }] },
    ] as never,
  })
  check('an unsupported block is dropped', !JSON.stringify(hostile).includes('script'))
  check('a javascript: href does not survive', !JSON.stringify(hostile).includes('javascript:'))
  check('the legitimate paragraph is kept', JSON.stringify(hostile).includes('kept'))
}

section('Derived fields follow the body')
{
  const shortDoc: RichDocument = { v: 1, blocks: [{ t: 'p', c: [{ t: 'text', v: 'short' }] }] }
  const longDoc: RichDocument = { v: 1, blocks: [{ t: 'p', c: [{ t: 'text', v: 'word '.repeat(800) }] }] }
  check('plain text follows the body', documentToPlainText(longDoc).length > documentToPlainText(shortDoc).length)
  check('the excerpt follows the body', deriveExcerpt(longDoc) !== deriveExcerpt(shortDoc))
  check('reading time follows the body', readingTimeMinutes(longDoc) > readingTimeMinutes(shortDoc))

  const svc = readFileSync('src/lib/break/posts.ts', 'utf8')
  check('saving a body rewrites bodyText', svc.includes('data.bodyText = documentToPlainText(body)'))
  /*
   * The comparison has to be about the document, not about how it was serialised. Postgres stores
   * jsonb with its own key order and a freshly sanitised document carries insertion order, so a
   * plain JSON.stringify on the two forms of the SAME body disagreed -- and every unchanged save
   * rewrote bodyText, moved updatedAt, marked the post edited and filed an audit entry for an edit
   * nobody had made.
   */
  check('an unchanged body writes nothing', svc.includes('canonicalJson(existing?.body) !== canonicalJson(body)'))
  check('and the comparison ignores key order', svc.includes('function canonicalJson'))
  check('while keeping array order, because in a document order is meaning',
    svc.includes('if (Array.isArray(x)) return x.map(walk)'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
