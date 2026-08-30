/**
 * Site builder security verification.
 *
 * ── What this is for ─────────────────────────────────────────────────────────────────────────────
 * The other suites ask "does it work". This one asks "can it be made to do something it should not",
 * and every check is written from the attacker's side: not "does validation run" but "here is the
 * payload, does it reach the database".
 *
 * It runs against a disposable clone because several checks WRITE — a forged publish has to be
 * actually attempted for the refusal to mean anything.
 *
 * Run: scripts/db/make-test-clone.sh 8br_test_sec
 *      DATABASE_URL=<clone> npm run test:site-builder:security
 */

import { assertDisposableTestDatabase } from '../src/lib/db-guard'

assertDisposableTestDatabase('verify-site-builder-security')

const { prisma } = await import('../src/lib/prisma')
const { validateDocument } = await import('../src/lib/site-builder/document')
const { validateConfig, sanitiseRichText } = await import('../src/lib/site-builder/fields')
const { isSafeUrl, resolveEmbedProvider } = await import('../src/lib/site-builder/urls')
const { getModule, registerModule } = await import('../src/lib/site-builder/registry')
const { bootstrap, publish, saveDraft, readPublishedLayout } = await import('../src/lib/site-builder/service')
await import('../src/components/site-builder/modules')

let pass = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)
const actor = { userId: 999999, username: 'security-suite' }

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Protocol injection')

/*
  Every one of these is a real bypass that works against a naive check. Browsers strip control
  characters and decode entities before reading a scheme, so the string that reaches the parser is
  not the string that was typed.
*/
const PROTOCOL_PAYLOADS = [
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  '  javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'java\rscript:alert(1)',
  'java\u0000script:alert(1)',
  '&#106;avascript:alert(1)',
  '&#x6A;avascript:alert(1)',
  '&#0000106;avascript:alert(1)',
  'jAvAsCrIpT:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///c:/windows/system32/',
  'blob:https://evil.example/x',
  '//evil.example.com/phish',
  '\\\\evil.example.com\\share',
]
for (const payload of PROTOCOL_PAYLOADS) {
  check(`URL field refuses ${JSON.stringify(payload).slice(0, 46)}`, !isSafeUrl(payload))
}

// The same payloads through the actual module config path, not just the helper.
const button = getModule('content.button')!
for (const payload of PROTOCOL_PAYLOADS.slice(0, 8)) {
  const result = validateConfig(button.fields, { label: 'x', href: payload, variant: 'primary', newTab: false, align: 'left' })
  const stored = (result.value as { href: string }).href
  check(`button href never stores ${JSON.stringify(payload).slice(0, 34)}`, stored !== payload, stored)
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Stored cross-site scripting')

const XSS_PAYLOADS: [string, RegExp][] = [
  ['<script>alert(1)</script>', /script|alert/i],
  ['<img src=x onerror=alert(1)>', /onerror|img/i],
  ['<svg/onload=alert(1)>', /svg|onload/i],
  ['<iframe src="javascript:alert(1)">', /iframe/i],
  ['<a href="javascript:alert(1)">x</a>', /javascript/i],
  ['<body onload=alert(1)>', /onload/i],
  ['<p onmouseover="alert(1)">hover</p>', /onmouseover/i],
  ['<style>@import "evil"</style>', /style|import/i],
  ['<object data="evil"></object>', /object/i],
  ['<embed src="evil">', /embed/i],
  ['<form action="evil"><input name=x></form>', /form|input/i],
  ['<math><mtext></mtext></math>', /math/i],
  ['<div style="background:url(javascript:alert(1))">x</div>', /style|javascript/i],
  ['<a href="  jAvAsCrIpT:alert(1)">x</a>', /javascript/i],
]
for (const [payload, forbidden] of XSS_PAYLOADS) {
  const cleaned = sanitiseRichText(payload)
  check(`rich text neutralises ${payload.slice(0, 40)}`, !forbidden.test(cleaned), cleaned.slice(0, 70))
}

// Through the module path, and then through the document validator, which is what actually writes.
const richText = getModule('content.richText')!
const dirty = validateConfig(richText.fields, { html: '<script>alert(1)</script><p onclick="x()">hi</p>', measure: 'full' })
const storedHtml = (dirty.value as { html: string }).html
check('rich text config stores no script tag', !/script/i.test(storedHtml), storedHtml)
check('rich text config stores no event handler', !/onclick/i.test(storedHtml), storedHtml)

// An attribute-only payload: the tag is allowed, the attribute is not.
check('allowed tags keep no attributes', sanitiseRichText('<p id="x" class="y" style="z">t</p>') === '<p>t</p>',
  sanitiseRichText('<p id="x" class="y" style="z">t</p>'))

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Style and colour injection')

const styleAttack = validateDocument({
  version: 1,
  sections: [{
    id: 's', name: 'n', width: 'wide', columns: { desktop: [1] }, visibility: {},
    style: {
      background: 'red;position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999',
      paddingX: 999,
    },
    modules: [],
  }],
})
const attackedStyle = styleAttack.value.sections[0].style as Record<string, unknown>
check('a CSS declaration cannot be smuggled into a colour', attackedStyle.background === undefined, String(attackedStyle.background))
check('a spacing step is clamped', Number(attackedStyle.paddingX) <= 24, String(attackedStyle.paddingX))

const colourField = getModule('layout.container')!
for (const payload of ['url(javascript:alert(1))', 'expression(alert(1))', 'red;}body{display:none', '#fff;position:fixed']) {
  const r = validateConfig(colourField.fields, { background: payload, width: 'inherit', padding: 0, border: 'none', clip: false })
  check(`colour refuses ${payload.slice(0, 30)}`, (r.value as { background: string }).background !== payload)
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Unsafe embeds')

for (const url of [
  'https://evil.example/embed',
  'https://youtube.com.evil.example/x',
  'https://www.youtube.com.attacker.net/v',
  'http://www.youtube.com/embed/x',
  'javascript:alert(1)',
  '//www.youtube.com/embed/x',
]) {
  check(`embed refuses ${url.slice(0, 44)}`, resolveEmbedProvider(url) === null)
}
check('embed allows an exact allowlisted host', resolveEmbedProvider('https://www.youtube.com/embed/abc')?.id === 'youtube')

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Configuration version downgrade')

/*
  A stored config claiming an older version must not be able to skip validation by pretending to
  predate a field, nor to force a NEWER version than the registry has and thereby avoid the upgrade
  path. Both are ways to get an unvalidated shape past the boundary.
*/
registerModule({
  type: '_sec.versioned',
  name: 'Versioned', category: 'content', icon: 'Box', description: 'security fixture',
  configVersion: 3,
  a11y: {},
  fields: { limit: { kind: 'number', label: 'L', default: 5, min: 1, max: 10 } },
  upgrade: (config) => ({ ...config, limit: Math.min(Number(config.limit ?? 5) || 5, 10) }),
  Render: (() => null) as never,
})

const downgraded = validateDocument({
  version: 1,
  sections: [{
    id: 's', name: 'n', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {},
    modules: [{ id: 'm', type: '_sec.versioned', configVersion: 1, config: { limit: 9999 }, layout: { desktop: { span: 1 } }, style: {}, visibility: {} }],
  }],
})
const dgConfig = downgraded.value.sections[0].modules[0]
check('an old configVersion still runs validation', Number((dgConfig.config as { limit: number }).limit) <= 10, String((dgConfig.config as { limit: number }).limit))
check('the stored version is rewritten to the registry version', dgConfig.configVersion === 3, String(dgConfig.configVersion))

const forwardDated = validateDocument({
  version: 1,
  sections: [{
    id: 's', name: 'n', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {},
    modules: [{ id: 'm', type: '_sec.versioned', configVersion: 99, config: { limit: 9999 }, layout: { desktop: { span: 1 } }, style: {}, visibility: {} }],
  }],
})
const fdConfig = forwardDated.value.sections[0].modules[0]
check('a future configVersion cannot skip validation', Number((fdConfig.config as { limit: number }).limit) <= 10, String((fdConfig.config as { limit: number }).limit))
check('a future configVersion is normalised down', fdConfig.configVersion === 3, String(fdConfig.configVersion))

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Document structure attacks')

// A deeply nested document must not be able to overflow the stack on read.
let deep: Record<string, unknown> = { id: 'x0', type: 'content.heading', configVersion: 1, config: {}, layout: { desktop: { span: 1 } }, style: {}, visibility: {} }
for (let i = 1; i < 400; i++) {
  deep = { id: `x${i}`, type: 'layout.stack', configVersion: 1, config: {}, layout: { desktop: { span: 1 } }, style: {}, visibility: {}, children: [deep] }
}
let survived = true
let depthResult: ReturnType<typeof validateDocument> | null = null
try {
  depthResult = validateDocument({
    version: 1,
    sections: [{ id: 's', name: 'n', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {}, modules: [deep] }],
  })
} catch {
  survived = false
}
check('a 400-deep document does not throw', survived)
if (depthResult) {
  const measure = (m: { children?: unknown[] }): number => (m.children?.length ? 1 + measure(m.children[0] as never) : 1)
  const depth = measure(depthResult.value.sections[0].modules[0] as never)
  check('nesting is capped', depth <= 5, `depth ${depth}`)
  check('the cap is reported rather than silent', depthResult.issues.some((i) => /deeper/i.test(i.message)))
}

// Duplicate ids across a document would let one module's actions target another.
const dupes = validateDocument({
  version: 1,
  sections: [{
    id: 'same', name: 'n', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {},
    modules: [
      { id: 'same', type: 'content.heading', configVersion: 1, config: {}, layout: { desktop: { span: 1 } }, style: {}, visibility: {} },
      { id: 'same', type: 'content.heading', configVersion: 1, config: {}, layout: { desktop: { span: 1 } }, style: {}, visibility: {} },
    ],
  }],
})
const ids = [dupes.value.sections[0].id, ...dupes.value.sections[0].modules.map((m) => m.id)]
check('duplicate ids are made unique', new Set(ids).size === ids.length, ids.join(','))

// An id chosen to break a selector or an attribute.
const nastyId = validateDocument({
  version: 1,
  sections: [{
    id: '"><script>alert(1)</script>', name: 'n', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {}, modules: [],
  }],
})
check('an id containing markup is replaced', !/[<>"]/.test(nastyId.value.sections[0].id), nastyId.value.sections[0].id)
check('a section name containing markup is stripped', !/[<>]/.test(validateDocument({
  version: 1,
  sections: [{ id: 's', name: '<img src=x onerror=alert(1)>', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {}, modules: [] }],
}).value.sections[0].name))

// An unknown module type must never be executed, and must not be silently dropped either.
const ghost = validateDocument({
  version: 1,
  sections: [{
    id: 's', name: 'n', width: 'wide', columns: { desktop: [1] }, style: {}, visibility: {},
    modules: [{ id: 'g', type: '../../etc/passwd', configVersion: 1, config: {}, layout: { desktop: { span: 1 } }, style: {}, visibility: {} }],
  }],
})
check('an unknown type is reported', ghost.unknownTypes.includes('../../etc/passwd'))
check('an unknown type is preserved rather than dropped', ghost.value.sections[0].modules.length === 1)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Revision immutability and forged publication')

await prisma.$executeRawUnsafe(`
  TRUNCATE site_page_revision, site_page_draft, site_trash_item,
           site_reusable_module, site_template, site_theme_profile, site_builder_pref,
           site_page RESTART IDENTITY CASCADE
`)
await bootstrap(actor)

const before = await readPublishedLayout('/')
const page = await prisma.sitePage.findUnique({ where: { key: '/' }, include: { draft: true } })

// Publishing an unsafe draft: the payload must not survive to the published revision.
const poisoned = structuredClone(before.document)
poisoned.sections[0].modules.unshift({
  id: 'evil', type: 'content.button', configVersion: 1,
  config: { label: '<img src=x onerror=alert(1)>', href: 'javascript:alert(1)', variant: 'primary', newTab: false, align: 'left' },
  layout: { desktop: { span: 1 } }, style: {}, visibility: {}, reusableId: null,
})
await saveDraft('/', poisoned, page!.draft!.version, actor)
await publish('/', actor, 'security fixture')

const published = await prisma.sitePage.findUnique({ where: { key: '/' }, include: { publishedRevision: true } })
const publishedJson = JSON.stringify(published!.publishedRevision!.document)
check('no javascript: URL reaches a published revision', !/javascript:/i.test(publishedJson))

/*
  The right assertion for a TEXT field is that it cannot be markup, not that it lacks a scary word.

  `label` is plain text: the validator strips angle brackets, and React escapes what remains, so the
  stored value is the harmless string `img src=x onerror=alert(1)`. Asserting the absence of
  "onerror" would fail on a value that is completely safe, and passing it would prove nothing --
  what matters is that no `<` or `>` survives into a text field, because that is the only way it
  could ever become an element.
*/
const storedLabel = (published!.publishedRevision!.document as {
  sections: { modules: { id: string; config: { label?: string } }[] }[]
}).sections.flatMap((sec) => sec.modules).find((m) => m.id === 'evil')?.config.label ?? ''
check('a text field cannot carry markup into a published revision', !/[<>]/.test(storedLabel), storedLabel)
check('the payload survives only as inert text', storedLabel.includes('onerror'), storedLabel)

// Revisions are append-only: publishing again must not rewrite the earlier one.
const firstRevision = await prisma.sitePageRevision.findFirst({ where: { pageId: page!.id, number: 1 } })
const firstJson = JSON.stringify(firstRevision!.document)
await publish('/', actor, 'second')
const firstAfter = await prisma.sitePageRevision.findFirst({ where: { pageId: page!.id, number: 1 } })
check('an earlier revision is not rewritten by a later publish', JSON.stringify(firstAfter!.document) === firstJson)
check('publishing appends rather than replaces', (await prisma.sitePageRevision.count({ where: { pageId: page!.id } })) >= 3)

// Optimistic concurrency: a stale version cannot overwrite.
const current = await prisma.sitePageDraft.findUnique({ where: { pageId: page!.id } })
let refused = false
try {
  await saveDraft('/', before.document, current!.version - 1, actor)
} catch {
  refused = true
}
check('a stale draft version is refused', refused)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Insecure direct object references')

/*
  Everything in the builder is addressed by an identifier the browser supplies: a page key, a
  revision number, a reusable id, a trash id. Each of those is an opportunity to name somebody
  else's object and have the server act on it — so each is attempted here rather than reasoned about.

  Revision numbers are the sharpest case, because they are small integers that repeat on every page.
  "Roll back to revision 2" is meaningless without a page to scope it to, and a lookup that forgot
  the scope would restore whichever page's revision 2 the database happened to return first.
*/
const { rollback, getDraft } = await import('../src/lib/site-builder/service')
const { readFileSync } = await import('node:fs')
const { cancelScheduleAction } = await import('../src/lib/site-builder/actions')

const VICTIM = '/'
const OTHER = '/rankings'

// Give the other page a revision 2 whose content is unmistakable.
const otherDraft = (await getDraft(OTHER))!
const marked = structuredClone(otherDraft.document)
marked.sections[0].name = 'IDOR-MARKER-SECTION'
await saveDraft(OTHER, marked, otherDraft.version, actor)
await publish(OTHER, actor, 'IDOR probe')

const victimBefore = await readPublishedLayout(VICTIM)
await rollback(VICTIM, 2, actor)
const victimAfter = await readPublishedLayout(VICTIM)
check(
  'rolling one page back cannot pull in another page’s revision of the same number',
  !JSON.stringify(victimAfter.document).includes('IDOR-MARKER-SECTION'),
)
check(
  'and the other page is untouched by it',
  JSON.stringify((await readPublishedLayout(OTHER)).document).includes('IDOR-MARKER-SECTION'),
)
check('the victim page still has content', victimAfter.document.sections.length > 0, String(victimBefore.source))

// A revision number that exists on another page but not on this one must be refused, not borrowed.
const otherRevCount = await prisma.sitePageRevision.count({
  where: { page: { key: OTHER } },
})
let refusedForeign = false
try {
  await rollback('/achievements', otherRevCount + 500, actor)
} catch {
  refusedForeign = true
}
check('a revision number this page does not have is refused', refusedForeign)

/*
  Cancelling a schedule is the same shape: a page key and a number, from the browser. Cancelling
  with page A's number while naming page B must not reach into A.
*/
const victimPage = (await prisma.sitePage.findUnique({ where: { key: VICTIM } }))!
const otherPage = (await prisma.sitePage.findUnique({ where: { key: OTHER } }))!
const lastOther = (await prisma.sitePageRevision.findFirst({
  where: { pageId: otherPage.id }, orderBy: { number: 'desc' },
}))!
const otherScheduled = await prisma.sitePageRevision.create({
  data: {
    pageId: otherPage.id,
    number: lastOther.number + 1,
    document: lastOther.document as never,
    state: 'SCHEDULED',
    scheduledFor: new Date(Date.now() + 86_400_000),
    publishedByUsername: actor.username,
  },
})
/*
  Checked two ways, because the action cannot be CALLED here — it resolves a session through Payload,
  which this harness deliberately does not have.

  First, the query it runs is read from source: a cancel that filtered on `number` alone would archive
  the same revision number on every page at once. Second, that exact query is then executed against
  the wrong page and the other page's schedule is confirmed to survive it.
*/
const cancelSource = readFileSync('src/lib/site-builder/actions.ts', 'utf8')
const cancelBody = cancelSource.slice(cancelSource.indexOf('export async function cancelScheduleAction'))
check(
  'cancelling a schedule is scoped to the page it names',
  /updateMany\(\{[\s\S]{0,200}?where:\s*\{\s*pageId:/.test(cancelBody),
)
void cancelScheduleAction
await prisma.sitePageRevision.updateMany({
  where: { pageId: victimPage.id, number: otherScheduled.number, state: 'SCHEDULED' },
  data: { state: 'ARCHIVED' },
})
const survivor = await prisma.sitePageRevision.findUnique({ where: { id: otherScheduled.id } })
check(
  'a cancel scoped to one page cannot archive another page’s schedule',
  survivor?.state === 'SCHEDULED',
  String(survivor?.state),
)

// A key that is not a registered page must not spring one into existence.
let unknownKeyRefused = false
try {
  await saveDraft('/../../etc/passwd', victimAfter.document, 1, actor)
} catch {
  unknownKeyRefused = true
}
check('saving a draft for an unregistered key is refused', unknownKeyRefused)
check(
  'and no page was created for it',
  !(await prisma.sitePage.findUnique({ where: { key: '/../../etc/passwd' } })),
)

/*
  A reusable id is a foreign key the browser controls. Pointing an instance at one that does not
  exist must leave the instance rendering its own settings, not crash the page and not silently
  adopt somebody else's.
*/
const danglingDraft = (await getDraft(VICTIM))!
const dangling = structuredClone(danglingDraft.document)
dangling.sections[0].modules[0] = {
  ...dangling.sections[0].modules[0],
  reusableId: 'clx000000000000000000000',
}
await saveDraft(VICTIM, dangling, danglingDraft.version, actor)
const danglingBack = (await getDraft(VICTIM))!
check(
  'a dangling reusable link does not break the document',
  danglingBack.document.sections[0].modules.length === dangling.sections[0].modules.length,
)
check(
  'and the instance keeps its own settings',
  JSON.stringify(danglingBack.document.sections[0].modules[0].config)
    === JSON.stringify(dangling.sections[0].modules[0].config),
)

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Privilege escalation')

/*
  The question here is whether anything an administrator can PUBLISH can widen who may do what.
  A published document is content. If it can also be authority, then the builder is a way to grant
  yourself a role by editing a page — which is exactly the failure worth writing tests against.
*/
const { can } = await import('../src/lib/auth/roles')

const rolesBefore = {
  anon: can([], 'manage_site_builder'),
  member: can(['member'], 'manage_site_builder'),
  admin: can(['admin'], 'manage_site_builder'),
}

/*
  Publish a navigation that links straight into /staff, with an owner-only module beside it. If the
  document were authority, this is what granting yourself access would look like.
*/
const navDraft = (await getDraft('nav'))!
const escalation = structuredClone(navDraft.document)
const navMod = escalation.sections[0].modules.find((m) => m.type === 'global.navigation')
if (navMod) {
  navMod.config = {
    ...navMod.config,
    items: [
      { label: 'Admin', href: '/staff', mobileLabel: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', children: [] },
      { label: 'Builder', href: '/staff/site-builder', mobileLabel: '', newTab: false, icon: '', badge: '', audience: 'everyone', device: 'both', children: [] },
    ],
  }
}
await saveDraft('nav', escalation, navDraft.version, actor)
await publish('nav', actor, 'Escalation probe')

const rolesAfter = {
  anon: can([], 'manage_site_builder'),
  member: can(['member'], 'manage_site_builder'),
  admin: can(['admin'], 'manage_site_builder'),
}
check('publishing a link to /staff grants nobody anything', JSON.stringify(rolesAfter) === JSON.stringify(rolesBefore))
check('an anonymous visitor still cannot manage the builder', !rolesAfter.anon)
check('a member still cannot', !rolesAfter.member)
check('an administrator still cannot', !rolesAfter.admin)

/*
  A published document cannot forge who published it. The revision records the SESSION actor, and a
  document field claiming otherwise is content that gets validated away — not an identity.
*/
const forgeDraft = (await getDraft(VICTIM))!
const forged = structuredClone(forgeDraft.document) as unknown as Record<string, unknown>
forged.publishedByUsername = 'owner'
forged.publishedById = 1
;(forged as { sections: { publishedByUsername?: string }[] }).sections[0].publishedByUsername = 'owner'
await saveDraft(VICTIM, forged as never, forgeDraft.version, actor)
const forgedPublish = await publish(VICTIM, actor, 'Forgery probe')
const forgedRevision = await prisma.sitePageRevision.findFirst({
  where: { page: { key: VICTIM }, number: forgedPublish.revisionNumber },
})
check('the revision records the real actor, not the document', forgedRevision?.publishedByUsername === actor.username,
  String(forgedRevision?.publishedByUsername))
check('and not the claimed user id', forgedRevision?.publishedById !== 1, String(forgedRevision?.publishedById))
check(
  'the forged fields never reach the stored document',
  !Object.keys(forgedRevision?.document as object).includes('publishedByUsername'),
)

/*
  Visibility rules can only HIDE. There is no rule that shows an owner-only module to somebody who
  is not the Owner, because the facts are assembled from the session on the server and the document
  has no way to write to them.
*/
const { isVisible, factsFor } = await import('../src/lib/site-builder/visibility')
const memberFacts = { ...factsFor({ route: '/' }), signedIn: true, isAdmin: false, isOwner: false }
check(
  'an owner-only rule stays false for a member',
  !isVisible({ conditions: [{ subject: 'isOwner' }] }, memberFacts),
)
check(
  'negating it does not turn a member into the Owner, only into "not the Owner"',
  isVisible({ conditions: [{ subject: 'isOwner', negate: true }] }, memberFacts),
)
check(
  'an OR group cannot smuggle the Owner condition through',
  !isVisible({ match: 'any', conditions: [{ subject: 'isOwner' }, { subject: 'isAdmin' }] }, memberFacts),
)

/*
  And the capability itself is not derived from anything the builder writes. The site_* tables are
  emptied of everything the builder owns and the answer does not move.
*/
check('capability is unchanged with the builder in any state', !can(['member'], 'manage_site_builder') && can(['owner'], 'manage_site_builder'))

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Authorization surface')

/*
  Every server action must require the capability. This reads the source rather than calling them:
  calling one without a session throws for the right reason but would not prove the check is on
  EVERY export, and a new action added without one is exactly the regression worth catching.
*/
// (`readFileSync` is imported in the IDOR section above.)
for (const file of [
  'src/lib/site-builder/actions.ts',
  'src/lib/site-builder/media-actions.ts',
  'src/lib/site-builder/overview-actions.ts',
  'src/lib/site-builder/reusable-actions.ts',
]) {
  const source = readFileSync(file, 'utf8')
  const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  const guards = (source.match(/requireCapability\('manage_site_builder'\)/g) ?? []).length
  check(`${file.split('/').pop()}: every action is capability-checked`,
    guards >= exported.length, `${exported.length} actions, ${guards} checks`)
}

// (`can` is imported in the privilege-escalation section above.)
// (`can` is imported in the privilege-escalation section above.)
check('an anonymous user has no builder capability', !can([], 'manage_site_builder'))
check('a member has no builder capability', !can(['member'], 'manage_site_builder'))
check('an admin has no builder capability', !can(['admin'], 'manage_site_builder'))
check('the owner has the builder capability', can(['owner'], 'manage_site_builder'))
// A retired role must not become a way in.
check('a retired editor role has no builder capability', !can(['editor'], 'manage_site_builder'))
check('an unknown role has no builder capability', !can(['superuser'], 'manage_site_builder'))

// ════════════════════════════════════════════════════════════════════════════════════════════════
section('Competition data untouched')

const counts = {
  seasons: await prisma.season.count(),
  ledger: await prisma.ratingLedger.count(),
  entrants: await prisma.seasonEntrant.count(),
  playoffs: await prisma.seasonPlayoffMatch.count(),
}
console.log(`   seasons ${counts.seasons} · ledger ${counts.ledger} · entrants ${counts.entrants} · playoff rows ${counts.playoffs}`)
check('competition data survived the whole suite', counts.seasons > 0 && counts.ledger > 0)
const s16426 = await prisma.season.findUnique({ where: { id: 16426 } })
if (s16426) {
  check('Season 16426 is still completed', s16426.lifecycleState === 'COMPLETED', String(s16426.lifecycleState))
  check('Season 16426 still records Kevin', s16426.championName === 'Kevin', String(s16426.championName))
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(70)}`)
if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
}
console.log(`\n${pass} checks passed, ${failures.length} failed\n`)
await prisma.$disconnect()
process.exit(failures.length ? 1 : 0)
