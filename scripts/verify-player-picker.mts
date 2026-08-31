/**
 * The player reference field: what it finds, what it refuses, and what it never leaks.
 *
 * ── The two failures worth most of this file ────────────────────────────────────────────────────
 * A picker that cannot find somebody sends the editor back to a database client, so the search is
 * checked against every way a person might remember a player — current name, current handle, each
 * recorded alias, and an identity that was merged into somebody else years ago.
 *
 * And because `publish` RE-VALIDATES the stored document and throws when it fails, a field kind
 * that rejected an id already saved would not degrade quietly: it would make the homepage
 * unpublishable. The config that exists right now is therefore run through the real validator here,
 * rather than assumed compatible.
 *
 * Run: npm run test:player-picker
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
// So an unauthenticated action refuses at the CAPABILITY check rather than failing to boot Payload.
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
await import('../src/components/site-builder/modules')
const { searchPlayers, resolvePlayer, resolvePlayers, danglingPlayerIds } = await import('../src/lib/players/picker-search')
const fieldsMod = await import('../src/lib/site-builder/fields')
const { getModule } = await import('../src/lib/site-builder/registry')
const { playerRefsIn } = await import('../src/lib/site-builder/player-refs')
const { getDraft, saveDraft, publish, rollback } = await import('../src/lib/site-builder/service')
const { validateDocument } = await import('../src/lib/site-builder/document')

const KEVIN = 'cmsyrx31g00006riggac6o23n'
const DERRICK = 'cmt1nybgb001i6r0cm0deq7al'
const HOME = '/'
const MODULE = 'competitions.recordFeature'
const ACTOR = { userId: 0, username: 'player-picker-verification' }

type Mod = { id: string; type: string; config: Record<string, unknown>; children?: Mod[] }
type Doc = { sections: { modules: Mod[] }[] }
const walk = (m: Mod[]): Mod[] => m.flatMap((x) => [x, ...walk(x.children ?? [])])
const recordModulesOf = (d: Doc) => walk(d.sections.flatMap((s) => s.modules)).filter((m) => m.type === MODULE)
const recordModuleOf = (d: Doc) => recordModulesOf(d)[0]

const startDraft = await getDraft(HOME)
/*
  Whatever is stored NOW, not whatever was stored when this was written.

  The point of the compatibility check is that an id already in the database keeps working, and
  which player that is changes the moment somebody edits the page — so pinning it to a name would
  make this suite fail on a correct edit, which is the least useful kind of failure.
*/
const startHolders = startDraft
  ? recordModulesOf(startDraft.document as unknown as Doc).map((m) => String(m.config.holderPlayerId ?? ''))
  : []
const startHolder = startHolders[0] ?? ''
const startPage = await prisma.sitePage.findUnique({
  where: { key: HOME }, include: { publishedRevision: true },
})
const startRevision = startPage?.publishedRevision?.number ?? null

try {
  // ══ 1. Finding a player ═══════════════════════════════════════════════════════════════════════
  section('Searching by everything a person might remember')

  const byName = await searchPlayers('derrick')
  check('by display name', byName.some((p) => p.id === DERRICK), JSON.stringify(byName.map((p) => p.name)))

  const byHandle = await searchPlayers('sixohtwo')
  check('by current CueVerse ID', byHandle.some((p) => p.id === KEVIN))

  /*
    Every alias, not a sample.

    The whole reason this search exists is the person editing is working from an old bracket or a
    video title. One alias working proves the join; all of them working proves the promise.
  */
  const aliases = await prisma.playerAlias.findMany({
    where: { playerId: DERRICK }, select: { alias: true, aliasDisplay: true },
  })
  check('Derrick has aliases recorded to search', aliases.length > 0, `${aliases.length}`)
  for (const a of aliases) {
    const term = (a.aliasDisplay ?? a.alias).trim()
    const hits = await searchPlayers(term)
    check(`by the old handle "${term}"`, hits.some((p) => p.id === DERRICK),
      JSON.stringify(hits.map((h) => h.name)))
  }

  const merged = await prisma.playerMerge.findFirst({
    where: { status: 'APPROVED' },
    include: { mergedPlayer: { select: { primaryName: true } }, canonicalPlayer: { select: { id: true, primaryName: true } } },
  })
  if (merged?.mergedPlayer.primaryName) {
    const term = merged.mergedPlayer.primaryName
    const hits = await searchPlayers(term)
    check(`a merged-away identity ("${term}") resolves to the account that absorbed it`,
      hits.some((p) => p.id === merged.canonicalPlayerId),
      `wanted ${merged.canonicalPlayer.primaryName}, got ${JSON.stringify(hits.map((h) => h.name))}`)
    check('...and the merged-away row is never offered as itself',
      !hits.some((p) => p.id === merged.mergedPlayerId))
  }

  check('one character finds nothing rather than everybody', (await searchPlayers('d')).length === 0)
  check('a term nobody matches returns no results',
    (await searchPlayers('zzzznotaplayerzzz')).length === 0)

  // ══ 2. What the editor's browser is allowed to see ════════════════════════════════════════════
  section('Only public identity leaves the server')
  const sample = await searchPlayers('derrick')
  const keys = new Set(Object.keys(sample[0] ?? {}))
  const forbidden = ['primaryEmail', 'discord', 'linkedUserId', 'joinPasswordHash', 'timeZone',
    'breakPostingBlocked', 'breakPostingBlockedReason', 'provenance']
  for (const k of forbidden) check(`no ${k} in the result`, !keys.has(k))
  check('the shape is exactly what is needed to recognise somebody',
    [...keys].every((k) => ['id', 'name', 'cueverseId', 'aliases', 'active', 'matchedOn', 'matchedValue'].includes(k)),
    JSON.stringify([...keys]))

  // ══ 3. Resolving stored ids ═══════════════════════════════════════════════════════════════════
  section('Resolving what is already stored')
  const kevin = await resolvePlayer(KEVIN)
  check('the id stored today resolves', kevin != null)
  check('...to Kevin', kevin?.name === 'Kevin', String(kevin?.name))
  check('...with the CueVerse ID sixohtwo', kevin?.cueverseId === 'sixohtwo', String(kevin?.cueverseId))

  const derrick = await resolvePlayer(DERRICK)
  check('Derrick resolves by his id', derrick?.name === 'Derrick', String(derrick?.name))

  check('a deleted or invented id resolves to nothing',
    (await resolvePlayer('cnotaplayeratallxxxxxxxxx')) === null)
  check('...and is reported as dangling',
    (await danglingPlayerIds([KEVIN, 'cnotaplayeratallxxxxxxxxx'])).length === 1)
  check('...while a live id is not', (await danglingPlayerIds([KEVIN])).length === 0)
  check('resolving many at once returns only those that exist',
    (await resolvePlayers([KEVIN, DERRICK, 'cnope'])).size === 2)

  // ══ 4. The field refuses anything not chosen from the list ════════════════════════════════════
  section('A player field is not a text box')
  const F = { holder: { kind: 'player' as const, label: 'Player', default: '' } }
  const v = (raw: unknown) => fieldsMod.validateConfig(F, { holder: raw })

  check('empty means nobody is linked', v('').ok && v('').value.holder === '')
  check('a real player id is accepted', v(KEVIN).ok && v(KEVIN).value.holder === KEVIN)
  check('a name is refused', !v('Derrick').ok)
  check('a CueVerse ID is refused', !v('sixohtwo').ok)
  check('a number is refused', !v('16426').ok)
  check('a sentence is refused', !v('the guy who did the 57 second run').ok)
  check('markup is refused', !v('<script>alert(1)</script>').ok)
  check('an id-shaped string with capitals is refused', !v(KEVIN.toUpperCase()).ok)
  check('something far too long is refused', !v('c'.repeat(200)).ok)
  /*
    A refused value falls back to the DEFAULT, never the rejected string. This is the same rule that
    keeps an unsafe href out of the database, and it matters here for the same reason: the coerced
    document is what gets stored when a save reports issues.
  */
  check('a refused value never reaches the stored config', v('Derrick').value.holder === '')

  // ══ 5. The registry is what says which fields hold a player ═══════════════════════════════════
  section('Finding player references in a document')
  const def = getModule(MODULE)
  check('the record feature is registered', def != null)
  check('its holder field is now a player reference', def?.fields.holderPlayerId?.kind === 'player',
    String(def?.fields.holderPlayerId?.kind))
  check('its CueVerse ID fallback is still ordinary text',
    def?.fields.holderCueverseId?.kind === 'text')
  check('its display name fallback is still ordinary text',
    def?.fields.holderDisplayName?.kind === 'text')

  const synthetic = {
    sections: [{
      modules: [{
        id: 'm1', type: MODULE,
        config: { holderPlayerId: KEVIN, holderCueverseId: 'sixohtwo', holderDisplayName: 'Kevin' },
      }],
    }],
  }
  const refs = playerRefsIn(synthetic as never)
  check('the reference is found', refs.length === 1, JSON.stringify(refs))
  check('...and it is the player field, not the handle beside it',
    refs[0]?.field === 'holderPlayerId' && refs[0]?.playerId === KEVIN)

  // ══ 6. The configuration that exists right now ════════════════════════════════════════════════
  section('The homepage as it stands today')
  check('the homepage has a draft', startDraft != null)
  check('it holds a record feature', startHolders.length > 0, `${startHolders.length} module(s)`)
  const storedResolved = await resolvePlayers(startHolders)
  check('every player id stored on it still names a real player',
    startHolders.every((id) => id === '' || storedResolved.has(id)),
    JSON.stringify(startHolders))
  const who = startHolder ? storedResolved.get(startHolder) : null
  console.log(`  --   it currently points at ${who ? `${who.name} (${who.cueverseId || 'no handle'})` : 'nobody'}`)
  check('the stored value is an id, never a name or a handle',
    startHolders.every((id) => id === '' || /^c[a-z0-9]{20,30}$/.test(id)),
    JSON.stringify(startHolders))

  /*
    The real stored document, through the real validator.

    `publish` re-validates and THROWS when a document does not pass, so a field kind that rejected
    an id already in the database would not fail quietly — it would make this page impossible to
    publish. This is the check that says the change is backward compatible.
  */
  const asStored = validateDocument(startDraft!.document)
  check('the stored homepage still validates under the new field kind', asStored.ok,
    asStored.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; '))
  const revalidated = recordModulesOf(asStored.value as unknown as Doc).map((m) => String(m.config.holderPlayerId ?? ''))
  check('...and validation preserves every stored id exactly',
    JSON.stringify(revalidated) === JSON.stringify(startHolders),
    `${JSON.stringify(startHolders)} -> ${JSON.stringify(revalidated)}`)

  // ══ 7. Unauthorised callers ═══════════════════════════════════════════════════════════════════
  section('The lookup is not reachable without the Owner capability')
  const actions = await import('../src/lib/site-builder/player-actions')
  const attempts: [string, () => Promise<{ ok: boolean }>][] = [
    ['searchPlayersAction', () => actions.searchPlayersAction('derrick')],
    ['resolvePlayersAction', () => actions.resolvePlayersAction([KEVIN])],
  ]
  for (const [name, call] of attempts) {
    let refused = false
    try { refused = (await call()).ok === false } catch { refused = true }
    check(`${name} refuses an unauthenticated caller`, refused)
  }

  // ══ 8. Draft, publish and rollback keep the reference ═════════════════════════════════════════
  section('The reference survives the whole lifecycle')
  // Whichever of the two is NOT currently stored, so the change is a real change either way.
  const OTHER = startHolder === DERRICK ? KEVIN : DERRICK
  const otherName = (await resolvePlayer(OTHER))?.name ?? OTHER

  const draft = await getDraft(HOME)
  const next = structuredClone(draft!.document) as unknown as Doc
  recordModuleOf(next)!.config.holderPlayerId = OTHER
  const saved = await saveDraft(HOME, next as never, draft!.version, ACTOR)
  check(`a draft holding ${otherName} saves cleanly`, saved.issues === 0, `${saved.issues} issue(s)`)

  const reread = await getDraft(HOME)
  check(`the draft stores ${otherName}'s id, not his name`,
    recordModuleOf(reread!.document as unknown as Doc)?.config.holderPlayerId === OTHER)

  const published = await publish(HOME, ACTOR, 'Player picker verification')
  const revision = await prisma.sitePageRevision.findFirst({
    where: { pageId: startPage!.id, number: published.revisionNumber },
  })
  check('publishing carries the id into the revision',
    recordModuleOf(revision!.document as unknown as Doc)?.config.holderPlayerId === OTHER)

  if (startRevision != null) {
    const rolled = await rollback(HOME, startRevision, ACTOR)
    const back = await prisma.sitePageRevision.findFirst({
      where: { pageId: startPage!.id, number: rolled.revisionNumber },
    })
    check('rolling back restores the previous player',
      recordModuleOf(back!.document as unknown as Doc)?.config.holderPlayerId === startHolder,
      String(recordModuleOf(back!.document as unknown as Doc)?.config.holderPlayerId))
  }
} finally {
  // ── Put the homepage back, and prove it ───────────────────────────────────────────────────────
  try {
    const d = await getDraft(HOME)
    if (d && startDraft) {
      const doc = structuredClone(d.document) as unknown as Doc
      recordModulesOf(doc).forEach((m, i) => { m.config.holderPlayerId = startHolders[i] ?? '' })
      const s = await saveDraft(HOME, doc as never, d.version, ACTOR)
      if (s.issues !== 0) throw new Error(`the restoring draft did not validate (${s.issues})`)
      await publish(HOME, ACTOR, 'Restore the homepage after verification')
    }
    section('The homepage is left as it was found')
    const after = await getDraft(HOME)
    const afterHolders = recordModulesOf(after!.document as unknown as Doc).map((m) => String(m.config.holderPlayerId ?? ''))
    check('the draft holds the player it started with',
      JSON.stringify(afterHolders) === JSON.stringify(startHolders),
      `${JSON.stringify(startHolders)} -> ${JSON.stringify(afterHolders)}`)
    const page = await prisma.sitePage.findUnique({
      where: { key: HOME }, include: { publishedRevision: true },
    })
    const live = page?.publishedRevision?.document as unknown as Doc | undefined
    const liveHolders = live ? recordModulesOf(live).map((m) => String(m.config.holderPlayerId ?? '')) : null
    check('and the published homepage does too',
      liveHolders != null && JSON.stringify(liveHolders) === JSON.stringify(startHolders),
      `${JSON.stringify(startHolders)} -> ${JSON.stringify(liveHolders)}`)
  } catch (err) {
    check('the homepage was restored', false, (err as Error).message)
  }
  await prisma.$disconnect()
}

console.log(`\n${'═'.repeat(74)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  x ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
await new Promise((r) => { setTimeout(r, 250) })
process.exit(fail ? 1 : 0)
