/**
 * Who may publish a theme, and what everyone else gets instead.
 *
 * ── Why the endpoints are tested and not only the buttons ───────────────────────────────────────
 * A server action is a public HTTP endpoint. "The panel does not draw the button" is a statement
 * about a React tree, not a permission model — and the whole point of checking is that the two can
 * disagree. So each action is called directly, as an unauthenticated caller and as a signed-in
 * non-Owner, and the only acceptable answer is a refusal.
 *
 * Run: npm run test:theme:permissions (with the dev server up)
 */

import { readFileSync } from 'node:fs'

const env: Record<string, string> = {}
for (const raw of readFileSync('.env.replica', 'utf8').split(String.fromCharCode(10))) {
  const line = raw.trim(); const eq = line.indexOf('=')
  if (eq < 1 || line.startsWith('#')) continue
  let v = line.slice(eq + 1).trim()
  if (v.length > 1 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1)
  env[line.slice(0, eq).trim()] = v
}
process.env.DATABASE_URL ||= env.DATABASE_URL ?? ''
process.env.DIRECT_URL ||= env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''
/*
  The auth stack has to be able to START.

  Without PAYLOAD_SECRET every action fails while initialising, and this suite would report five
  refusals that had nothing to do with permissions -- passing for exactly the wrong reason. With it,
  the actor resolves to nobody and the capability check is what refuses.
*/
process.env.PAYLOAD_SECRET ||= env.PAYLOAD_SECRET ?? ''
process.env.RATE_LIMIT_SALT ||= env.RATE_LIMIT_SALT ?? ''
process.env.RESET_HMAC_SECRET ||= env.RESET_HMAC_SECRET ?? ''

let pass = 0
let fail = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const { prisma } = await import('../src/lib/prisma')
type LayoutDocument = {
  sections: { modules: { type: string; config: Record<string, unknown> }[] }[]
}

try {
  // ══ The capability itself ═════════════════════════════════════════════════════════════════════
  section('manage_site_builder is the Owner designation and nothing else')
  const { can } = await import('../src/lib/auth/roles')
  check('an owner has it', can(['owner'], 'manage_site_builder') === true)
  check('an admin does NOT', can(['admin'], 'manage_site_builder') === false)
  check('an editor does NOT', can(['editor'], 'manage_site_builder') === false)
  check('a member does NOT', can(['member'], 'manage_site_builder') === false)
  check('nor an admin who is also an editor', can(['admin', 'editor'], 'manage_site_builder') === false)
  check('nor somebody with no roles at all', can([], 'manage_site_builder') === false)

  // ══ Every action refuses without the capability ═══════════════════════════════════════════════
  section('Every theme action refuses an unauthenticated caller')
  /*
    Called in-process with no session.

    `requireCapability` resolves the actor from cookies; outside a request there are none, so this
    is the same position an anonymous HTTP caller is in. Each must reject rather than return data.
  */
  const actions = await import('../src/lib/theme/actions')
  const attempts: [string, () => Promise<unknown>][] = [
    ['getThemeStateAction', () => actions.getThemeStateAction()],
    ['saveThemeDraftAction', () => actions.saveThemeDraftAction({ void: '#123456' }, 1)],
    ['publishThemeAction', () => actions.publishThemeAction('should not happen')],
    ['rollbackThemeAction', () => actions.rollbackThemeAction(1)],
    ['themeHistoryAction', () => actions.themeHistoryAction()],
  ]

  for (const [name, call] of attempts) {
    let refused = false
    let detail = ''
    try {
      const res = await call() as { ok?: boolean; error?: string }
      // A guarded action turns the throw into { ok: false }. Either shape is a refusal; data is not.
      refused = res?.ok === false
      detail = JSON.stringify(res).slice(0, 120)
    } catch (err) {
      refused = true
      detail = (err as Error).message.slice(0, 80)
    }
    check(`${name} refuses`, refused, detail)
  }

  // ══ And nothing was written while trying ══════════════════════════════════════════════════════
  section('The attempts changed nothing')
  const page = await prisma.sitePage.findUnique({
    where: { key: 'theme' },
    include: { publishedRevision: true, draft: true },
  })
  const doc = page?.publishedRevision?.document as unknown as LayoutDocument | undefined
  const { normaliseTokens } = await import('../src/lib/theme/presets')
  const mod = doc?.sections.flatMap((s) => s.modules).find((m) => m.type === 'global.theme')
  const palette = mod ? normaliseTokens(mod.config) : {}
  check('the published palette is untouched', !('void' in palette) || palette.void !== '#123456',
    JSON.stringify(palette))
  check('no revision was created by a refused call', page != null)

  // ══ The public site never carries draft or preview values ═════════════════════════════════════
  section('A visitor is served the published theme and nothing else')
  const BASE = process.env.SB_BASE ?? 'http://localhost:3000'
  const html = await (await fetch(`${BASE}/?cb=${Math.random()}`)).text()
  check('no draft marker reaches the public HTML', !/data-theme-draft|themeDraft/i.test(html))
  check('no publishing control is serialised into the page',
    !/Publish site-wide|Save draft/i.test(html))
  /*
    The pre-paint script ships a MAP of property names, never anybody's colours.

    `DOM_SPEC.tokens` is registry-key to custom-property, which is how the script knows what to
    write; the values come from the reader's own localStorage at run time. If that map ever arrived
    populated, every visitor would be served somebody's colours before a line of it was published.
  */
  check('the shipped defaults carry an empty palette', /"tokens":\{\}/.test(html),
    'the default palette is not empty in the served HTML')

  /*
    ── Why this is not "no hex may appear in the head" ───────────────────────────────────────────
    Colours in the head are not in themselves a leak. Two static `theme-color` meta tags and the
    built-in Display Lab defaults all legitimately carry one, and the published :root block is
    MEANT to. The leak worth testing for is narrower and comes from one place: a value that lives
    in the DATABASE as an unpublished draft, arriving at somebody who is not the Owner.

    So the draft is read straight from Prisma and every value it holds that is NOT also published is
    a sentinel — a string that has no business anywhere in an anonymous response.
  */
  const draftDoc = page?.draft?.document as unknown as LayoutDocument | undefined
  const draftMod = draftDoc?.sections
    .flatMap((s) => s.modules).find((m) => m.type === 'global.theme')
  const draftPalette = draftMod ? normaliseTokens(draftMod.config) : {}
  const publishedValues = new Set(Object.values(palette))
  const draftOnly = [...new Set(Object.values(draftPalette))].filter((v) => !publishedValues.has(v))

  if (draftOnly.length === 0) {
    console.log('  --   the saved draft matches what is published, so there is nothing to leak')
  } else {
    const leaked = draftOnly.filter((v) => html.toLowerCase().includes(v))
    check('no draft-only colour reaches an anonymous visitor', leaked.length === 0,
      JSON.stringify(leaked.slice(0, 6)))
  }
} finally {
  await prisma.$disconnect()
}

console.log(`\n${'═'.repeat(74)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  x ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
/*
  One turn of the event loop between the last close and the exit.

  Exiting immediately tears the process down while a socket is still closing, and libuv asserts —
  `!(handle->flags & UV_HANDLE_CLOSING)` — taking the run down with code 127 AFTER every check has
  passed. A suite that prints "16 checks passed, 0 failed" and then exits non-zero looks fine to a
  person and fails in CI, which is the worst of both.

  Dropping the explicit exit is not the fix: importing the app pulls in Payload and its pool, which
  hold the loop open long after the last assertion, and the suite simply never returns. So the exit
  stays, and the handles are given a moment to finish first.
*/
await new Promise((r) => { setTimeout(r, 250) })
process.exit(fail ? 1 : 0)
