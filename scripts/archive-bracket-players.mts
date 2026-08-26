/**
 * Give every player an archived bracket names an identity in the database.
 *
 * ── Why the manifest pass was not enough ─────────────────────────────────────────────────────────
 * `archive-create-players.mts` pooled handles from the manifests, because at the time those were
 * the only source that named people. The 2012–2014 brackets could not be read then — their captures
 * carry seed numbers and nothing else — so nobody who appears only in one of those draws was ever
 * given an account. Twenty Seasons now have a readable bracket, and between eight and sixteen names
 * on each of them resolve to nobody.
 *
 * ── Two different reasons a bracket name resolves to nobody ──────────────────────────────────────
 * Some are people the manifest genuinely never listed: the owner's account is that players changed
 * their CueVerse ID mid-Season and the admins updated the bracket without going back to the group
 * tables. `MJ_The_King` and `havok` are nowhere in the database at all.
 *
 * The rest are the same person the manifest already has, spelled a character differently — the
 * bracket writes `Xx_APOCALIPSYS_xX` where the manifest has `xx_apocalypsys_xx`, an i for a y.
 * Creating an account for that would mint a second identity for one person and split their record.
 *
 * ── How the two are told apart ───────────────────────────────────────────────────────────────────
 * A bracket name is treated as an existing person only when a Player who is ALREADY AN ENTRANT IN
 * THIS SEASON spells their CueVerse ID within one or two characters of it, and only when exactly one
 * such Player does. Same Season, near-identical spelling, one candidate: that is a typo, and it gets
 * an alias. Anything else gets its own account, because attaching a historical record to the wrong
 * person is far harder to undo than merging two afterwards.
 *
 * Preferred Name is never consulted. Nothing here merges.
 *
 * Usage: tsx scripts/archive-bracket-players.mts [--apply]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { parseWayback } from '../src/lib/archive/wayback.ts'
import { resolveCanonical } from '../src/lib/archive/canonical-identity.ts'
import { addAlias } from '../src/lib/players/aliases.ts'
import { createMember } from '../src/lib/staff/create-member-service.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
const ACTOR = { userId: 2, username: 'archive-import' }
const COVERAGE = 'reports/archive-wayback-playoff-coverage.json'
const OUT = 'reports/archive-bracket-identities.json'

interface CoverageRow {
  sourceFile: string; competitionYear: number; seasonNumber: number
  seasonId: number | null; eligible: boolean
}
const coverage = (JSON.parse(readFileSync(COVERAGE, 'utf8')) as CoverageRow[]).filter((r) => r.eligible && r.seasonId)

/** Edit distance, capped so a long-shot pair costs nothing to reject. */
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** How far two spellings of one handle may drift. Longer names carry more room for a slip. */
const tolerance = (s: string) => (s.length >= 10 ? 2 : 1)

interface Decision {
  season: string; seasonId: number; handle: string
  action: 'already-entered' | 'player-exists' | 'alias' | 'create' | 'ambiguous' | 'failed'
  playerId?: string; matched?: string; candidates?: string[]; error?: string
}
const decisions: Decision[] = []

/*
 * One pass to decide, a second to act.
 *
 * Deciding against a database that is being written to would let a handle created for one Season be
 * near-matched by the next, so every Season is read against the same starting state. The handle pool
 * is global for the same reason the manifest pass pooled its own: one person appears in many draws,
 * and resolving per Season would give them an account per Season.
 */
const pool = new Map<string, { raw: string; seasons: { id: number; label: string }[] }>()

for (const row of coverage) {
  const label = `${row.competitionYear} S${row.seasonNumber}A`
  if (!existsSync(row.sourceFile)) continue
  const bracket = parseWayback(readFileSync(row.sourceFile, 'utf8'), row.sourceFile)
  const handles = [...new Set(
    bracket.matches
      .filter((m) => m.round === 1)
      .flatMap((m) => [m.home, m.away])
      .filter((x): x is NonNullable<typeof x> => Boolean(x) && !x!.bye)
      .map((x) => x.normalizedHandle),
  )]

  for (const h of handles) {
    const id = await resolveCanonical(row.seasonId!, h)
    if (id.resolution === 'resolved' && id.entrantId) { decisions.push({ season: label, seasonId: row.seasonId!, handle: h, action: 'already-entered', playerId: id.playerId! }); continue }
    if (id.resolution === 'resolved') { decisions.push({ season: label, seasonId: row.seasonId!, handle: h, action: 'player-exists', playerId: id.playerId! }); continue }
    if (id.resolution === 'ambiguous') { decisions.push({ season: label, seasonId: row.seasonId!, handle: h, action: 'ambiguous' }); continue }

    /*
     * Unresolved. Ask this Season's own entrants whether one of them is this person misspelled.
     */
    const entrants = await prisma.seasonEntrant.findMany({
      where: { seasonId: row.seasonId!, playerId: { not: null } },
      select: { playerId: true, cueverseId: true },
    })
    const players = await prisma.player.findMany({
      where: { id: { in: entrants.map((e) => e.playerId!) } },
      select: { id: true, cueverseId: true, cueverseIdNormalized: true },
    })
    const key = h.toLowerCase()
    const cap = tolerance(key)
    /*
     * Both spellings of an entrant are compared: the handle the Season recorded them under, and the
     * CueVerse ID they hold now. A player who was renamed since is near the first and not the second.
     */
    const byId = new Map(players.map((p) => [p.id, p]))
    const near = entrants.filter((e) => {
      const p = byId.get(e.playerId!)
      const forms = [p?.cueverseIdNormalized, e.cueverseId?.toLowerCase()].filter((x): x is string => Boolean(x))
      return forms.some((f) => distance(key, f, cap) <= cap)
    })
    const distinct = [...new Map(near.map((e) => [e.playerId!, e])).values()]

    if (distinct.length === 1) {
      decisions.push({ season: label, seasonId: row.seasonId!, handle: h, action: 'alias', playerId: distinct[0].playerId!, matched: byId.get(distinct[0].playerId!)?.cueverseId ?? distinct[0].cueverseId ?? undefined })
      continue
    }
    if (distinct.length > 1) {
      decisions.push({ season: label, seasonId: row.seasonId!, handle: h, action: 'ambiguous', candidates: distinct.map((e) => byId.get(e.playerId!)?.cueverseId ?? '?') })
      continue
    }
    const k = key
    const cur = pool.get(k)
    if (cur) cur.seasons.push({ id: row.seasonId!, label })
    else pool.set(k, { raw: h, seasons: [{ id: row.seasonId!, label }] })
    decisions.push({ season: label, seasonId: row.seasonId!, handle: h, action: 'create' })
  }
}

/*
 * ── Before creating anything, two more chances not to ────────────────────────────────────────────
 *
 * The Season-scoped rule above only sees people the manifest already put in that Season. It misses
 * the two ways a bracket-only handle can still be somebody the database has:
 *
 * A person can appear in a draw whose group table never listed them at all, under a spelling one
 * character off an account that exists — the bracket writes `Xx_APOCALIPSYS_xX` and the database has
 * `xx_apocalypsys_xx`, an i for a y. Creating that would split a champion's record in two.
 *
 * And two bracket-only handles can be each other — `_Sugarhigh_` in one Season, `_Sugarhigh__` in
 * another — which would become two accounts for one person, neither of them wrong enough to notice.
 *
 * Both are settled at a distance of one character exactly, and only when the answer is unique. One
 * character is a slip; two is a different handle, and a tie is not an answer.
 */
{
  const count = (k: string) => decisions.filter((d) => d.action === 'create' && d.handle.toLowerCase() === k).length
  const keys = [...pool.keys()]

  // Fold near-identical pooled handles onto whichever spelling the brackets use most.
  for (const k of keys) {
    if (!pool.has(k)) continue
    for (const other of keys) {
      if (other === k || !pool.has(other) || !pool.has(k)) continue
      if (distance(k, other, 1) > 1) continue
      const [keep, drop] = count(k) >= count(other) ? [k, other] : [other, k]
      const kept = pool.get(keep)!
      for (const d of decisions.filter((x) => x.action === 'create' && x.handle.toLowerCase() === drop)) {
        d.matched = kept.raw
        d.handle = kept.raw
      }
      pool.get(keep)!.seasons.push(...pool.get(drop)!.seasons)
      pool.delete(drop)
      console.log(`    fold   "${drop}" into "${keep}" — one character apart, both bracket-only`)
    }
  }

  // Then check what is left against every account that already exists.
  const all = await prisma.player.findMany({ select: { id: true, cueverseId: true, cueverseIdNormalized: true } })
  for (const k of [...pool.keys()]) {
    const near = all.filter((x) => x.cueverseIdNormalized && distance(k, x.cueverseIdNormalized, 1) <= 1)
    if (near.length !== 1) continue
    for (const d of decisions.filter((x) => x.action === 'create' && x.handle.toLowerCase() === k)) {
      d.action = 'alias'
      d.playerId = near[0].id
      d.matched = near[0].cueverseId ?? undefined
    }
    console.log(`    alias  (global) "${pool.get(k)!.raw}" -> ${near[0].cueverseId}`)
    pool.delete(k)
  }
}

const tally = (a: Decision['action']) => decisions.filter((d) => d.action === a).length
console.log(`${coverage.length} Season(s), ${decisions.length} bracket name(s)`)
console.log(`  already entered:      ${tally('already-entered')}`)
console.log(`  Player but no entry:  ${tally('player-exists')}`)
console.log(`  alias onto an entrant:${tally('alias')}`)
console.log(`  new account needed:   ${pool.size} distinct handle(s) across ${tally('create')} appearance(s)`)
console.log(`  ambiguous, left be:   ${tally('ambiguous')}`)

for (const d of decisions.filter((x) => x.action === 'alias')) console.log(`    alias  ${d.season}: "${d.handle}" -> ${d.matched}`)
for (const d of decisions.filter((x) => x.action === 'ambiguous')) console.log(`    AMBIG  ${d.season}: "${d.handle}"${d.candidates ? ` — ${d.candidates.join(', ')}` : ''}`)

if (!APPLY) {
  mkdirSync('reports', { recursive: true })
  writeFileSync(OUT, JSON.stringify(decisions, null, 2))
  console.log('\nDRY RUN — nothing changed. Re-run with --apply.')
  await prisma.$disconnect()
  process.exit(0)
}

// ── Act ────────────────────────────────────────────────────────────────────────────────────────
for (const d of decisions.filter((x) => x.action === 'alias')) {
  const r = await addAlias(ACTOR, d.playerId!, d.handle)
  if (!r.ok) { d.action = 'failed'; d.error = r.error }
}

for (const [key, want] of pool) {
  const existing = await prisma.player.findFirst({ where: { cueverseIdNormalized: key }, select: { id: true } })
  if (existing) {
    for (const d of decisions.filter((x) => x.action === 'create' && x.handle.toLowerCase() === key)) d.playerId = existing.id
    continue
  }
  const res = await createMember(ACTOR, { cueverseId: want.raw })
  for (const d of decisions.filter((x) => x.action === 'create' && x.handle.toLowerCase() === key)) {
    if (res.ok && res.playerId) d.playerId = res.playerId
    else { d.action = 'failed'; d.error = res.error ?? 'creation refused' }
  }
}

mkdirSync('reports', { recursive: true })
writeFileSync(OUT, JSON.stringify(decisions, null, 2))
console.log(`\napplied — ${tally('alias')} alias(es), ${pool.size} account(s), ${tally('failed')} failure(s)`)
await prisma.$disconnect()
